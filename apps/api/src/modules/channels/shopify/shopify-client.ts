import { createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { SHOPIFY_DOMAIN_RE } from '@fangevo/shared';

/**
 * Zugang zur Shopify Admin GraphQL API für die App „FangEvo Wawi“ (ADR-015).
 *
 * Anmeldung je Shop über den Token-Endpunkt mit `grant_type=client_credentials`:
 * - mit Schlüsselpaar (signierte Client-Assertion, RS256/ES256): für jeden Shop, der die App installiert hat
 *   (öffentlicher Vertrieb), Token ca. 1 Stunde gültig;
 * - sonst mit dem Client-Schlüssel: nur Shops der eigenen Shopify-Organisation, Token 24 Stunden gültig.
 * Tokens liegen nur im Speicher und werden vor Ablauf erneuert; sie werden nie protokolliert.
 */

export interface ShopifyCredentials {
  clientId: string;
  clientSecret?: string;
  privateKey?: KeyObject;
  keyId?: string;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class ShopifyError extends Error {
  constructor(
    message: string,
    /** auth | not_installed | throttled | api | network | user */
    readonly kind: 'auth' | 'not_installed' | 'throttled' | 'api' | 'network' | 'user',
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface ShopifyUserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function assertShopDomain(shop: string): void {
  if (!SHOPIFY_DOMAIN_RE.test(shop))
    throw new ShopifyError(`Ungültige Shop-Adresse ${shop}`, 'user');
}

/** Lädt die Zugangsdaten aus der Konfiguration; ohne Client-ID ist Shopify nicht eingerichtet. */
export function shopifyCredentials(cfg: {
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_KEY_ID?: string;
  privateKeyPem?: string;
}): ShopifyCredentials | null {
  if (!cfg.SHOPIFY_CLIENT_ID) return null;
  if (cfg.privateKeyPem) {
    if (!cfg.SHOPIFY_KEY_ID)
      throw new Error('SHOPIFY_KEY_ID fehlt (Schlüssel-ID aus dem Dev Dashboard)');
    return {
      clientId: cfg.SHOPIFY_CLIENT_ID,
      privateKey: createPrivateKey(cfg.privateKeyPem),
      keyId: cfg.SHOPIFY_KEY_ID,
    };
  }
  if (!cfg.SHOPIFY_CLIENT_SECRET) return null;
  return { clientId: cfg.SHOPIFY_CLIENT_ID, clientSecret: cfg.SHOPIFY_CLIENT_SECRET };
}

/** Signierte Client-Assertion (JWT) für genau eine Token-Anfrage an genau einen Shop. */
export function clientAssertion(creds: ShopifyCredentials, shop: string, now = Date.now()): string {
  const key = creds.privateKey!;
  let alg: 'RS256' | 'ES256';
  if (key.asymmetricKeyType === 'rsa') alg = 'RS256';
  else if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1')
    alg = 'ES256';
  else throw new Error('Bitte einen RSA- oder P-256-Schlüssel verwenden');
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg, kid: creds.keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: creds.clientId,
      sub: creds.clientId,
      aud: `https://${shop}/admin/oauth/access_token`,
      iat,
      exp: iat + 60,
      jti: randomUUID(),
    }),
  );
  const data = Buffer.from(`${header}.${payload}`);
  const sig =
    alg === 'RS256'
      ? sign('sha256', data, key)
      : sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ShopifyClient {
  private readonly tokens = new Map<string, { token: string; renewAt: number; scope: string }>();

  constructor(
    private readonly creds: ShopifyCredentials,
    private readonly apiVersion: string,
    private readonly fetchImpl: FetchFn = (u, i) => fetch(u, i),
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  get clientId(): string {
    return this.creds.clientId;
  }

  /** Vom Shop gewährte Berechtigungen (nach der ersten Anmeldung). */
  scopes(shop: string): string[] {
    return (this.tokens.get(shop)?.scope ?? '').split(',').filter(Boolean);
  }

  forget(shop: string): void {
    this.tokens.delete(shop);
  }

  async token(shop: string): Promise<string> {
    assertShopDomain(shop);
    const cached = this.tokens.get(shop);
    if (cached && Date.now() < cached.renewAt) return cached.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.creds.clientId,
    });
    if (this.creds.privateKey) {
      body.set('client_assertion_type', ASSERTION_TYPE);
      body.set('client_assertion', clientAssertion(this.creds, shop));
    } else {
      body.set('client_secret', this.creds.clientSecret ?? '');
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new ShopifyError(`Shopify nicht erreichbar: ${String(e)}`, 'network', true);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status >= 500)
        throw new ShopifyError(`Shopify-Anmeldung: Fehler ${res.status}`, 'network', true);
      if (res.status === 404)
        throw new ShopifyError(
          'Shop nicht gefunden. Stimmt die Adresse (name.myshopify.com)?',
          'user',
        );
      throw new ShopifyError(
        /not.*installed|app_not_installed|shop_not_permitted/i.test(text)
          ? 'Die App „FangEvo Wawi“ ist in diesem Shop nicht installiert oder darf ihn nicht nutzen'
          : `Anmeldung bei Shopify abgelehnt (${res.status}). Ist die App im Shop installiert?`,
        res.status === 400 || res.status === 403 ? 'not_installed' : 'auth',
      );
    }
    const j = (await res.json()) as { access_token: string; expires_in?: number; scope?: string };
    const lifetime = (j.expires_in ?? 3600) * 1000;
    // Zufällig 3–8 Minuten vor Ablauf erneuern (bei kurzen Laufzeiten nach der halben Zeit)
    const margin = Math.min(lifetime / 2, 180_000 + Math.random() * 300_000);
    this.tokens.set(shop, {
      token: j.access_token,
      renewAt: Date.now() + lifetime - margin,
      scope: j.scope ?? '',
    });
    return j.access_token;
  }

  /**
   * GraphQL-Anfrage. Wiederholt bei Drosselung (THROTTLED/429), Serverfehlern und Netzwerkfehlern;
   * bei 401 wird einmal neu angemeldet. Fehler in `errors` werfen; `userErrors` prüft der Aufrufer.
   */
  async graphql<T>(
    shop: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let reauth = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.token(shop);
      let res: Response;
      try {
        res = await this.fetchImpl(`https://${shop}/admin/api/${this.apiVersion}/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body: JSON.stringify({ query, variables }),
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt < MAX_ATTEMPTS) {
          await this.wait(1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyError(`Shopify nicht erreichbar: ${String(e)}`, 'network', true);
      }
      if (res.status === 401 && !reauth) {
        reauth = true;
        this.forget(shop);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          const ra = Number(res.headers.get('retry-after'));
          await this.wait(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyError(
          `Shopify antwortet nicht (${res.status})`,
          res.status === 429 ? 'throttled' : 'network',
          true,
        );
      }
      if (res.status === 401 || res.status === 403)
        throw new ShopifyError(
          'Shopify verweigert den Zugriff. Bitte prüfen, ob die App installiert ist und alle Berechtigungen hat',
          'auth',
        );
      if (!res.ok) throw new ShopifyError(`Shopify-Fehler ${res.status}`, 'api');
      const j = (await res.json()) as {
        data?: T;
        errors?: { message: string; extensions?: { code?: string } }[];
        extensions?: {
          cost?: {
            requestedQueryCost?: number;
            throttleStatus?: { currentlyAvailable: number; restoreRate: number };
          };
        };
      };
      if (j.errors?.length) {
        const throttled = j.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < MAX_ATTEMPTS) {
          const c = j.extensions?.cost;
          const need =
            (c?.requestedQueryCost ?? 100) - (c?.throttleStatus?.currentlyAvailable ?? 0);
          const rate = c?.throttleStatus?.restoreRate || 50;
          await this.wait(Math.max(1000, Math.ceil((need / rate) * 1000)));
          continue;
        }
        const msg = j.errors
          .map((e) => e.message)
          .join('; ')
          .slice(0, 500);
        if (/access denied|not approved|scope/i.test(msg))
          throw new ShopifyError(`Fehlende Berechtigung bei Shopify: ${msg}`, 'auth');
        throw new ShopifyError(`Shopify: ${msg}`, throttled ? 'throttled' : 'api', throttled);
      }
      return j.data as T;
    }
  }
}
