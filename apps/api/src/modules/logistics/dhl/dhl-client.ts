/**
 * Zugang zur „DHL Paket DE Versenden API“ v2 (Post & Paket Deutschland), ADR-016.
 *
 * Anmeldung: OAuth2 (ROPC) mit dem API-Schlüssel der App (Serverkonfiguration) und dem Benutzer des
 * Post & DHL Geschäftskundenportals der Firma. Tokens liegen nur im Speicher und werden vor Ablauf
 * erneuert; Zugangsdaten und Tokens werden nie protokolliert.
 * Eine Sendung = ein Paket. Etiketten kommen als PDF (Base64) in der Antwort zurück.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface DhlAppCredentials {
  apiKey: string;
  apiSecret: string;
  env: 'sandbox' | 'production';
}

export interface DhlUser {
  user: string;
  password: string;
}

export interface DhlAddress {
  name1: string;
  name2?: string | null;
  addressStreet: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-3 */
  country: string;
  email?: string | null;
  phone?: string | null;
}

export interface DhlShipmentRequest {
  product: 'V01PAK' | 'V53WPAK';
  billingNumber: string;
  /** Referenz auf dem Etikett (8–35 Zeichen) */
  refNo: string;
  shipper: DhlAddress;
  consignee: DhlAddress;
  weightKg: string;
  dimCm?: { length: number; width: number; height: number } | null;
}

export interface DhlValidationMessage {
  property?: string;
  validationMessage?: string;
  validationState?: string;
}

export interface DhlShipmentResult {
  shipmentNo: string;
  labelPdf: Buffer;
  warnings: string[];
}

