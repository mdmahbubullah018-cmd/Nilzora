import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  apiErrorBodySchema,
  authSessionSchema,
  googleSignInResponseSchema,
  meResponseSchema,
} from '@nilzora/contracts';
import { createApp } from '../../app';
import { createAuthService, type AuthService } from '../../auth/first-party';
import { hashPassword } from '../../auth/passwords';
import type { EmailMessage } from '../../auth/sender';
import { createDatabasePool } from '../../db/pool';
import { createLogger } from '../../logging/logger';
import type { AuthGateway } from '../../modules/auth/gateway';
import { AuthError } from '../../auth/first-party';
import { createGoogleIdentitySignIn, type GoogleIdentity } from '../../auth/oauth';
import { createPostgresAccountStore } from '../../modules/users/accounts';
import { testConfig } from '../helpers';

/*
 * Real integration test for Nilzora's own authentication: accounts, emailed six-digit
 * codes and opaque sessions, all in the local PostgreSQL database. Email is captured by
 * a fake sender, so nothing leaves the machine. Fixtures are created by this file only
 * and deleted by email prefix afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });

const run = randomUUID().slice(0, 8);
const PASSWORD = 'correct horse battery 2026';
const NEW_PASSWORD = 'another long one 2027';
const codeSecret = 'integration-test-code-pepper-at-least-32-chars';

const sent: EmailMessage[] = [];
const email = {
  send(message: EmailMessage): Promise<void> {
    sent.push(message);
    return Promise.resolve();
  },
  verify(): Promise<void> {
    return Promise.resolve();
  },
};

/** The six-digit code in the most recent message to an address. */
function latestCode(to: string): string {
  const message = [...sent].reverse().find((item) => item.to === to);
  const match = message?.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`no code was emailed to ${to}`);
  return match[1];
}

const used = new Set<string>();

function address(label: string): string {
  const value = `it-fpa-${run}-${label}@example.com`;
  used.add(value);
  return value;
}

/** Lets a test send another mail to an address at once (the throttle is tested on its own). */
async function clearThrottle(emailAddress: string): Promise<void> {
  await pool.query(
    "delete from public.auth_mail_log where email_hash = extensions.digest(lower($1), 'sha256')",
    [emailAddress],
  );
}

function service(deps: { pool?: Pool; secret?: string } = {}): AuthService {
  return createAuthService({
    pool: deps.pool ?? pool,
    email,
    codeSecret: deps.secret ?? codeSecret,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3600,
  });
}

const auth = service();

