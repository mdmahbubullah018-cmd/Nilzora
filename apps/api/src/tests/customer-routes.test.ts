import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { commerceSetup, errorOf } from './commerce-helpers';

const ID = '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60';

/** Every route that acts for a signed-in customer. */
const CUSTOMER_ROUTES = [
  ['post', '/api/v1/checkout/quote'],
  ['get', '/api/v1/me/addresses'],
  ['post', '/api/v1/me/addresses'],
  ['put', `/api/v1/me/addresses/${ID}`],
  ['delete', `/api/v1/me/addresses/${ID}`],
  ['post', '/api/v1/orders'],
  ['get', '/api/v1/orders'],
  ['get', '/api/v1/orders/NZ100001'],
  ['post', '/api/v1/orders/NZ100001/cancel'],
] as const;

describe.each(CUSTOMER_ROUTES)('%s %s', (method, path) => {
  it('requires a bearer token (401) and is never cached', async () => {
    const { app } = commerceSetup();
    const response = await request(app)[method](path).send({});

    expect(response.status).toBe(401);
    expect(errorOf(response.body).code).toBe('unauthenticated');
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects an invalid token (401)', async () => {
    const { app } = commerceSetup();
    const response = await request(app)
      [method](path)
      .set('Authorization', 'Bearer not-a-real-session')
      .send({});

    expect(response.status).toBe(401);
  });

  it('refuses a suspended account (403) before touching any data', async () => {
    const { app, tokens, commerce } = commerceSetup();
    // Any database call would fail loudly, proving none is made.
    commerce.unavailable = true;
    const response = await request(app)
      [method](path)
      .set('Authorization', `Bearer ${tokens.suspended}`)
      .send({});

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('account_suspended');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