export class DhlError extends Error {
  constructor(
    message: string,
    /** auth | validation | network | api */
    readonly kind: 'auth' | 'validation' | 'network' | 'api',
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;
const HOSTS = { sandbox: 'https://api-sandbox.dhl.com', production: 'https://api-eu.dhl.com' };

/** ISO-Ländercode alpha-2 → alpha-3 (Deutschland und EU, wie von der API verlangt). */
export const DHL_COUNTRIES: Record<string, string> = {
  DE: 'DEU',
  AT: 'AUT',
  BE: 'BEL',
  BG: 'BGR',
  HR: 'HRV',
  CY: 'CYP',
  CZ: 'CZE',
  DK: 'DNK',
  EE: 'EST',
  FI: 'FIN',
  FR: 'FRA',
  GR: 'GRC',
  HU: 'HUN',
  IE: 'IRL',
  IT: 'ITA',
  LV: 'LVA',
  LT: 'LTU',
  LU: 'LUX',
  MT: 'MLT',
  NL: 'NLD',
  PL: 'POL',
  PT: 'PRT',
  RO: 'ROU',
  SK: 'SVK',
  SI: 'SVN',
  ES: 'ESP',
  SE: 'SWE',
};

const messages = (list: DhlValidationMessage[] | undefined, state: string) =>
  (list ?? [])
    .filter((m) => (m.validationState ?? '').toLowerCase() === state)
    .map((m) => [m.property, m.validationMessage].filter(Boolean).join(': '));

interface OrderResponse {
  status?: { title?: string; statusCode?: number; detail?: string };
  detail?: string;
  title?: string;
  items?: {
    shipmentNo?: string;
    sstatus?: { title?: string; statusCode?: number; detail?: string };
    validationMessages?: DhlValidationMessage[];
    label?: { b64?: string; fileFormat?: string };
  }[];
}

export class DhlClient {
  private readonly tokens = new Map<string, { token: string; renewAt: number }>();

  constructor(
    private readonly app: DhlAppCredentials,
    private readonly fetchImpl: FetchFn = (u, i) => fetch(u, i),
  ) {}

  get env(): 'sandbox' | 'production' {
    return this.app.env;
  }

  private get base(): string {
    return HOSTS[this.app.env];
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new DhlError(`DHL ist nicht erreichbar: ${String(e)}`, 'network');
    }
  }

  forget(user: string): void {
    this.tokens.delete(user);
  }

  async token(u: DhlUser): Promise<string> {
    const cached = this.tokens.get(u.user);
    if (cached && Date.now() < cached.renewAt) return cached.token;
    const res = await this.call(`${this.base}/parcel/de/account/auth/ropc/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: u.user,
        password: u.password,
        client_id: this.app.apiKey,
        client_secret: this.app.apiSecret,
      }).toString(),
    });
    if (!res.ok) {
      if (res.status >= 500) throw new DhlError(`DHL-Anmeldung: Fehler ${res.status}`, 'network');
      throw new DhlError(
        'DHL hat die Anmeldung abgelehnt. Bitte Benutzer und Passwort des Geschäftskundenportals prüfen (Passwörter laufen regelmäßig ab)',
        'auth',
      );
    }
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    const lifetime = (j.expires_in ?? 1800) * 1000;
    this.tokens.set(u.user, {
      token: j.access_token,
      renewAt: Date.now() + lifetime - Math.min(lifetime / 2, 120_000),
    });
    return j.access_token;
  }

  private async authed(u: DhlUser, url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.call(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${await this.token(u)}`,
          Accept: 'application/json',
          'Accept-Language': 'de-DE',
        },
      });
      if (res.status === 401 && attempt === 0) {
        this.forget(u.user);
        continue;
      }
      return res;
    }
  }

  /**
   * Sendung anlegen und Etikett holen. `validateOnly` prüft nur (es entsteht keine Sendung).
   * Warnungen von DHL (z. B. Adresse nicht prüfbar) verhindern das Etikett nicht.
   */
  async createShipment(
    u: DhlUser,
    s: DhlShipmentRequest,
    opts: { printFormat: string; validateOnly?: boolean },
  ): Promise<DhlShipmentResult> {
    const q = new URLSearchParams({
      validate: opts.validateOnly ? 'true' : 'false',
      includeDocs: 'include',
      docFormat: 'PDF',
      printFormat: opts.printFormat,
    });
    const body = {
      profile: 'STANDARD_GRUPPENPROFIL',
      shipments: [
        {
          product: s.product,
          billingNumber: s.billingNumber,
          refNo: s.refNo,
          shipper: clean(s.shipper),
          consignee: clean(s.consignee),
          details: {
            weight: { uom: 'kg', value: Number(s.weightKg) },
            ...(s.dimCm
              ? {
                  dim: {
                    uom: 'cm',
                    length: s.dimCm.length,
                    width: s.dimCm.width,
                    height: s.dimCm.height,
                  },
                }
              : {}),
          },
        },
      ],
    };
    const res = await this.authed(u, `${this.base}/parcel/de/shipping/v2/orders?${q.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403)
      throw new DhlError('DHL verweigert den Zugriff (Benutzer oder Berechtigung prüfen)', 'auth');
    if (res.status === 429)
      throw new DhlError('DHL: zu viele Anfragen, bitte kurz warten', 'network');
    if (res.status >= 500) throw new DhlError(`DHL antwortet nicht (${res.status})`, 'network');
    const j = (await res.json().catch(() => ({}))) as OrderResponse;
    const item = j.items?.[0];
    const errors = messages(item?.validationMessages, 'error');
    const warnings = messages(item?.validationMessages, 'warning');
    const itemStatus = item?.sstatus?.statusCode ?? res.status;
    if (!res.ok || itemStatus >= 400 || errors.length) {
      const detail =
        errors.join('; ') ||
        item?.sstatus?.detail ||
        item?.sstatus?.title ||
        j.status?.detail ||
        j.detail ||
        j.title ||
        `Fehler ${res.status}`;
      throw new DhlError(`DHL lehnt die Sendung ab: ${detail}`.slice(0, 500), 'validation');
    }
    if (opts.validateOnly) return { shipmentNo: '', labelPdf: Buffer.alloc(0), warnings };
    if (!item?.shipmentNo || !item.label?.b64)
      throw new DhlError('DHL hat kein Etikett geliefert', 'api');
    return {
      shipmentNo: item.shipmentNo,
      labelPdf: Buffer.from(item.label.b64, 'base64'),
      warnings,
    };
  }

  /** Sendung stornieren (nur vor dem Tagesabschluss möglich). */
  async deleteShipment(u: DhlUser, shipmentNo: string): Promise<void> {
    const q = new URLSearchParams({ profile: 'STANDARD_GRUPPENPROFIL', shipment: shipmentNo });
    const res = await this.authed(u, `${this.base}/parcel/de/shipping/v2/orders?${q.toString()}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 207)
      throw new DhlError(`DHL: Stornieren fehlgeschlagen (${res.status})`, 'api');
  }
}

function clean(a: DhlAddress): Record<string, string> {
  return Object.fromEntries(
    Object.entries(a).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
  ) as Record<string, string>;
}
