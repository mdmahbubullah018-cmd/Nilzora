import { apiErrorBodySchema, authSessionSchema, registerResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * Unit tests of the auth routes against in-memory fakes of Supabase Auth and the
 * identity tables. The same flows run against the real local stack in
 * auth.integration.test.ts.
 */

const PASSWORD = 'shopping2026';

function setup(env: Record<string, string> = {}) {
  const identity = new FakeIdentity();
  return { identity, app: testApp({ auth: identity.deps, env }) };
}

function errorCode(body: unknown): string {
  return apiErrorBodySchema.parse(body).error.code;
}

describe('POST /api/v1/auth/register', () => {
  const registration = {
    email: ' New.Customer@Example.com ',
    password: PASSWORD,
    fullName: 'Rahima Khatun',
    phone: '01712345678',
  };

  it('accepts a customer registration and passes only normalised fields on', async () => {
    const { identity, app } = setup();
    const response = await request(app).post('/api/v1/auth/register').send(registration);

    expect(response.status).toBe(202);
    expect(registerResponseSchema.parse(response.body).status).toBe('accepted');
    expect(identity.signUps).toEqual([
      {
        email: 'new.customer@example.com',
        password: PASSWORD,
        fullName: 'Rahima Khatun',
        phone: '+8801712345678',
      },
    ]);
    const created = [...identity.users.values()].find(
      (u) => u.email === 'new.customer@example.com',
    );
    expect(created?.role).toBe('customer');
  });

  it('answers identically for an address that is already registered', async () => {
    const { identity, app } = setup();
    identity.addUser({ email: 'taken@example.com' });

    const fresh = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: 'fresh@example.com' });
    const taken = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: 'taken@example.com' });

    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toStrictEqual(fresh.body);
  });

  it.each([
    ['role', { role: 'admin' }],
    ['role (owner)', { role: 'super_admin' }],
    ['role (staff)', { role: 'staff' }],
    ['role (moderator)', { role: 'moderator' }],
    ['permissions', { permissions: ['settings.manage'] }],
    ['status', { status: 'active' }],
    ['user metadata', { user_metadata: { role: 'admin' } }],
    ['app metadata', { app_metadata: { role: 'admin' } }],
  ])('rejects a client-supplied %s and creates nothing', async (_, extra) => {
    const { identity, app } = setup();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, ...extra });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('validation_failed');
    expect(identity.signUps).toHaveLength(0);
  });

  it('enforces the password policy before contacting Supabase', async () => {
    const { identity, app } = setup();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, password: 'password' });

    expect(response.status).toBe(400);
    expect(identity.signUps).toHaveLength(0);
  });

  it.each([
    ['weak_password', 400, 'weak_password'],
    ['rate_limited', 429, 'rate_limited'],
    ['unavailable', 503, 'auth_unavailable'],
  ] as const)('maps a Supabase %s failure to %i', async (failure, status, code) => {
    const { identity, app } = setup();
    identity.gatewayFailure = failure;
    const response = await request(app).post('/api/v1/auth/register').send(registration);

    expect(response.status).toBe(status);
    expect(errorCode(response.body)).toBe(code);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns a bearer session that is never cached', async () => {
    const { identity, app } = setup();
    identity.addUser({ email: 'customer@example.com' });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'Customer@Example.com', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(authSessionSchema.parse(response.body).tokenType).toBe('bearer');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { identity, app } = setup();
    identity.addUser({ email: 'customer@example.com' });
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'customer@example.com', password: 'not-the-password1' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password1' });

    const withoutRequestId = (body: unknown) => {
      const { code, message, details } = apiErrorBodySchema.parse(body).error;
      return { code, message, details };
    };
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(withoutRequestId(wrongPassword.body).code).toBe('invalid_credentials');
    expect(withoutRequestId(unknownEmail.body)).toStrictEqual(withoutRequestId(wrongPassword.body));
  });

  it('asks for email confirmation only after the password was correct', async () => {
    const { identity, app } = setup();
    identity.addUser({ email: 'new@example.com', confirmed: false });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'new@example.com', password: PASSWORD });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('email_not_confirmed');
  });

  it.each([
    ['suspended', { status: 'suspended' as const }, 'account_suspended'],
    ['unprovisioned', { profile: null }, 'account_unavailable'],
  ])('refuses %s accounts and revokes the session it just created', async (_, overrides, code) => {
    const { identity, app } = setup();
    identity.addUser({ email: 'blocked@example.com', ...overrides });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'blocked@example.com', password: PASSWORD });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe(code);
    expect(response.text).not.toMatch(/accessToken|refreshToken/);
    expect([...identity.sessions.values()].every((session) => session.revoked)).toBe(true);
  });

  it('applies the stricter sign-in rate limit', async () => {
    const { identity, app } = setup({ AUTH_RATE_LIMIT_MAX: '2' });
    identity.addUser({ email: 'customer@example.com' });
    const attempt = () =>
      request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'customer@example.com', password: 'wrong-password1' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(errorCode(limited.body)).toBe('rate_limited');
  });
});

