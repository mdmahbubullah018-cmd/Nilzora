import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { withUser } from '../db/user-context';
import { postgresRpc } from '../modules/db-rpc';
import {
  createPostgresDeviceStore,
  type DeviceCaller,
  type DeviceStore,
} from '../modules/devices/store';
import { dbDetail, FakeDevices } from './device-fakes';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';

/*
 * Push registration for a first-party session.
 *
 * The mobile app signs in through the API, so its access token is an opaque first-party
 * token: PostgREST cannot authorise it (PGRST301, "Expected 3 parts in JWT"), and
 * register_device_token() needs a `session_id` claim that no Supabase JWT supplies. The
 * device store therefore runs over the direct connection, inside the transaction
 * `withUser` opens for the caller, with the session the resolver verified.
 *
 * These tests pin both halves: the route forwards the verified session (never one taken
 * from the request) and the direct path puts it in the claim the database reads.
 */

const TOKEN = 'fcm:APA91bHexample-token_value.with~allowed+chars/and=padding';
const OTHER_TOKEN = 'fcm:APA91bHanother-token_value.with~other+chars/and=padding';

function setup() {
  const identity = new FakeIdentity();
  const devices = new FakeDevices(identity);
  const logs = captureLogs('debug');
  const customer = identity.addUser({ email: 'first-party@example.com' });
  const other = identity.addUser({ email: 'someone-else@example.com' });
  const tokens = { customer: identity.tokenFor(customer), other: identity.tokenFor(other) };
  const app = testApp({
    auth: identity.depsWithSessions,
    devices: devices.stores,
    logger: logs.logger,
  });

  const register = (
    token: string | undefined,
    body: object = { token: TOKEN, platform: 'android' },
  ) => {
    const pending = request(app).post('/api/v1/me/devices');
    return (token ? pending.set('Authorization', `Bearer ${token}`) : pending).send(body);
  };

  return { identity, devices, logs, customer, other, tokens, app, register };
}

describe('a first-party session registering a device', () => {
  it('registers it for the signed-in account and binds it to the verified session', async () => {
    const { register, devices, identity, customer, tokens } = setup();

    const response = await register(tokens.customer);

    expect(response.status).toBe(200);
    expect(devices.rows).toMatchObject([
      {
        userId: customer.id,
        token: TOKEN,
        platform: 'android',
        sessionId: identity.sessionIdFor(tokens.customer),
      },
    ]);
    // The device id is all that comes back: never the token, never the session.
    expect(Object.keys(response.body as object)).toStrictEqual(['device']);
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(
      String(identity.sessionIdFor(tokens.customer)),
    );
  });

  it('keeps two accounts’ devices apart', async () => {
    const { register, devices, customer, other, tokens } = setup();

    expect((await register(tokens.customer)).status).toBe(200);
    expect((await register(tokens.other, { token: OTHER_TOKEN, platform: 'android' })).status).toBe(
      200,
    );

    expect(devices.tokensOf(customer.id)).toEqual([TOKEN]);
    expect(devices.tokensOf(other.id)).toEqual([OTHER_TOKEN]);
  });

  it('refreshes the same device instead of adding a second one', async () => {
    const { register, devices, customer, tokens } = setup();

    const first = await register(tokens.customer, {
      token: TOKEN,
      platform: 'android',
      appVersion: '1.0.0',
    });
    const again = await register(tokens.customer, {
      token: TOKEN,
      platform: 'android',
      appVersion: '1.2.0',
    });

    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual(first.body);
    expect(devices.tokensOf(customer.id)).toEqual([TOKEN]);
    expect(devices.rows[0]).toMatchObject({ appVersion: '1.2.0' });
  });

  it('refuses a token whose session has been revoked', async () => {
    const { register, identity, devices, tokens } = setup();
    const session = identity.sessions.get(tokens.customer);
    if (!session) throw new Error('the fake issued no session');
    session.revoked = true;

    const response = await register(tokens.customer);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBeDefined();
    expect(devices.rows).toEqual([]);
  });

  it('refuses a token whose session has expired', async () => {
    const { register, identity, devices, tokens } = setup();
    const session = identity.sessions.get(tokens.customer);
    if (!session) throw new Error('the fake issued no session');
    session.expired = true;

    expect((await register(tokens.customer)).status).toBe(401);
    expect(devices.rows).toEqual([]);
  });

  it('refuses an opaque token that is not a session at all', async () => {
    const { register, devices } = setup();

    const response = await register(`at.${randomUUID()}`);

    expect(response.status).toBe(401);
    expect(devices.rows).toEqual([]);
  });
});

