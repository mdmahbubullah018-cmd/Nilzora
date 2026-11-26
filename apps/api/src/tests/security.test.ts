import { apiErrorBodySchema } from '@nilzora/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';

const STOREFRONT = 'http://localhost:3000';

describe('security headers', () => {
  it.each(['/api/v1/health', '/api/v1/missing'])('are set on %s', async (path) => {
    const response = await request(testApp()).get(path);
    const headers = response.headers;

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(headers['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows a configured origin without credentials or wildcards', async () => {
    const response = await request(testApp()).get('/api/v1/health').set('Origin', STOREFRONT);

    expect(response.headers['access-control-allow-origin']).toBe(STOREFRONT);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id');
    expect(response.headers.vary).toContain('Origin');
  });

  it('gives other origins no CORS headers (the browser then blocks the response)', async () => {
    const response = await request(testApp())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    // CORS is not authentication: the request itself is still handled normally.
    expect(response.status).toBe(200);
  });

  it('sends no CORS headers to same-origin or server-to-server requests', async () => {
    const response = await request(testApp()).get('/api/v1/health');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight requests from configured origins', async () => {
    const response = await request(testApp())
      .options('/api/v1/orders')
      .set('Origin', STOREFRONT)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(STOREFRONT);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    expect(response.headers['access-control-max-age']).toBe('600');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each(['https://evil.example', 'null', 'http://localhost:3000.evil.example'])(
    'rejects preflight requests from %s',
    async (origin) => {
      const response = await request(testApp())
        .options('/api/v1/orders')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      const body = apiErrorBodySchema.parse(response.body);
      expect(body.error.code).toBe('origin_not_allowed');
      expect(body.error.requestId).toBe(response.headers['x-request-id']);
    },
  );

  it('uses the configured allowlist instead of the local defaults', async () => {
    const app = testApp({ env: { CORS_ORIGINS: 'https://shop.nilzora.example' } });
    const allowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://shop.nilzora.example');
    const localhost = await request(app).get('/api/v1/health').set('Origin', STOREFRONT);

    expect(allowed.headers['access-control-allow-origin']).toBe('https://shop.nilzora.example');
    expect(localhost.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const limited = (extra: Record<string, string> = {}) =>
    testApp({ env: { RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000', ...extra } });

  it('returns 429 with the standard error envelope once the limit is reached', async () => {
    const app = limited();
    await request(app).get('/api/v1/missing');
    await request(app).get('/api/v1/missing');
    const response = await request(app).get('/api/v1/missing').set('Origin', STOREFRONT);

    expect(response.status).toBe(429);
    const body = apiErrorBodySchema.parse(response.body);
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
    expect(response.headers['retry-after']).toMatch(/^\d+$/);
    expect(response.headers['ratelimit-policy']).toContain('q=2');
    // Browsers can read the 429 because CORS headers are still applied.
    expect(response.headers['access-control-allow-origin']).toBe(STOREFRONT);
  });

  it('advertises remaining quota on successful requests', async () => {
    const response = await request(limited()).get('/api/v1/missing');

    expect(response.headers.ratelimit).toMatch(/r=1/);
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('never throttles the liveness endpoint', async () => {
    const app = limited();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request(app).get('/api/v1/health')).status).toBe(200);
    }
  });

  it('ignores spoofed X-Forwarded-For headers unless a proxy is trusted', async () => {
    // express-rate-limit warns (console.error) when it sees the header untrusted; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = limited();
    const statuses: number[] = [];
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      statuses.push((await request(app).get('/api/v1/missing').set('X-Forwarded-For', ip)).status);
    }

    expect(statuses).toEqual([404, 404, 429]);
  });

  it('keys clients by forwarded address only when TRUST_PROXY_HOPS is configured', async () => {
    const app = limited({ TRUST_PROXY_HOPS: '1' });
    const statuses: number[] = [];
    for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.2']) {
      statuses.push((await request(app).get('/api/v1/missing').set('X-Forwarded-For', ip)).status);
    }

    expect(statuses).toEqual([404, 404, 429, 404]);
  });
});