describe('POST /api/v1/auth/confirm-email', () => {
  const tokenHash = 'confirmation-token-hash-0001';

  it('confirms the address once without signing anyone in', async () => {
    const { identity, app } = setup();
    const user = identity.addUser({ email: 'new@example.com', confirmed: false });
    identity.confirmationLinks.set(tokenHash, user.id);

    const confirmed = await request(app).post('/api/v1/auth/confirm-email').send({ tokenHash });
    const replay = await request(app).post('/api/v1/auth/confirm-email').send({ tokenHash });

    expect(confirmed.status).toBe(204);
    expect(confirmed.text).toBe('');
    expect(user.confirmed).toBe(true);
    expect(identity.sessions.size).toBe(0);
    expect(replay.status).toBe(400);
    expect(errorCode(replay.body)).toBe('invalid_confirmation_link');
  });

  it('lets the confirmed account sign in with its password afterwards', async () => {
    const { identity, app } = setup();
    const user = identity.addUser({
      email: 'new@example.com',
      password: 'correct horse battery',
      confirmed: false,
    });
    identity.confirmationLinks.set(tokenHash, user.id);

    await request(app).post('/api/v1/auth/confirm-email').send({ tokenHash });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'new@example.com', password: 'correct horse battery' });

    expect(login.status).toBe(200);
    expect(authSessionSchema.parse(login.body).tokenType).toBe('bearer');
  });

  it.each([
    ['a malformed hash', { tokenHash: '../../etc' }],
    ['extra fields', { tokenHash, type: 'recovery' }],
  ])('rejects %s before contacting Supabase', async (_label, body) => {
    const { app } = setup();
    const response = await request(app).post('/api/v1/auth/confirm-email').send(body);

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('validation_failed');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('exchanges a refresh token once for a new session', async () => {
    const { identity, app } = setup();
    const user = identity.addUser({ email: 'customer@example.com' });
    const { refreshToken } = identity.issueSession(user);

    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

    expect(first.status).toBe(200);
    expect(authSessionSchema.parse(first.body).refreshToken).not.toBe(refreshToken);
    expect(replay.status).toBe(401);
    expect(errorCode(replay.body)).toBe('invalid_refresh_token');
  });

  it('rejects unknown refresh tokens', async () => {
    const { app } = setup();
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'made-up-token' });

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('invalid_refresh_token');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session so the access token stops working', async () => {
    const { identity, app } = setup();
    const user = identity.addUser({ email: 'customer@example.com' });
    const token = identity.tokenFor(user);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    const after = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(logout.status).toBe(204);
    expect(after.status).toBe(401);
  });

  it('requires a valid token', async () => {
    const { app } = setup();
    const missing = await request(app).post('/api/v1/auth/logout');
    const invalid = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer not.a.session');

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(errorCode(invalid.body)).toBe('unauthenticated');
  });
});
