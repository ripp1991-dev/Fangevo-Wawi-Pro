import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ShopifyClient, ShopifyError, clientAssertion, type FetchFn } from './shopify-client';

const SHOP = 'test-shop.myshopify.com';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('Shopify-Client', () => {
  it('Client-Assertion ist korrekt signiert (RS256 und ES256)', () => {
    for (const type of ['rsa', 'ec'] as const) {
      const { privateKey, publicKey } =
        type === 'rsa'
          ? generateKeyPairSync('rsa', { modulusLength: 2048 })
          : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwt = clientAssertion(
        { clientId: 'cid', privateKey, keyId: 'k1' },
        SHOP,
        1_800_000_000_000,
      );
      const [h, p, s] = jwt.split('.');
      const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
      expect(header).toMatchObject({ alg: type === 'rsa' ? 'RS256' : 'ES256', kid: 'k1' });
      expect(payload).toMatchObject({
        iss: 'cid',
        sub: 'cid',
        aud: `https://${SHOP}/admin/oauth/access_token`,
        iat: 1_800_000_000,
        exp: 1_800_000_060,
      });
      const ok = verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        type === 'rsa' ? publicKey : { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s!, 'base64url'),
      );
      expect(ok).toBe(true);
    }
  });

  it('meldet sich einmal an, merkt sich das Token und wiederholt bei Drosselung', async () => {
    const calls: string[] = [];
    let graphqlCalls = 0;
    const fetchImpl: FetchFn = async (url, init) => {
      calls.push(url);
      if (url.endsWith('/admin/oauth/access_token')) {
        const body = new URLSearchParams(String(init.body));
        expect(body.get('grant_type')).toBe('client_credentials');
        expect(body.get('client_secret')).toBe('geheim');
        return json({ access_token: 'tok', expires_in: 86399, scope: 'read_orders,read_products' });
      }
      expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok');
      graphqlCalls++;
      if (graphqlCalls === 1)
        return json({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 10,
              throttleStatus: { currentlyAvailable: 0, restoreRate: 50 },
            },
          },
        });
      if (graphqlCalls === 2) return json({}, 503);
      return json({ data: { shop: { name: 'X' } } });
    };
    const waits: number[] = [];
    const c = new ShopifyClient(
      { clientId: 'cid', clientSecret: 'geheim' },
      '2026-10',
      fetchImpl,
      async (ms) => void waits.push(ms),
    );
    const r = await c.graphql<{ shop: { name: string } }>(SHOP, '{ shop { name } }');
    expect(r.shop.name).toBe('X');
    expect(calls.filter((u) => u.endsWith('access_token'))).toHaveLength(1);
    expect(calls.at(-1)).toBe(`https://${SHOP}/admin/api/2026-10/graphql.json`);
    expect(waits).toHaveLength(2);
    expect(c.scopes(SHOP)).toEqual(['read_orders', 'read_products']);
    await c.graphql(SHOP, '{ shop { name } }');
    expect(calls.filter((u) => u.endsWith('access_token'))).toHaveLength(1);
  });

  it('nicht installierte App und ungültige Shop-Adressen ergeben klare Fehler', async () => {
    const c = new ShopifyClient({ clientId: 'cid', clientSecret: 'x' }, '2026-10', async () =>
      json({ error: 'app_not_installed' }, 400),
    );
    await expect(c.token(SHOP)).rejects.toMatchObject({ kind: 'not_installed' });
    await expect(c.token('evil.example.com')).rejects.toBeInstanceOf(ShopifyError);
  });
});
