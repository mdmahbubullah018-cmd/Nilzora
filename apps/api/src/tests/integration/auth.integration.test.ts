import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ApiError, createApiClient } from '@nilzora/api-client';
import {
  apiErrorBodySchema,
  authSessionSchema,
  meResponseSchema,
  registerResponseSchema,
  type AppRole,
} from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app';
import { createLogger } from '../../logging/logger';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';

/*
 * Real integration tests: the API talks to the local Supabase Auth server and to
 * PostgreSQL through PostgREST, with the migrations' RLS policies in force. Each
 * run creates uniquely named accounts (@example.com) and deletes them afterwards.
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
});

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
const emailFor = (label: string) => `it-${run}-${label}@example.com`;

async function usersOfThisRun() {
  const { data, error } = await clients.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.filter((user) => user.email?.startsWith(`it-${run}-`));
}

async function userIdFor(email: string): Promise<string | undefined> {
  return (await usersOfThisRun()).find((user) => user.email === email)?.id;
}

/** Test fixture: a confirmed account, optionally with a role seeded by the service role. */
async function createUser(label: string, role: AppRole = 'customer') {
  const email = emailFor(label);
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  if (role !== 'customer') {
    const seeded = await clients.admin
      .from('user_roles')
      .update({ role })
      .eq('user_id', data.user.id);
    if (seeded.error) throw seeded.error;
  }
  return { id: data.user.id, email };
}

async function login(email: string) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return authSessionSchema.parse(response.body);
}

async function storedRole(userId: string) {
  const { data, error } = await clients.admin
    .from('user_roles')
    .select('role, granted_by')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

function errorCode(body: unknown): string {
  return apiErrorBodySchema.parse(body).error.code;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

afterAll(async () => {
  const users = await usersOfThisRun();
  // Role changes are audited (assign_user_role); their entries go before the accounts.
  if (users.length > 0) {
    const audit = await clients.admin
      .from('audit_log')
      .delete()
      .in(
        'actor_id',
        users.map((user) => user.id),
      );
    if (audit.error) throw audit.error;
  }
  for (const user of users) {
    await clients.admin.auth.admin.deleteUser(user.id);
  }
});

describe('registration (real Supabase Auth + signup trigger)', () => {
  it('creates a customer with a normalised profile and answers duplicates identically', async () => {
    const email = emailFor('register');
    const body = { email, password: PASSWORD, fullName: 'Rahima Khatun', phone: '01712-345678' };

    const first = await request(app).post('/api/v1/auth/register').send(body);
    // Immediately again: Supabase Auth is inside its confirmation-resend cooldown.
    const second = await request(app).post('/api/v1/auth/register').send(body);

    expect(first.status).toBe(202);
    expect(registerResponseSchema.parse(first.body).status).toBe('accepted');
    expect(second.status).toBe(202);
    expect(second.body).toStrictEqual(first.body);

    const matching = (await usersOfThisRun()).filter((user) => user.email === email);
    expect(matching).toHaveLength(1);
    const userId = matching[0]?.id ?? '';

    await clients.admin.auth.admin.updateUserById(userId, { email_confirm: true });
    const confirmed = await request(app).post('/api/v1/auth/register').send(body);
    expect(confirmed.status).toBe(202);
    expect(confirmed.body).toStrictEqual(first.body);
    expect((await storedRole(userId)).role).toBe('customer');
    const { data: profile } = await clients.admin
      .from('profiles')
      .select('full_name, phone, status')
      .eq('id', userId)
      .single();
    expect(profile).toStrictEqual({
      full_name: 'Rahima Khatun',
      phone: '+8801712345678',
      status: 'active',
    });
  });

  it('rejects a registration that names a role and creates no account', async () => {
    const email = emailFor('role-injection');
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, role: 'super_admin' });

    expect(response.status).toBe(400);
    expect(await userIdFor(email)).toBeUndefined();
  });

  it('keeps direct Supabase sign-ups (bypassing the API) as customers', async () => {
    const email = emailFor('direct-signup');
    const { error } = await clients.public().auth.signUp({
      email,
      password: PASSWORD,
      options: {
        data: { role: 'super_admin', app_role: 'admin', full_name: 'Direct', phone: 'x' },
      },
    });
    expect(error).toBeNull();

    const userId = await userIdFor(email);
    expect(userId).toBeDefined();
    expect((await storedRole(userId ?? '')).role).toBe('customer');
  });

  it('requires a confirmed email before issuing tokens', async () => {
    const email = emailFor('unconfirmed');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(202);

    const before = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(before.status).toBe(403);
    expect(errorCode(before.body)).toBe('email_not_confirmed');

    const userId = (await userIdFor(email)) ?? '';
    await clients.admin.auth.admin.updateUserById(userId, { email_confirm: true });
    const session = await login(email);
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(meResponseSchema.parse(me.body).user).toMatchObject({ id: userId, role: 'customer' });
  });
});

