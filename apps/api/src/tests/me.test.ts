import { apiErrorBodySchema, meResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

function setup() {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'customer@example.com' });
  const other = identity.addUser({ email: 'other@example.com' });
  return {
    identity,
    customer,
    other,
    token: identity.tokenFor(customer),
    app: testApp({ auth: identity.deps }),
  };
}

describe('GET /api/v1/me', () => {
  it('returns the caller, their role, permissions and profile', async () => {
    const { app, token, customer } = setup();
    const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(meResponseSchema.parse(response.body).user).toMatchObject({
      id: customer.id,
      email: 'customer@example.com',
      role: 'customer',
      permissions: [],
    });
    expect(response.text).not.toContain(token);
  });

  it("lists a staff member's permissions for the interface to use", async () => {
    const { identity, app } = setup();
    const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${identity.tokenFor(staff)}`);

    expect(meResponseSchema.parse(response.body).user.permissions).toContain('orders.read');
  });

  it('requires authentication', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/me');

    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/v1/me', () => {
  it("updates the caller's own editable fields", async () => {
    const { app, token } = setup();
    const response = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: '  Rahim Uddin ', phone: '01912-345678' });

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(response.body).user.profile).toMatchObject({
      fullName: 'Rahim Uddin',
      phone: '+8801912345678',
    });
  });

  it('can clear optional fields', async () => {
    const { app, token } = setup();
    const response = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: null });

    expect(meResponseSchema.parse(response.body).user.profile.phone).toBeNull();
  });

  it.each([
    ['a role', { role: 'admin' }],
    ['a status', { status: 'active' }],
    ['another account id', { id: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60', fullName: 'X' }],
    ['permissions', { permissions: ['settings.manage'] }],
    ['nothing at all', {}],
  ])('rejects %s', async (_, body) => {
    const { app, token, identity, customer } = setup();
    const response = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('validation_failed');
    expect(identity.users.get(customer.id)?.role).toBe('customer');
  });

  it('never touches another account', async () => {
    const { app, token, identity, other } = setup();
    await request(app)
      .patch(`/api/v1/me?userId=${other.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', other.id)
      .send({ fullName: 'Hijacked' });

    expect(identity.users.get(other.id)?.profile?.fullName).toBeNull();
  });

  it('returns 503 (not 500) when the profile cannot be written', async () => {
    const { app, token, identity } = setup();
    identity.profileUnavailable = true;
    const response = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Rahim' });

    expect(response.status).toBe(503);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('auth_unavailable');
  });
});