/** Creates a verified account with a known password, bypassing the email round trip. */
async function createAccount(label: string, options: { verified?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  const emailAddress = address(label);
  await pool.query('select public.provision_account($1::uuid, $2, $3, $4, $5, $6)', [
    id,
    emailAddress,
    `Account ${label}`,
    null,
    await hashPassword(PASSWORD),
    options.verified ?? true,
  ]);
  return emailAddress;
}

afterAll(async () => {
  // Sessions, codes, roles and queued account emails cascade from the profile row; pending
  // sign-ups, codes without an account and throttle rows are removed explicitly.
  await pool.query('delete from public.profiles where email like $1', [`it-fpa-${run}-%`]);
  await pool.query('delete from public.auth_pending_registrations where email like $1', [
    `it-fpa-${run}-%`,
  ]);
  await pool.query('delete from public.auth_email_codes where lower(email) like $1', [
    `it-fpa-${run}-%`,
  ]);
  for (const emailAddress of used) await clearThrottle(emailAddress);
  await pool.end();
});

describe('first-party registration and email verification', () => {
  it('creates no account until the emailed code is verified, then creates it and a session', async () => {
    const emailAddress = address('register');

    await auth.register({ email: emailAddress, password: PASSWORD, fullName: 'New Customer' });
    // Nothing is an account yet: no profile, no role — only a pending sign-up and its code.
    const before = await pool.query('select 1 from public.profiles where email = $1', [
      emailAddress,
    ]);
    expect(before.rows).toHaveLength(0);
    const pending = await pool.query(
      'select 1 from public.auth_pending_registrations where email = $1',
      [emailAddress],
    );
    expect(pending.rows).toHaveLength(1);

    const code = latestCode(emailAddress);
    expect(code).toMatch(/^\d{6}$/);

    const session = await auth.verifyEmail(emailAddress, code);
    const account = await pool.query<{ id: string; role: string; verified: Date | null }>(
      `select p.id, r.role, p.email_verified_at as verified
         from public.profiles p join public.user_roles r on r.user_id = p.id
        where p.email = $1`,
      [emailAddress],
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0]?.role).toBe('customer');
    expect(account.rows[0]?.verified).not.toBeNull();
    const after = await pool.query(
      'select 1 from public.auth_pending_registrations where email = $1',
      [emailAddress],
    );
    expect(after.rows).toHaveLength(0);
    expect(session.userId).toBe(account.rows[0]?.id);
    const resolved = await auth.resolve(session.tokens.accessToken);
    expect(resolved?.userId).toBe(account.rows[0]?.id);
    expect(resolved?.email).toBe(emailAddress);
    expect(resolved?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // The same code can never be redeemed twice.
    await expect(auth.verifyEmail(emailAddress, code)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
  });

  it('never lets a second registration claim an existing address, and tells its owner', async () => {
    const emailAddress = await createAccount('duplicate');
    const before = await pool.query<{ password_hash: string }>(
      'select password_hash from public.profiles where email = $1',
      [emailAddress],
    );

    await auth.register({ email: emailAddress, password: NEW_PASSWORD, fullName: 'Someone Else' });

    // No code, no pending sign-up, and the account is exactly as it was.
    const last = [...sent].reverse().find((message) => message.to === emailAddress);
    expect(last?.subject).toBe('You already have a Nilzora account');
    expect(last?.text).not.toMatch(/\b\d{6}\b/);
    const pending = await pool.query(
      'select 1 from public.auth_pending_registrations where email = $1',
      [emailAddress],
    );
    expect(pending.rows).toHaveLength(0);
    const after = await pool.query<{ password_hash: string }>(
      'select password_hash from public.profiles where email = $1',
      [emailAddress],
    );
    expect(after.rows[0]?.password_hash).toBe(before.rows[0]?.password_hash);
    await expect(auth.login(emailAddress, NEW_PASSWORD)).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('stores only a hash of the code, never the code itself', async () => {
    const emailAddress = address('hashed');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = latestCode(emailAddress);
    const stored = await pool.query<{ code_hash: Buffer; matches: boolean }>(
      `select code_hash, encode(code_hash, 'escape') like $2 as matches
         from public.auth_email_codes where lower(email) = $1`,
      [emailAddress, `%${code}%`],
    );
    expect(stored.rows[0]?.matches).toBe(false);
  });

  it('refuses an expired code', async () => {
    const emailAddress = address('expired');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = latestCode(emailAddress);
    await pool.query(
      `update public.auth_email_codes set expires_at = now() - interval '1 second'
        where lower(email) = $1`,
      [emailAddress],
    );
    await expect(auth.verifyEmail(emailAddress, code)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
  });

  it('refuses a code after five wrong attempts, even when the right one arrives', async () => {
    const emailAddress = address('attempts');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = latestCode(emailAddress);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.verifyEmail(emailAddress, '000000')).rejects.toMatchObject({
        failure: 'invalid_code',
      });
    }
    await expect(auth.verifyEmail(emailAddress, code)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
  });
});

describe('first-party login', () => {
  it('issues a session for the right password and refuses the wrong one', async () => {
    const emailAddress = await createAccount('login');
    const session = await auth.login(emailAddress, PASSWORD);
    await expect(auth.resolve(session.tokens.accessToken)).resolves.toMatchObject({
      userId: session.userId,
    });

    await expect(auth.login(emailAddress, 'not the password')).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('gives the same answer for an unknown address and a wrong password', async () => {
    const emailAddress = await createAccount('unknown');
    const wrongPassword = await auth
      .login(emailAddress, 'not the password')
      .catch((error: unknown) => error);
    const unknownAccount = await auth
      .login(address('nobody'), PASSWORD)
      .catch((error: unknown) => error);
    expect(wrongPassword).toMatchObject({ failure: 'invalid_credentials' });
    expect(unknownAccount).toMatchObject({ failure: 'invalid_credentials' });
  });

  it('locks the account after eight failures and refuses the correct password while locked', async () => {
    const emailAddress = await createAccount('lockout');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(auth.login(emailAddress, 'not the password')).rejects.toMatchObject({
        failure: 'invalid_credentials',
      });
    }
    const locked = await pool.query<{ locked_until: Date | null }>(
      'select locked_until from public.profiles where email = $1',
      [emailAddress],
    );
    expect(locked.rows[0]?.locked_until).toBeInstanceOf(Date);
    await expect(auth.login(emailAddress, PASSWORD)).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('requires a verified address before issuing a session', async () => {
    const emailAddress = await createAccount('unverified', { verified: false });
    await expect(auth.login(emailAddress, PASSWORD)).rejects.toMatchObject({
      failure: 'email_not_confirmed',
    });
  });
});

describe('opaque sessions', () => {
  it('rotates the refresh token and detects reuse of the old one', async () => {
    const emailAddress = await createAccount('rotate');
    const first = await auth.login(emailAddress, PASSWORD);
    const second = await auth.refresh(first.tokens.refreshToken);

    expect(second.tokens.refreshToken).not.toBe(first.tokens.refreshToken);
    await expect(auth.resolve(second.tokens.accessToken)).resolves.toMatchObject({
      userId: first.userId,
    });

    // The rotated-away token is dead, and replaying it ends the family.
    await expect(auth.refresh(first.tokens.refreshToken)).rejects.toMatchObject({
      failure: 'invalid_refresh_token',
    });
    await expect(auth.resolve(second.tokens.accessToken)).resolves.toBeNull();
  });

  it('revokes the session on logout', async () => {
    const emailAddress = await createAccount('logout');
    const session = await auth.login(emailAddress, PASSWORD);
    await auth.logout(session.tokens.accessToken);
    await expect(auth.resolve(session.tokens.accessToken)).resolves.toBeNull();
    // Signing out twice, or with an invented token, is not an error.
    await expect(auth.logout(session.tokens.accessToken)).resolves.toBeUndefined();
    await expect(auth.logout('not-a-real-token')).resolves.toBeUndefined();
  });

  it('rejects unknown, malformed and expired tokens', async () => {
    await expect(auth.resolve('not-a-real-token')).resolves.toBeNull();
    await expect(auth.resolve('')).resolves.toBeNull();

    const emailAddress = await createAccount('expired-session');
    const session = await auth.login(emailAddress, PASSWORD);
    await pool.query(
      `update public.auth_sessions set expires_at = now() - interval '1 second'
        where user_id = $1`,
      [session.userId],
    );
    await expect(auth.resolve(session.tokens.accessToken)).resolves.toBeNull();
  });

  it('never stores a token in clear', async () => {
    const emailAddress = await createAccount('hashed-token');
    const session = await auth.login(emailAddress, PASSWORD);
    const rows = await pool.query<{ hit: boolean }>(
      `select exists (
         select 1 from public.auth_sessions
          where secret_hash = convert_to($1, 'UTF8')
             or refresh_hash = convert_to($2, 'UTF8')) as hit`,
      [session.tokens.accessToken, session.tokens.refreshToken],
    );
    expect(rows.rows[0]?.hit).toBe(false);
  });
});

describe('password recovery', () => {
  it('resets the password and ends every session', async () => {
    const emailAddress = await createAccount('reset');
    const session = await auth.login(emailAddress, PASSWORD);

    await auth.requestPasswordReset(emailAddress);
    await auth.resetPassword(emailAddress, latestCode(emailAddress), NEW_PASSWORD);

    await expect(auth.resolve(session.tokens.accessToken)).resolves.toBeNull();
    await expect(auth.login(emailAddress, PASSWORD)).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
    const afterReset = await auth.login(emailAddress, NEW_PASSWORD);
    expect(afterReset.userId).toBe(session.userId);
  });

  it('answers the same way for an unknown address and sends nothing', async () => {
    const before = sent.length;
    await expect(auth.requestPasswordReset(address('nobody'))).resolves.toBeUndefined();
    expect(sent.length).toBe(before);
  });

  it('refuses a weak new password before consuming the code', async () => {
    const emailAddress = await createAccount('weak');
    await auth.requestPasswordReset(emailAddress);
    const code = latestCode(emailAddress);
    await expect(auth.resetPassword(emailAddress, code, 'short')).rejects.toMatchObject({
      failure: 'weak_password',
    });
    // The code is still usable, so the failure did not burn it.
    await expect(auth.resetPassword(emailAddress, code, NEW_PASSWORD)).resolves.toBeUndefined();
  });
});

describe('the HTTP surface', () => {
  const config = testConfig({ RATE_LIMIT_MAX: '10000', AUTH_RATE_LIMIT_MAX: '10000' });
  const app = createApp({
    config,
    logger: createLogger(config),
    auth: {
      // Only first-party routes are exercised here; the Supabase fallback is not consulted.
      gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
      accounts: createPostgresAccountStore(pool),
      sessions: auth,
    },
    firstParty: { service: auth },
  });

  /** The stable error code of a refusal, parsed rather than read off an untyped body. */
  function errorCodeOf(body: unknown): string {
    return apiErrorBodySchema.parse(body).error.code;
  }

  it('answers a registration for an existing account exactly like a new one', async () => {
    const fresh = address('http-fresh');
    const existing = await createAccount('http-duplicate');
    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: fresh, password: PASSWORD });
    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: existing, password: PASSWORD });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
  });

  it('throttles repeated sign-ups per address alike, whether or not it has an account', async () => {
    const fresh = address('http-throttle-fresh');
    const existing = await createAccount('http-throttle-existing');
    for (const emailAddress of [fresh, existing]) {
      const first = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: emailAddress, password: PASSWORD });
      const again = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: emailAddress, password: PASSWORD });
      expect(first.status).toBe(202);
      expect(again.status).toBe(429);
      expect(errorCodeOf(again.body)).toBe('rate_limited');
    }
  });

  it('signs in with the emailed code and authorises /me with the opaque token', async () => {
    const emailAddress = address('http-flow');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailAddress, password: PASSWORD, fullName: 'HTTP Customer' });

    const wrong = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: emailAddress, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(errorCodeOf(wrong.body)).toBe('invalid_code');

    const verified = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: emailAddress, code: latestCode(emailAddress) });
    expect(verified.status).toBe(200);
    const session = authSessionSchema.parse(verified.body);

    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    const profile = meResponseSchema.parse(me.body);
    expect(profile.user.email).toBe(emailAddress);
    expect(profile.user.role).toBe('customer');

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    await expect(
      request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
    ).resolves.toMatchObject({ status: 401 });

    const signedOut = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(signedOut.status).toBe(204);
    const afterLogout = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(afterLogout.status).toBe(401);
  });

  it('never reveals whether an address has an account through password recovery', async () => {
    const known = await createAccount('http-known');
    const forKnown = await request(app).post('/api/v1/auth/forgot-password').send({ email: known });
    const forUnknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: address('http-unknown') });
    expect(forKnown.status).toBe(202);
    expect(forUnknown.status).toBe(202);
    expect(forUnknown.body).toEqual(forKnown.body);
  });

  it('advertises no social provider and refuses Google sign-in until it is configured', async () => {
    await expect(request(app).get('/api/v1/auth/providers')).resolves.toMatchObject({
      status: 200,
      body: { google: false },
    });
    const start = await request(app).get('/api/v1/auth/google/start');
    expect(start.status).toBe(503);
    expect(errorCodeOf(start.body)).toBe('oauth_unavailable');
  });

  it('rejects a malformed code before touching the database', async () => {
    const response = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: address('http-malformed'), code: '12ab56' });
    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('validation_failed');
  });
});