describe('sessions and tokens (real Supabase Auth)', () => {
  it('rejects wrong passwords and unknown emails with the same answer', async () => {
    const { email } = await createUser('password-check');
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'not-the-password1' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailFor('nobody'), password: 'not-the-password1' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(errorCode(wrong.body)).toBe('invalid_credentials');
    expect(apiErrorBodySchema.parse(unknown.body).error.message).toBe(
      apiErrorBodySchema.parse(wrong.body).error.message,
    );
  });

  it('serves the verified caller, and updates only their own profile', async () => {
    const customer = await createUser('profile-owner');
    const other = await createUser('profile-other');
    const session = await login(customer.email);
    const auth = `Bearer ${session.accessToken}`;

    const me = await request(app).get(`/api/v1/me?userId=${other.id}`).set('Authorization', auth);
    expect(meResponseSchema.parse(me.body).user).toMatchObject({
      id: customer.id,
      email: customer.email,
      role: 'customer',
      permissions: [],
    });

    const updated = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', auth)
      .send({ fullName: 'Rahim Uddin', phone: '01912345678' });
    expect(meResponseSchema.parse(updated.body).user.profile).toMatchObject({
      fullName: 'Rahim Uddin',
      phone: '+8801912345678',
    });

    const smuggled = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', auth)
      .send({ id: other.id, fullName: 'Hijacked' });
    expect(smuggled.status).toBe(400);
    const { data: otherProfile } = await clients.admin
      .from('profiles')
      .select('full_name')
      .eq('id', other.id)
      .single();
    expect(otherProfile?.full_name).toBeNull();
  });

  it('rotates refresh tokens and revokes the session on logout', async () => {
    const { email } = await createUser('logout');
    const session = await login(email);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const rotated = authSessionSchema.parse(refreshed.body);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${rotated.accessToken}`);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`);
    expect(afterLogout.status).toBe(401);
    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
    expect(errorCode(refreshAfterLogout.body)).toBe('invalid_refresh_token');
  });

  it('fails closed on forged, tampered and malformed tokens', async () => {
    const customer = await createUser('forgery');
    const victim = await createUser('forgery-victim', 'admin');
    const session = await login(customer.email);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: victim.id,
      email: victim.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 3600,
      session_id: randomUUID(),
    };

    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    const payload = base64url(claims);
    const signature = createHmac('sha256', local.jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const [realHeader, , realSignature] = session.accessToken.split('.');

    const tokens = {
      'signed with the legacy shared secret': `${header}.${payload}.${signature}`,
      'with alg none': `${base64url({ alg: 'none', typ: 'JWT' })}.${payload}.`,
      'with a swapped payload': `${realHeader}.${payload}.${realSignature}`,
      'that is random': randomUUID(),
    };

    for (const [label, token] of Object.entries(tokens)) {
      const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
      expect(response.status, label).toBe(401);
      expect(errorCode(response.body), label).toBe('unauthenticated');
    }
  });

  it('refuses suspended accounts, even with a session issued before suspension', async () => {
    const { id, email } = await createUser('suspended');
    const session = await login(email);
    await clients.admin.from('profiles').update({ status: 'suspended' }).eq('id', id);

    const existing = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(existing.status).toBe(403);
    expect(errorCode(existing.body)).toBe('account_suspended');

    const fresh = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(fresh.status).toBe(403);
    expect(errorCode(fresh.body)).toBe('account_suspended');
  });
});

