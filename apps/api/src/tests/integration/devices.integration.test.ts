import { createHmac, randomUUID } from 'node:crypto';
import {
  apiErrorBodySchema,
  authSessionSchema,
  deviceRegistrationResponseSchema,
  type AppRole,
} from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app';
import { createLogger } from '../../logging/logger';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createSupabaseDeviceStore } from '../../modules/devices/store';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';

/*
 * Push-device registration against the local Supabase stack: the real SECURITY DEFINER
 * functions, the closed device_tokens table and real sign-in. Each run creates its own
 * accounts (@example.com) and unique tokens, relies on no seed data, and removes
 * everything it created afterwards. FCM itself is not involved (delivery is a later
 * phase); only the stored tokens are exercised.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
});
const clients = createSupabaseClients(config.supabase);
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    accounts: createSupabaseAccountStore(clients),
  },
  devices: createSupabaseDeviceStore(clients),
});

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
const emailFor = (label: string) => `it-${run}-${label}@example.com`;
/** A unique, well-formed push token (letters, digits and hyphens, 20+ characters). */
const tokenFor = (label: string) => `it-${run}-${label}-push-token-0000`;

type Who = 'alice' | 'bob' | 'cara' | 'dana' | 'staff' | 'admin' | 'held';
const ROLES: Record<Who, AppRole> = {
  alice: 'customer',
  bob: 'customer',
  cara: 'customer',
  dana: 'customer',
  staff: 'staff',
  admin: 'admin',
  held: 'customer',
};
const accounts = {} as Record<Who, { id: string; email: string; token: string }>;

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

function register(who: Who | undefined, body: object) {
  const pending = request(app).post('/api/v1/me/devices');
  return (who ? pending.set('Authorization', `Bearer ${accounts[who].token}`) : pending).send(body);
}

function remove(who: Who | undefined, token: string) {
  const pending = request(app).post('/api/v1/me/devices/remove');
  return (who ? pending.set('Authorization', `Bearer ${accounts[who].token}`) : pending).send({
    token,
  });
}

/** The stored rows for a token, read with the service role (as the sender will). */
async function rowsOf(token: string) {
  const { data, error } = await clients.admin
    .from('device_tokens')
    .select('id, user_id, token, platform, app_version, invalidated_at, last_seen_at')
    .eq('token', token);
  if (error) throw error;
  return data;
}

/** The tokens the notification sender may use right now, through its service-role function. */
async function deliverable(who?: Who) {
  const { data, error } = await clients.admin.rpc(
    'deliverable_device_tokens',
    who ? { p_user_id: accounts[who].id } : {},
  );
  if (error) throw error;
  return data;
}

/** Whether the sender may use this very token right now (other tokens of the account are ignored). */
async function isDeliverable(who: Who, token: string): Promise<boolean> {
  return (await deliverable(who)).some((row) => row.token === token);
}

/** The claims of an access token (read only; the token was just issued by Supabase Auth). */
function claimsOf(accessToken: string): Record<string, unknown> {
  const [, payload = ''] = accessToken.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
}

/** A fresh sign-in through the API: its own Auth session, with the session id in its token. */
async function signIn(who: Who) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: accounts[who].email, password: PASSWORD });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const session = authSessionSchema.parse(response.body);
  const sessionId = claimsOf(session.accessToken).session_id;
  if (typeof sessionId !== 'string') throw new Error('the access token carries no session id');
  return { ...session, sessionId };
}

function registerWith(accessToken: string, body: object) {
  return request(app)
    .post('/api/v1/me/devices')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
}

function logout(accessToken: string) {
  return request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
}

async function tokensOf(who: Who): Promise<string[]> {
  const { data, error } = await clients.admin
    .from('device_tokens')
    .select('token')
    .eq('user_id', accounts[who].id)
    .order('last_seen_at');
  if (error) throw error;
  return data.map((row) => row.token);
}

async function usersOfThisRun() {
  const { data, error } = await clients.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.filter((user) => user.email?.startsWith(`it-${run}-`));
}