describe('the session a registration is bound to', () => {
  it('refuses a session that belongs to another account', async () => {
    const { devices, identity, customer, tokens } = setup();
    const caller: DeviceCaller = {
      accessToken: tokens.customer,
      userId: customer.id,
      sessionId: identity.sessionIdFor(tokens.other) ?? null,
    };

    await expect(async () =>
      devices.stores.register(caller, { token: TOKEN, platform: 'android' }),
    ).rejects.toMatchObject({ name: 'DeviceRefusalError', refusal: 'invalid_input' });
    expect(devices.rows).toEqual([]);
  });

  it('brings the session into the claims the database reads', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const { pool, statements } = capturingPool(undefined);

    await withUser(pool, userId, (client) => client.query('select 1'), sessionId);

    expect(claimsOf(statements)).toStrictEqual({
      sub: userId,
      role: 'authenticated',
      session_id: sessionId,
    });
  });

  it('brings no session claim when there is no first-party session', async () => {
    const userId = randomUUID();
    const { pool, statements } = capturingPool(undefined);

    // A Supabase JWT carries its own session_id, so the direct path must not invent one.
    await withUser(pool, userId, (client) => client.query('select 1'));

    expect(claimsOf(statements)).toStrictEqual({ sub: userId, role: 'authenticated' });
  });

  it('carries the session through postgresRpc, and only a UUID is accepted', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const { pool, statements } = capturingPool(undefined);

    await postgresRpc(pool)(userId, sessionId)('unregister_device_token', { p_token: TOKEN });

    expect(claimsOf(statements).session_id).toBe(sessionId);
    await expect(
      withUser(pool, userId, (client) => client.query('select 1'), 'not-a-uuid'),
    ).rejects.toThrow(/UUID session id/);
  });
});

describe('the direct device store', () => {
  const caller: DeviceCaller = {
    accessToken: 'opaque-first-party-token',
    userId: randomUUID(),
    sessionId: randomUUID(),
  };

  it('calls register_device_token as the caller and answers the device id', async () => {
    const id = randomUUID();
    const { pool, statements } = capturingPool(id);
    const store: DeviceStore = createPostgresDeviceStore(pool);

    const device = await store.register(caller, {
      token: TOKEN,
      platform: 'android',
      appVersion: '1.0.0',
    });

    expect(device).toStrictEqual({ id });
    const call = statements.find((statement) => statement.sql.includes('register_device_token'));
    expect(call?.sql).toContain('p_token => $1');
    expect(call?.values).toStrictEqual([TOKEN, 'android', '1.0.0']);
    expect(claimsOf(statements).session_id).toBe(caller.sessionId);
  });

  it('maps the database refusals the device way, without the row text that quotes the token', async () => {
    const { pool } = failingPool({ code: 'NZ412', detail: dbDetail(TOKEN) });

    const failure = await createPostgresDeviceStore(pool)
      .register(caller, { token: TOKEN, platform: 'android' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'DeviceRefusalError', refusal: 'invalid_input' });
    expect(String(failure)).not.toContain(TOKEN);
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
  });

  it('answers 503 for anything else, still without the token', async () => {
    const { pool } = failingPool({ code: '42P01', detail: dbDetail(TOKEN) });

    const failure = await createPostgresDeviceStore(pool)
      .register(caller, { token: TOKEN, platform: 'android' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'StoreUnavailableError' });
    expect(String(failure)).not.toContain(TOKEN);
  });

  it('removes and re-toggles only the caller’s own token', async () => {
    const { pool, statements } = capturingPool(true);

    expect(await createPostgresDeviceStore(pool).unregister(caller, TOKEN)).toBe(true);
    expect(await createPostgresDeviceStore(pool).setAnnouncements(caller, TOKEN, true)).toBe(true);
    expect(statements.map((statement) => (statement.sql.split('(')[0] ?? '').trim())).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unregister_device_token'),
        expect.stringContaining('set_device_announcements'),
      ]),
    );
  });
});

describe('a Supabase JWT still registers a device', () => {
  it('uses the session behind the token when no first-party session is presented', async () => {
    const identity = new FakeIdentity();
    const devices = new FakeDevices(identity);
    const customer = identity.addUser({ email: 'jwt@example.com' });
    const token = identity.tokenFor(customer);
    // No `sessions` resolver: this is the Supabase path the admin and web apps take.
    const app = testApp({ auth: identity.deps, devices: devices.stores });

    const response = await request(app)
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: TOKEN, platform: 'android' });

    expect(response.status).toBe(200);
    expect(devices.rows).toMatchObject([
      { userId: customer.id, sessionId: identity.sessionIdFor(token) },
    ]);
  });
});

interface Statement {
  sql: string;
  values?: unknown[] | undefined;
}

/** A pool whose one client records every statement and answers the call with `value`. */
function capturingPool(value: unknown) {
  const statements: Statement[] = [];
  const client = {
    query: (sql: string, values?: unknown[]) => {
      statements.push({ sql, ...(values === undefined ? {} : { values }) });
      if (sql.includes('pg_catalog.pg_proc')) return Promise.resolve({ rows: [{ retset: false }] });
      if (sql.includes(' as value')) return Promise.resolve({ rows: [{ value }] });
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pool, statements };
}

/** A pool whose one client fails the function call with a database error. */
function failingPool(failure: { code: string; detail?: string }) {
  const statements: Statement[] = [];
  const client = {
    query: (sql: string, values?: unknown[]) => {
      statements.push({ sql, ...(values === undefined ? {} : { values }) });
      if (sql.includes('pg_catalog.pg_proc')) return Promise.resolve({ rows: [{ retset: false }] });
      if (sql.includes(' as value')) {
        return Promise.reject(Object.assign(new Error('boom'), failure));
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pool, statements };
}

/** The claim set withUser() put in the transaction. */
function claimsOf(statements: Statement[]): Record<string, unknown> {
  const statement = statements.find((candidate) => candidate.sql.includes('request.jwt.claims'));
  if (!statement?.values) throw new Error('withUser set no claims');
  return JSON.parse(String(statement.values[1])) as Record<string, unknown>;
}