describe('role assignment (real database rules)', () => {
  it('lets owners and admins assign roles only within their authority', async () => {
    const owner = await createUser('owner', 'super_admin');
    const admin = await createUser('admin', 'admin');
    const staff = await createUser('staff', 'staff');
    const moderator = await createUser('moderator', 'moderator');
    const customer = await createUser('customer');
    const target = await createUser('target');

    const tokens = {
      owner: (await login(owner.email)).accessToken,
      admin: (await login(admin.email)).accessToken,
      staff: (await login(staff.email)).accessToken,
      moderator: (await login(moderator.email)).accessToken,
      customer: (await login(customer.email)).accessToken,
    };
    const assign = (as: keyof typeof tokens, userId: string, role: AppRole) =>
      request(app)
        .put(`/api/v1/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${tokens[as]}`)
        .send({ role });

    for (const caller of ['customer', 'moderator', 'staff'] as const) {
      const denied = await assign(caller, target.id, 'admin');
      expect(denied.status, caller).toBe(403);
      expect(errorCode(denied.body), caller).toBe('forbidden');
    }
    expect((await storedRole(target.id)).role).toBe('customer');

    // Only the owner assigns roles: an admin holding staff.roles.assign is refused.
    const byAdmin = await assign('admin', target.id, 'staff');
    expect(byAdmin.status).toBe(403);
    expect(errorCode(byAdmin.body)).toBe('forbidden');
    expect((await storedRole(target.id)).role).toBe('customer');

    expect((await assign('admin', customer.id, 'admin')).status).toBe(403);
    expect((await assign('admin', owner.id, 'customer')).status).toBe(403);
    expect((await assign('owner', customer.id, 'super_admin')).status).toBe(403);
    expect((await assign('owner', owner.id, 'customer')).status).toBe(403);
    expect((await assign('owner', randomUUID(), 'staff')).status).toBe(404);

    const promoted = await assign('owner', target.id, 'staff');
    expect(promoted.status).toBe(200);
    expect(await storedRole(target.id)).toStrictEqual({ role: 'staff', granted_by: owner.id });

    const appointed = await assign('owner', customer.id, 'admin');
    expect(appointed.status).toBe(200);
    expect((await storedRole(customer.id)).role).toBe('admin');

    // The new role applies to the target's next request; it is read from the database.
    const targetSession = await login(target.email);
    const targetMe = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${targetSession.accessToken}`);
    expect(meResponseSchema.parse(targetMe.body).user).toMatchObject({ role: 'staff' });
    expect(meResponseSchema.parse(targetMe.body).user.permissions).toContain('orders.read');
  });
});

describe('direct Data API access (RLS enforced by PostgreSQL)', () => {
  it('confines a signed-in user to their own rows and editable columns', async () => {
    const user = await createUser('rls-user');
    const other = await createUser('rls-other');
    const { accessToken } = await login(user.email);
    const asUser = clients.asUser(accessToken);

    const profiles = await asUser.from('profiles').select('id');
    expect(profiles.error).toBeNull();
    expect(profiles.data?.map((row) => row.id)).toEqual([user.id]);

    const hijack = await asUser
      .from('profiles')
      .update({ full_name: 'Hijacked' })
      .eq('id', other.id)
      .select('id');
    expect(hijack.data).toEqual([]);

    const ownStatus = await asUser
      .from('profiles')
      .update({ status: 'suspended' })
      .eq('id', user.id);
    expect(ownStatus.error?.code).toBe('42501');

    const ownRole = await asUser
      .from('user_roles')
      .update({ role: 'super_admin' })
      .eq('user_id', user.id);
    expect(ownRole.error?.code).toBe('42501');

    const insertRole = await asUser.from('user_roles').insert({ user_id: other.id, role: 'admin' });
    expect(insertRole.error?.code).toBe('42501');

    const rpc = await asUser.rpc('assign_user_role', {
      p_actor_id: user.id,
      p_target_id: user.id,
      p_role: 'super_admin',
    });
    expect(rpc.error?.code).toBe('42501');

    expect((await storedRole(user.id)).role).toBe('customer');
  });

  it('gives anonymous callers no access to identity tables', async () => {
    const anon = clients.public();
    const profiles = await anon.from('profiles').select('id');
    const roles = await anon.from('user_roles').select('role');

    expect(profiles.error?.code).toBe('42501');
    expect(roles.error?.code).toBe('42501');
  });
});

describe('typed API client against the running API', () => {
  it('drives the whole session lifecycle through @nilzora/api-client', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
      const user = await createUser('typed-client');

      const registered = await api.register({ email: emailFor('typed-new'), password: PASSWORD });
      expect(registered.status).toBe('accepted');

      const session = await api.login({ email: user.email, password: PASSWORD });
      expect((await api.getMe(session.accessToken)).user).toMatchObject({
        id: user.id,
        role: 'customer',
      });
      const updated = await api.updateMe(session.accessToken, { fullName: 'Karim Ahmed' });
      expect(updated.user.profile.fullName).toBe('Karim Ahmed');

      const rotated = await api.refresh(session.refreshToken);
      await api.logout(rotated.accessToken);

      const after = await api.getMe(rotated.accessToken).catch((caught: unknown) => caught);
      expect(after).toBeInstanceOf(ApiError);
      expect(after).toMatchObject({ status: 401, code: 'unauthenticated' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

/** Reads the confirmation link from the email the local Auth server actually sent. */
async function confirmationLink(email: string): Promise<URL> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (
      await fetch(`${local.mailUrl}/api/v1/search?query=${query}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = search.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${local.mailUrl}/api/v1/message/${id}`)).json()) as {
        HTML: string;
      };
      const href = /href="([^"]*\/confirm-email[^"]*)"/.exec(message.HTML)?.[1];
      if (href) return new URL(href.replaceAll('&amp;', '&'));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No confirmation email arrived');
}

describe('email confirmation (real email from the local Auth server)', () => {
  it('links to the storefront with a one-time hash that confirms without signing in', async () => {
    const email = emailFor('confirm-link');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(202);

    const link = await confirmationLink(email);
    expect(`${link.origin}${link.pathname}`).toBe('http://localhost:3000/confirm-email');
    expect(link.hash).toBe('');
    expect(link.href).not.toMatch(/access_token|refresh_token/);
    const tokenHash = link.searchParams.get('token_hash') ?? '';

    const confirmed = await request(app).post('/api/v1/auth/confirm-email').send({ tokenHash });
    expect(confirmed.status).toBe(204);
    expect(confirmed.text).toBe('');

    const replay = await request(app).post('/api/v1/auth/confirm-email').send({ tokenHash });
    expect(replay.status).toBe(400);
    expect(errorCode(replay.body)).toBe('invalid_confirmation_link');

    // The address is confirmed, so the owner signs in with their password.
    const session = await login(email);
    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(meResponseSchema.parse(me.body).user).toMatchObject({ email, role: 'customer' });
  });

  it('rejects a made-up confirmation hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/confirm-email')
      .send({ tokenHash: 'made-up-confirmation-hash-000000' });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('invalid_confirmation_link');
  });
});
