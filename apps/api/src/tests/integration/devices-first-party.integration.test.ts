import { randomUUID } from 'node:crypto';
import { deviceRegistrationResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createAuthService, type AuthService } from '../../auth/first-party';
import { hashPassword } from '../../auth/passwords';
import type { EmailMessage } from '../../auth/sender';
import { createApp } from '../../app';
import { createDatabasePool } from '../../db/pool';
import { createLogger } from '../../logging/logger';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createPostgresDeviceStore } from '../../modules/devices/store';
import { createSupabaseNotificationStore } from '../../modules/notifications/store';
import { createPostgresAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';

/*
 * Push registration for a first-party session, against the local Supabase stack: the real
 * register_device_token() function, the closed device_tokens table and the real session
 * rows. This is the path the mobile app takes, and it used to fail before the database was
 * ever asked: PostgREST answered PGRST301 ("Expected 3 parts in JWT") for the app's opaque
 * token, so the device store now runs over the direct connection with the session bound.
 *
 * Each run creates its own accounts (@example.com) and unique tokens and removes
 * everything it created afterwards. FCM itself is not involved: only the stored tokens.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
});

const pool = createDatabasePool({ connectionString: local.dbUrl, max: 4 });
const clients = createSupabaseClients(config.supabase);
const run = randomUUID().slice(0, 8);
const codeSecret = 'integration-test-code-pepper-at-least-32-chars';

const email = {
  send(message: EmailMessage): Promise<void> {
    void message;
    return Promise.resolve();
  },
  verify(): Promise<void> {
    return Promise.resolve();
  },
};

const auth: AuthService = createAuthService({
  pool,
  email,
  codeSecret,
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
});

const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    // As the server composes it: with a direct connection the account (and its role and
    // permissions) is read there, because a first-party token cannot be sent to PostgREST.
    accounts: createPostgresAccountStore(pool),
    sessions: auth,
  },
  devices: createPostgresDeviceStore(pool),
});

function address(label: string): string {
  return `it-device-fp-${run}-${label}@example.com`;
}

/** A verified account with no email round trip, and a first-party session for it. */
async function account(
  label: string,
): Promise<{ userId: string; token: string; refreshToken: string }> {
  const userId = randomUUID();
  const emailAddress = address(label);
  await pool.query('select public.provision_account($1::uuid, $2, $3, $4, $5, $6)', [
    userId,
    emailAddress,
    `Device ${label}`,
    null,
    await hashPassword('correct horse battery 2026'),
    true,
  ]);
  const session = await auth.createSession(userId);
  return {
    userId,
    token: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken,
  };
}

function register(token: string | undefined, body: object) {
  const pending = request(app).post('/api/v1/me/devices');
  return (token ? pending.set('Authorization', `Bearer ${token}`) : pending).send(body);
}

function remove(token: string, deviceToken: string) {
  return request(app)
    .post('/api/v1/me/devices/remove')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: deviceToken });
}

function tokenOf(label: string): string {
  return `fcm:it-${run}-${label}-value.with~allowed+chars/and=pad`;
}

afterAll(async () => {
  // Sessions, device rows and roles cascade from the profile row.
  await pool.query('delete from public.profiles where email like $1', [`it-device-fp-${run}-%`]);
  await pool.end();
});