/** A confirmed account whose role is seeded by the service role (a trusted fixture write). */
async function account(who: Who) {
  const email = emailFor(who);
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  if (ROLES[who] !== 'customer') {
    const seeded = await clients.admin
      .from('user_roles')
      .update({ role: ROLES[who] })
      .eq('user_id', data.user.id);
    if (seeded.error) throw seeded.error;
  }
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  accounts[who] = {
    id: data.user.id,
    email,
    token: authSessionSchema.parse(login.body).accessToken,
  };
}

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) await account(who);
});

afterAll(async () => {
  const userIds = (await usersOfThisRun()).map((user) => user.id);
  // Tokens first (they would also cascade with the accounts), then the accounts.
  if (userIds.length > 0) {
    const tokens = await clients.admin.from('device_tokens').delete().in('user_id', userIds);
    if (tokens.error) throw tokens.error;
  }
  const leftovers: string[] = [];
  for (const userId of userIds) {
    const { error } = await clients.admin.auth.admin.deleteUser(userId);
    if (error) leftovers.push(userId);
  }
  if (leftovers.length > 0) throw new Error(`${leftovers.length} test users could not be deleted`);
});

describe('registering a device', () => {
  it('stores the token for the caller and answers with the device id only', async () => {
    const token = tokenFor('first');
    const response = await register('alice', {
      token: `  ${token} `,
      platform: 'android',
      appVersion: '1.0.0',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { device } = deviceRegistrationResponseSchema.parse(response.body);
    expect(response.body).toStrictEqual({ device: { id: device.id } });
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(await rowsOf(token)).toMatchObject([
      {
        id: device.id,
        user_id: accounts.alice.id,
        platform: 'android',
        app_version: '1.0.0',
        invalidated_at: null,
      },
    ]);
  });

  it('refreshes the same device on re-registration and revives a token marked dead', async () => {
    const token = tokenFor('refresh');
    const first = await register('alice', { token, platform: 'android', appVersion: '1.0.0' });
    const [before] = await rowsOf(token);
    await clients.admin
      .from('device_tokens')
      .update({ invalidated_at: new Date().toISOString() })
      .eq('token', token);
    const again = await register('alice', { token, platform: 'ios', appVersion: '1.1.0' });
    const rows = await rowsOf(token);

    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual(first.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: 'ios', app_version: '1.1.0', invalidated_at: null });
    expect(Date.parse(rows[0]?.last_seen_at ?? '')).toBeGreaterThan(
      Date.parse(before?.last_seen_at ?? ''),
    );
  });

  it('lets customers, staff and admins register, and records no audit entry', async () => {
    for (const who of ['bob', 'staff', 'admin'] as const) {
      const response = await register(who, { token: tokenFor(`role-${who}`), platform: 'ios' });
      expect(response.status, who).toBe(200);
    }
    const audit = await clients.admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in(
        'actor_id',
        Object.values(accounts).map((entry) => entry.id),
      );
    expect(audit.count).toBe(0);
  });

  it.each([
    ['a short token', { token: 'short-token', platform: 'android' }],
    ['a token over 1,024 characters', { token: 'a'.repeat(1025), platform: 'android' }],
    ['a token with a space', { token: `it-${run} spaced-push-token-000`, platform: 'android' }],
    ['an unknown platform', { token: tokenFor('badplatform'), platform: 'windows' }],
    [
      'a body naming an owner',
      { token: tokenFor('owner'), platform: 'android', userId: randomUUID() },
    ],
  ])('rejects %s, storing nothing', async (_label, body) => {
    const response = await register('alice', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(await rowsOf(tokenFor('badplatform'))).toEqual([]);
    expect(await rowsOf(tokenFor('owner'))).toEqual([]);
  });

  it('refuses a signed-out caller on both routes', async () => {
    const token = tokenFor('anonymous');
    const registered = await register(undefined, { token, platform: 'android' });
    const removed = await remove(undefined, token);

    for (const response of [registered, removed]) {
      expect(response.status).toBe(401);
      expect(errorOf(response.body).code).toBe('unauthenticated');
    }
    expect(await rowsOf(token)).toEqual([]);
  });
});

describe('the database is the boundary', () => {
  it('keeps the table and the functions closed to anon and signed-in callers', async () => {
    const token = tokenFor('direct');
    const asAlice = clients.asUser(accounts.alice.token);
    const anon = clients.public();

    expect((await asAlice.from('device_tokens').select('token')).error?.code).toBe('42501');
    expect(
      (
        await asAlice
          .from('device_tokens')
          .insert({ user_id: accounts.alice.id, token, platform: 'android' })
      ).error?.code,
    ).toBe('42501');
    expect(
      (await asAlice.from('device_tokens').delete().eq('user_id', accounts.alice.id)).error?.code,
    ).toBe('42501');
    expect((await anon.from('device_tokens').select('token')).error?.code).toBe('42501');
    expect(
      (await anon.rpc('register_device_token', { p_token: token, p_platform: 'android' })).error
        ?.code,
    ).toBe('42501');
    expect((await anon.rpc('unregister_device_token', { p_token: token })).error?.code).toBe(
      '42501',
    );
    // The sender's function is for the service role only.
    expect((await asAlice.rpc('deliverable_device_tokens')).error?.code).toBe('42501');
    expect((await anon.rpc('deliverable_device_tokens')).error?.code).toBe('42501');
    expect(await rowsOf(token)).toEqual([]);
  });

  it('refuses what the API would never send (the functions check again)', async () => {
    const asAlice = clients.asUser(accounts.alice.token);
    const tooShort = await asAlice.rpc('register_device_token', {
      p_token: 'short-token',
      p_platform: 'android',
    });
    const badCharacters = await asAlice.rpc('register_device_token', {
      p_token: 'token with spaces 0123456789',
      p_platform: 'android',
    });

    const tooLong = await asAlice.rpc('register_device_token', {
      p_token: 'a'.repeat(1025),
      p_platform: 'android',
    });

    expect(tooShort.error?.code).toBe('NZ412');
    expect(badCharacters.error?.code).toBe('NZ412');
    expect(tooLong.error?.code).toBe('NZ412');
  });

  it('accepts a token of exactly 1,024 characters', async () => {
    const token = `it-${run}-`.padEnd(1024, 'x');
    const response = await register('alice', { token, platform: 'android' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowsOf(token)).toHaveLength(1);
    expect((await remove('alice', token)).status).toBe(204);
  });

  it('refuses an access token that carries no session id, and never delivers a made-up session', async () => {
    // Validly signed, so the database accepts the token itself; Supabase Auth's own tokens
    // always carry a session id, so this stands in for anything that does not.
    const forge = (extraClaims: object) => {
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const header = encode({ alg: 'HS256', typ: 'JWT' });
      const payload = encode({
        sub: accounts.alice.id,
        role: 'authenticated',
        aud: 'authenticated',
        iat: now,
        exp: now + 600,
        ...extraClaims,
      });
      const signature = createHmac('sha256', local.jwtSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');
      return `${header}.${payload}.${signature}`;
    };
    const sessionless = tokenFor('sessionless');
    const invented = tokenFor('invented-session');

    const refused = await clients
      .asUser(forge({}))
      .rpc('register_device_token', { p_token: sessionless, p_platform: 'android' });
    const control = await clients
      .asUser(forge({ session_id: randomUUID() }))
      .rpc('register_device_token', { p_token: invented, p_platform: 'android' });

    expect(refused.error?.code).toBe('NZ412');
    expect(await rowsOf(sessionless)).toEqual([]);
    // The same token with a session claim registers, but no such session exists to deliver to.
    expect(control.error).toBeNull();
    expect(await rowsOf(invented)).toHaveLength(1);
    expect(await isDeliverable('alice', invented)).toBe(false);
  });
});

describe('tokens follow the session that registered them', () => {
  it('is deliverable only while its session lives: register, refresh, then sign out through the API', async () => {
    const session = await signIn('dana');
    const token = tokenFor('session');

    const registered = await registerWith(session.accessToken, { token, platform: 'android' });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    expect(await rowsOf(token)).toMatchObject([{ user_id: accounts.dana.id }]);
    const stored = await clients.admin
      .from('device_tokens')
      .select('session_id')
      .eq('token', token)
      .single();
    expect(stored.data?.session_id).toBe(session.sessionId);
    expect((await deliverable('dana')).find((row) => row.token === token)).toStrictEqual({
      id: deviceRegistrationResponseSchema.parse(registered.body).device.id,
      user_id: accounts.dana.id,
      token,
      platform: 'android',
    });

    // Refreshing keeps the same session, so the token stays deliverable.
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const next = authSessionSchema.parse(refreshed.body);
    expect(claimsOf(next.accessToken).session_id).toBe(session.sessionId);
    expect(await isDeliverable('dana', token)).toBe(true);

    // Signing out ends the session: the row remains, but the sender no longer sees it.
    expect((await logout(next.accessToken)).status).toBe(204);
    expect(await isDeliverable('dana', token)).toBe(false);
    expect(await deliverable()).not.toContainEqual(expect.objectContaining({ token }));
    expect(await rowsOf(token)).toHaveLength(1);
  });

  it('moves to the new owner’s session when the phone changes hands', async () => {
    const earlier = await signIn('dana');
    const later = await signIn('bob');
    const token = tokenFor('handover');
    await registerWith(earlier.accessToken, { token, platform: 'android' }).expect(200);
    expect(await isDeliverable('dana', token)).toBe(true);

    // Dana signs out locally only (offline): her session is still alive on the server.
    // Bob then uses the phone and registers the same token.
    await registerWith(later.accessToken, { token, platform: 'android' }).expect(200);
    const row = await clients.admin
      .from('device_tokens')
      .select('user_id, session_id')
      .eq('token', token)
      .single();
    expect(row.data).toStrictEqual({ user_id: accounts.bob.id, session_id: later.sessionId });
    expect(await isDeliverable('dana', token)).toBe(false);
    expect(await isDeliverable('bob', token)).toBe(true);

    // Dana's session ending later changes nothing for Bob; Bob's own ending does.
    expect((await logout(earlier.accessToken)).status).toBe(204);
    expect(await isDeliverable('bob', token)).toBe(true);
    expect((await logout(later.accessToken)).status).toBe(204);
    expect(await isDeliverable('bob', token)).toBe(false);
    expect(await rowsOf(token)).toHaveLength(1);
  });

  it('is tied to the session that registered it, not to the account’s other sessions', async () => {
    const phone = await signIn('dana');
    const laptop = await signIn('dana');
    const token = tokenFor('two-sessions');
    await registerWith(phone.accessToken, { token, platform: 'android' }).expect(200);

    expect((await logout(laptop.accessToken)).status).toBe(204);
    expect(await isDeliverable('dana', token)).toBe(true);
    expect((await logout(phone.accessToken)).status).toBe(204);
    expect(await isDeliverable('dana', token)).toBe(false);
  });

  it('never delivers an old row that has no session, even while the account has live sessions', async () => {
    const legacy = tokenFor('legacy');
    const inserted = await clients.admin
      .from('device_tokens')
      .insert({ user_id: accounts.dana.id, token: legacy, platform: 'android', session_id: null });
    if (inserted.error) throw inserted.error;

    expect(await isDeliverable('dana', legacy)).toBe(false);
    expect(await rowsOf(legacy)).toHaveLength(1);
  });
});

describe('moving a device between accounts', () => {
  it('lets the account now using the device take its token; the previous account cannot remove it', async () => {
    const token = tokenFor('shared');
    const first = await register('alice', { token, platform: 'android' });
    const taken = await register('bob', { token, platform: 'android', appVersion: '2.0.0' });

    expect(taken.status).toBe(200);
    expect(taken.body).toStrictEqual(first.body);
    expect(await rowsOf(token)).toMatchObject([{ user_id: accounts.bob.id, app_version: '2.0.0' }]);

    const byPrevious = await remove('alice', token);
    const unknown = await remove('alice', tokenFor('never-registered'));
    expect(byPrevious.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(byPrevious.text).toBe(unknown.text);
    expect(await rowsOf(token)).toMatchObject([{ user_id: accounts.bob.id }]);

    const byOwner = await remove('bob', token);
    const again = await remove('bob', token);
    expect(byOwner.status).toBe(204);
    expect(byOwner.headers['cache-control']).toBe('no-store');
    expect(again.status).toBe(204);
    expect(await rowsOf(token)).toEqual([]);
  });
});

describe('the per-account cap', () => {
  it('keeps the ten most recently seen devices', async () => {
    const tokens = Array.from({ length: 12 }, (_, index) =>
      tokenFor(`cap-${String(index + 1).padStart(2, '0')}`),
    );
    for (const token of tokens) {
      expect((await register('cara', { token, platform: 'android' })).status).toBe(200);
    }

    const kept = await tokensOf('cara');
    expect(kept).toHaveLength(10);
    expect(kept).toEqual(tokens.slice(2));
    // Seeing an old device again protects it; the next least recently seen is forgotten.
    await register('cara', { token: tokens[2] ?? '', platform: 'android' });
    await register('cara', { token: tokenFor('cap-13'), platform: 'android' });
    const afterwards = await tokensOf('cara');
    expect(afterwards).toHaveLength(10);
    expect(afterwards).toContain(tokens[2]);
    expect(afterwards).not.toContain(tokens[3]);
    expect(afterwards.at(-1)).toBe(tokenFor('cap-13'));
  });

  it('cannot be raced past by simultaneous registrations', async () => {
    // Straight at the function, so the calls overlap as much as they can.
    const asStaff = clients.asUser(accounts.staff.token);
    const tokens = Array.from({ length: 40 }, (_, index) =>
      tokenFor(`race-${String(index).padStart(2, '0')}`),
    );
    const results = await Promise.all(
      tokens.map((token) =>
        asStaff.rpc('register_device_token', { p_token: token, p_platform: 'android' }),
      ),
    );

    expect(results.map((result) => result.error)).toEqual(tokens.map(() => null));
    // 40 new devices on top of the one registered earlier: exactly the cap remains.
    expect(await tokensOf('staff')).toHaveLength(10);
  });
});

describe('suspended accounts', () => {
  it('cannot register once suspended, at the API or in the database', async () => {
    const token = tokenFor('held');
    expect((await register('held', { token, platform: 'android' })).status).toBe(200);
    const suspended = await clients.admin
      .from('profiles')
      .update({ status: 'suspended' })
      .eq('id', accounts.held.id);
    if (suspended.error) throw suspended.error;

    const viaApi = await register('held', { token: tokenFor('held-2'), platform: 'android' });
    const removal = await remove('held', token);
    // The access token is still valid, so this reaches the function itself.
    const viaRpc = await clients
      .asUser(accounts.held.token)
      .rpc('register_device_token', { p_token: tokenFor('held-3'), p_platform: 'android' });

    expect(viaApi.status).toBe(403);
    expect(errorOf(viaApi.body).code).toBe('account_suspended');
    expect(removal.status).toBe(403);
    expect(viaRpc.error?.code).toBe('NZ403');
    expect(await rowsOf(tokenFor('held-2'))).toEqual([]);
    expect(await rowsOf(tokenFor('held-3'))).toEqual([]);
  });
});

describe('deleting an account', () => {
  it('deletes its tokens with it', async () => {
    const email = emailFor('leaving');
    const created = await clients.admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    const token = tokenFor('leaving');
    await request(app)
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${authSessionSchema.parse(login.body).accessToken}`)
      .send({ token, platform: 'android' })
      .expect(200);
    expect(await rowsOf(token)).toHaveLength(1);

    const deleted = await clients.admin.auth.admin.deleteUser(created.data.user.id);
    expect(deleted.error).toBeNull();
    expect(await rowsOf(token)).toEqual([]);
  });
});