describe('degraded dependencies', () => {
  it('reports an outage instead of granting anything when the database is unreachable', async () => {
    const broken = {
      connect: () => Promise.reject(new Error('connection refused')),
    } as unknown as Pool;
    const offline = service({ pool: broken });

    await expect(offline.login(address('anyone'), PASSWORD)).rejects.toMatchObject({
      failure: 'unavailable',
    });
    await expect(offline.resolve('anything')).resolves.toBeNull();
  });

  it('refuses email-dependent work when no sender is configured', async () => {
    const withoutEmail = createAuthService({ pool, email: undefined, codeSecret });
    await expect(
      withoutEmail.register({ email: address('no-smtp'), password: PASSWORD }),
    ).rejects.toMatchObject({ failure: 'email_unavailable' });
  });

  it('never accepts a code minted with a different pepper', async () => {
    const emailAddress = address('pepper');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = latestCode(emailAddress);
    const otherServer = service({ secret: 'a completely different pepper value 32+' });
    await expect(otherServer.verifyEmail(emailAddress, code)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
  });
});

describe('the Google relay', () => {
  const config = testConfig({ RATE_LIMIT_MAX: '10000', AUTH_RATE_LIMIT_MAX: '10000' });
  // The IdP half is replaced; everything the API does around it is the real code path.
  let googleAccountId = '';
  const google = {
    start: (returnTo: string) =>
      Promise.resolve({
        url: `https://accounts.google.com/o/oauth2/v2/auth?mock=1&returnTo=${encodeURIComponent(returnTo)}`,
      }),
    finish: (query: Record<string, unknown>) =>
      query.code === 'good-code'
        ? Promise.resolve({ userId: googleAccountId, returnTo: '/checkout' })
        : Promise.reject(new AuthError('invalid_credentials')),
  };

  const app = createApp({
    config,
    logger: createLogger(config),
    auth: {
      gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
      accounts: createPostgresAccountStore(pool),
      sessions: auth,
    },
    firstParty: { service: auth, google },
  });

  beforeAll(async () => {
    const email = await createAccount('google-relay');
    const row = await pool.query<{ id: string }>(
      'select id from public.profiles where email = $1',
      [email],
    );
    googleAccountId = row.rows[0]?.id ?? '';
  });

  it('advertises Google when the controller is configured', async () => {
    await expect(request(app).get('/api/v1/auth/providers')).resolves.toMatchObject({
      status: 200,
      body: { google: true },
    });
  });

  it('handles the browser callback and returns a usable session', async () => {
    const response = await request(app).get(
      '/api/v1/auth/google/callback?code=good-code&state=signed-state',
    );

    expect(response.status).toBe(200);
    const signIn = googleSignInResponseSchema.parse(response.body);
    expect(signIn.returnTo).toBe('/checkout');
    const session = authSessionSchema.parse(response.body);
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('relays a callback posted by a web app server-side', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google/callback')
      .send({ code: 'good-code', state: 'signed-state' });

    expect(response.status).toBe(200);
    const session = authSessionSchema.parse(response.body);
    expect(session.tokenType).toBe('bearer');
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('never returns tokens to a browser that lands on the callback', async () => {
    const response = await request(app)
      .get('/api/v1/auth/google/callback?code=good-code&state=signed-state')
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('oauth_unavailable');
    expect(JSON.stringify(response.body)).not.toContain('accessToken');
  });

  it('accepts the iss parameter a relay forwards (RFC 9207)', async () => {
    const response = await request(app).post('/api/v1/auth/google/callback').send({
      code: 'good-code',
      state: 'signed-state',
      iss: 'https://accounts.google.com',
    });

    expect(response.status).toBe(200);
    expect(authSessionSchema.parse(response.body).tokenType).toBe('bearer');
  });

  it('refuses a relay carrying an unknown field, rather than guessing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google/callback')
      .send({ code: 'good-code', state: 'signed-state', redirect_uri: 'https://evil.example' });

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('validation_failed');
  });

  it('refuses a code the provider rejects, and issues no session', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google/callback')
      .send({ code: 'used-code', state: 'signed-state' });

    expect(response.status).toBe(401);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('invalid_credentials');
  });

  it('rejects a relay without a state before the provider is consulted', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google/callback')
      .send({ code: 'good-code' });

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('validation_failed');
  });
});