describe('a first-party session registering a push device', () => {
  it('stores the token against the caller and the session that registered it', async () => {
    const { userId, token } = await account('happy');
    const deviceToken = tokenOf('happy');

    const response = await register(token, {
      token: deviceToken,
      platform: 'android',
      appVersion: '1.0.0',
    });

    expect(response.status).toBe(200);
    const { device } = deviceRegistrationResponseSchema.parse(response.body);
    const rows = await pool.query<{
      id: string;
      user_id: string;
      session_id: string;
      app_version: string;
    }>('select id, user_id, session_id, app_version from public.device_tokens where token = $1', [
      deviceToken,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: device.id, user_id: userId, app_version: '1.0.0' });

    const resolved = await auth.resolve(token);
    expect(rows.rows[0]?.session_id).toBe(resolved?.sessionId);
    // The session the device is bound to is the caller's own, alive row.
    const session = await pool.query(
      'select 1 from public.auth_sessions where id = $1 and user_id = $2 and revoked_at is null',
      [rows.rows[0]?.session_id, userId],
    );
    expect(session.rows).toHaveLength(1);
  });

  it('refreshes the same row instead of adding a second device', async () => {
    const { token } = await account('refresh');
    const deviceToken = tokenOf('refresh');

    const first = await register(token, { token: deviceToken, platform: 'android' });
    const again = await register(token, {
      token: deviceToken,
      platform: 'android',
      appVersion: '2.0.0',
    });

    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual(first.body);
    const rows = await pool.query<{ app_version: string | null }>(
      'select app_version from public.device_tokens where token = $1',
      [deviceToken],
    );
    expect(rows.rows).toStrictEqual([{ app_version: '2.0.0' }]);
  });

  it('moves a token to the account now using the phone', async () => {
    const first = await account('first');
    const second = await account('second');
    const deviceToken = tokenOf('handover');

    expect((await register(first.token, { token: deviceToken, platform: 'android' })).status).toBe(
      200,
    );
    expect((await register(second.token, { token: deviceToken, platform: 'android' })).status).toBe(
      200,
    );

    const rows = await pool.query<{ user_id: string }>(
      'select user_id from public.device_tokens where token = $1',
      [deviceToken],
    );
    expect(rows.rows).toStrictEqual([{ user_id: second.userId }]);
  });

  it('removes only the caller’s own token, and says nothing when there is none', async () => {
    const mine = await account('mine');
    const other = await account('other');
    const deviceToken = tokenOf('mine');

    await register(mine.token, { token: deviceToken, platform: 'android' });
    expect((await remove(other.token, deviceToken)).status).toBe(204);
    const stillThere = await pool.query('select 1 from public.device_tokens where token = $1', [
      deviceToken,
    ]);
    expect(stillThere.rows).toHaveLength(1);

    expect((await remove(mine.token, deviceToken)).status).toBe(204);
    expect((await remove(mine.token, deviceToken)).status).toBe(204);
    const gone = await pool.query('select 1 from public.device_tokens where token = $1', [
      deviceToken,
    ]);
    expect(gone.rows).toEqual([]);
  });

  it('refuses a session that has been signed out', async () => {
    const { token } = await account('revoked');
    const deviceToken = tokenOf('revoked');

    await auth.logout(token);

    const response = await register(token, { token: deviceToken, platform: 'android' });
    expect(response.status).toBe(401);
    const rows = await pool.query('select 1 from public.device_tokens where token = $1', [
      deviceToken,
    ]);
    expect(rows.rows).toEqual([]);
  });

  it('keeps the device deliverable when a refresh rotates the session', async () => {
    const { userId, token, refreshToken } = await account('rotation');
    const deviceToken = tokenOf('rotation');
    expect((await register(token, { token: deviceToken, platform: 'android' })).status).toBe(200);

    const before = await auth.resolve(token);
    const deliverableBefore = await pool.query<{ token: string }>(
      'select token from public.deliverable_device_tokens($1)',
      [userId],
    );
    expect(deliverableBefore.rows).toEqual([{ token: deviceToken }]);

    // What the app does silently every fifteen minutes: the session is replaced.
    const rotated = await auth.refresh(refreshToken);
    const after = await auth.resolve(rotated.tokens.accessToken);
    expect(after?.userId).toBe(userId);
    expect(after?.sessionId).not.toBe(before?.sessionId);

    // The registration still records the session that made it, and the sender still finds
    // the device: a rotation is not a sign-out.
    const row = await pool.query<{ session_id: string }>(
      'select session_id from public.device_tokens where token = $1',
      [deviceToken],
    );
    expect(row.rows[0]?.session_id).toBe(before?.sessionId);
    const deliverableAfter = await pool.query<{ token: string }>(
      'select token from public.deliverable_device_tokens($1)',
      [userId],
    );
    expect(deliverableAfter.rows).toEqual([{ token: deviceToken }]);

    // What the worker actually asks, through the service key and the RPC.
    const store = createSupabaseNotificationStore(clients);
    const devices = await store.deliverableDevices(userId);
    expect(devices.map((device) => device.token)).toEqual([deviceToken]);
  });

  it('binds the device to the new session when the app registers again after a rotation', async () => {
    const { token, refreshToken } = await account('rebind');
    const deviceToken = tokenOf('rebind');
    await register(token, { token: deviceToken, platform: 'android' });
    const original = await auth.resolve(token);

    const rotated = await auth.refresh(refreshToken);
    expect(
      (
        await register(rotated.tokens.accessToken, {
          token: deviceToken,
          platform: 'android',
        })
      ).status,
    ).toBe(200);

    const rows = await pool.query<{ session_id: string }>(
      'select session_id from public.device_tokens where token = $1',
      [deviceToken],
    );
    const current = await auth.resolve(rotated.tokens.accessToken);
    expect(original?.sessionId).not.toBe(current?.sessionId);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.session_id).toBe(current?.sessionId);
  });

  it('stops delivering a device once its session is signed out', async () => {
    const { userId, token } = await account('signed-out');
    const deviceToken = tokenOf('signed-out');
    expect((await register(token, { token: deviceToken, platform: 'android' })).status).toBe(200);

    await auth.logout(token);

    const deliverable = await pool.query<{ token: string }>(
      'select token from public.deliverable_device_tokens($1)',
      [userId],
    );
    expect(deliverable.rows).toEqual([]);
    // The row stays, undeliverable, so a re-registration can revive it.
    const kept = await pool.query('select 1 from public.device_tokens where token = $1', [
      deviceToken,
    ]);
    expect(kept.rows).toHaveLength(1);
  });
});