describe('the native ID-token sign-in', () => {
  const config = testConfig({ RATE_LIMIT_MAX: '10000', AUTH_RATE_LIMIT_MAX: '10000' });

  /** The Google half is replaced; linking, roles and session issuance are the real code. */
  function appWith(identity: GoogleIdentity) {
    return createApp({
      config,
      logger: createLogger(config),
      auth: {
        gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
        accounts: createPostgresAccountStore(pool),
        sessions: auth,
      },
      firstParty: {
        service: auth,
        googleIdToken: createGoogleIdentitySignIn({
          verifier: { verify: () => Promise.resolve(identity) },
          pool,
        }),
      },
    });
  }

  async function postIdToken(app: ReturnType<typeof createApp>, idToken = 'x'.repeat(40)) {
    return request(app).post('/api/v1/auth/google/id-token').send({ idToken });
  }

  async function accountFor(email: string) {
    const row = await pool.query<{ id: string; role: string }>(
      `select p.id, r.role from public.profiles p join public.user_roles r on r.user_id = p.id
        where lower(p.email) = $1`,
      [email],
    );
    return row.rows[0];
  }

  it('creates a customer account for a new verified address and issues a session', async () => {
    const email = address('google-new');
    const app = appWith({
      subject: `google-sub-${run}-new`,
      email,
      emailVerified: true,
      name: 'Google Customer',
    });

    const response = await postIdToken(app);

    expect(response.status).toBe(200);
    const session = authSessionSchema.parse(response.body);
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    const profile = meResponseSchema.parse(me.body);
    expect(profile.user.email).toBe(email);
    // A Google sign-in can only ever create a customer, whatever the token asked for.
    expect(profile.user.role).toBe('customer');
    expect(profile.user.permissions).toEqual([]);
  });

  it('reuses the account that already owns the verified address instead of creating one', async () => {
    const email = await createAccount('google-existing');
    const existing = await accountFor(email);
    const app = appWith({
      subject: `google-sub-${run}-existing`,
      email: email.toUpperCase(),
      emailVerified: true,
    });

    const response = await postIdToken(app);

    expect(response.status).toBe(200);
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${(response.body as { accessToken: string }).accessToken}`);
    const linked = meResponseSchema.parse(me.body);
    expect(linked.user.id).toBe(existing?.id);
    expect(linked.user.role).toBe(existing?.role);
    // Exactly one profile row for that address: nothing was duplicated.
    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from public.profiles where lower(email) = $1',
      [email],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('signs the same Google account in again without creating another profile', async () => {
    const email = address('google-repeat');
    const subject = `google-sub-${run}-repeat`;
    const first = await postIdToken(appWith({ subject, email, emailVerified: true }));
    const second = await postIdToken(appWith({ subject, email, emailVerified: true }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstMe = await request(appWith({ subject, email, emailVerified: true }))
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${(first.body as { accessToken: string }).accessToken}`);
    const secondMe = await request(appWith({ subject, email, emailVerified: true }))
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${(second.body as { accessToken: string }).accessToken}`);
    expect(meResponseSchema.parse(secondMe.body).user.id).toBe(
      meResponseSchema.parse(firstMe.body).user.id,
    );
  });

  it('refuses an address Google has not verified and creates nothing', async () => {
    const email = address('google-unverified');
    const response = await postIdToken(
      appWith({ subject: 'sub-unverified', email, emailVerified: false }),
    );

    expect(response.status).toBe(403);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('email_not_confirmed');
    await expect(accountFor(email)).resolves.toBeUndefined();
  });

  it('refuses an identity with no address at all', async () => {
    const response = await postIdToken(
      appWith({ subject: 'sub-no-email', email: null, emailVerified: true }),
    );

    expect(response.status).toBe(403);
  });

  it('reports a witness rejection as a refused sign-in', async () => {
    const rejecting = createApp({
      config,
      logger: createLogger(config),
      auth: {
        gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
        accounts: createPostgresAccountStore(pool),
        sessions: auth,
      },
      firstParty: {
        service: auth,
        googleIdToken: createGoogleIdentitySignIn({
          verifier: { verify: () => Promise.reject(new AuthError('invalid_credentials')) },
          pool,
        }),
      },
    });

    const response = await postIdToken(rejecting);

    expect(response.status).toBe(401);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('invalid_credentials');
  });

  it('rejects a body with extra fields before any verification', async () => {
    const response = await request(
      appWith({ subject: 's', email: address('x'), emailVerified: true }),
    )
      .post('/api/v1/auth/google/id-token')
      .send({ idToken: 'x'.repeat(40), email: 'attacker@example.test' });

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('validation_failed');
  });
});
