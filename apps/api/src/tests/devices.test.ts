import { randomUUID } from 'node:crypto';
import { deviceRegistrationResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { StoreUnavailableError } from '../modules/commerce/errors';
import { toDeviceStoreError, type DeviceRefusalError } from '../modules/devices/errors';
import { errorOf } from './commerce-helpers';
import { dbDetail, FakeDevices, MAX_DEVICES } from './device-fakes';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';

const TOKEN = 'fcm:APA91bHexample-token_value.with~allowed+chars/and=padding';
const OTHER_TOKEN = 'fcm:APA91bHanother-token_value.with~other+chars/and=padding';

type Who = 'customer' | 'other' | 'staff' | 'admin' | 'moderator' | 'suspended';

function setup(env: Record<string, string> = {}) {
  const identity = new FakeIdentity();
  const devices = new FakeDevices(identity);
  const logs = captureLogs('debug');
  const users = {
    customer: identity.addUser({ email: 'rahima@example.com' }),
    other: identity.addUser({ email: 'karim@example.com' }),
    staff: identity.addUser({ email: 'staff@example.com', role: 'staff' }),
    admin: identity.addUser({ email: 'admin@example.com', role: 'admin' }),
    moderator: identity.addUser({ email: 'mod@example.com', role: 'moderator' }),
    suspended: identity.addUser({ email: 'held@example.com', status: 'suspended' }),
  } satisfies Record<Who, unknown>;
  const tokens = Object.fromEntries(
    Object.entries(users).map(([who, user]) => [who, identity.tokenFor(user)]),
  ) as Record<Who, string>;
  const app = testApp({ auth: identity.deps, devices: devices.stores, logger: logs.logger, env });

  const register = (who: Who | undefined, body: object = { token: TOKEN, platform: 'android' }) => {
    const pending = request(app).post('/api/v1/me/devices');
    return (who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending).send(body);
  };
  const remove = (who: Who | undefined, body: object = { token: TOKEN }) => {
    const pending = request(app).post('/api/v1/me/devices/remove');
    return (who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending).send(body);
  };
  return { identity, devices, logs, users, tokens, app, register, remove };
}

describe('POST /api/v1/me/devices', () => {
  it('registers the token for the caller and answers with the device id only', async () => {
    const { register, devices, users } = setup();
    const response = await register('customer', {
      token: `  ${TOKEN} `,
      platform: 'android',
      appVersion: ' 1.0.0 ',
    });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { device } = deviceRegistrationResponseSchema.parse(response.body);
    expect(response.body).toStrictEqual({ device: { id: device.id } });
    expect(devices.rows).toMatchObject([
      {
        id: device.id,
        userId: users.customer.id,
        token: TOKEN,
        platform: 'android',
        appVersion: '1.0.0',
      },
    ]);
  });

  it('refreshes an existing registration instead of adding a second device', async () => {
    const { register, devices, users } = setup();
    const first = await register('customer', {
      token: TOKEN,
      platform: 'android',
      appVersion: '1.0.0',
    });
    const again = await register('customer', {
      token: TOKEN,
      platform: 'ios',
      appVersion: '1.1.0',
    });

    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual(first.body);
    expect(devices.rows).toMatchObject([
      { userId: users.customer.id, platform: 'ios', appVersion: '1.1.0' },
    ]);
  });

  it.each<[string, Who]>([
    ['a customer', 'customer'],
    ['staff', 'staff'],
    ['an admin', 'admin'],
    ['a moderator', 'moderator'],
  ])('lets %s register', async (_label, who) => {
    const { register } = setup();
    expect((await register(who)).status).toBe(200);
  });

  it('trusts only the verified token for the owner, never the body', async () => {
    const { register, devices, users } = setup();
    const response = await register('customer', {
      token: TOKEN,
      platform: 'android',
      userId: users.other.id,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(devices.rows).toEqual([]);
  });

  it('moves a token to the account now using the device, and keeps only the newest ten', async () => {
    const { register, remove, devices, users } = setup();
    const taken = await register('customer');
    const takeover = await register('other');

    expect(takeover.body).toStrictEqual(taken.body);
    expect(devices.tokensOf(users.customer.id)).toEqual([]);
    expect(devices.tokensOf(users.other.id)).toEqual([TOKEN]);

    for (let index = 0; index < MAX_DEVICES + 2; index += 1) {
      const token = `cap-token-${String(index).padStart(10, '0')}`;
      expect((await register('staff', { token, platform: 'android' })).status).toBe(200);
    }
    expect(devices.tokensOf(users.staff.id)).toHaveLength(MAX_DEVICES);
    expect(devices.tokensOf(users.staff.id)[0]).toBe('cap-token-0000000002');
    expect(devices.tokensOf(users.other.id)).toEqual([TOKEN]);
    expect((await remove('other')).status).toBe(204);
  });
});

describe('POST /api/v1/me/devices/remove', () => {
  it('removes only the caller’s own token and answers 204 either way', async () => {
    const { register, remove, devices, users } = setup();
    await register('customer');
    const byOther = await remove('other');
    const stillThere = devices.tokensOf(users.customer.id);
    const byOwner = await remove('customer');
    const again = await remove('customer');

    for (const response of [byOther, byOwner, again]) {
      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(stillThere).toEqual([TOKEN]);
    expect(devices.rows).toEqual([]);
  });

  it('cannot remove a token another account took over', async () => {
    const { register, remove, devices, users } = setup();
    await register('customer');
    await register('other');
    expect((await remove('customer')).status).toBe(204);

    expect(devices.tokensOf(users.other.id)).toEqual([TOKEN]);
    expect((await remove('other')).status).toBe(204);
    expect(devices.rows).toEqual([]);
  });
});

describe.each([
  ['POST /api/v1/me/devices', 'register'],
  ['POST /api/v1/me/devices/remove', 'remove'],
] as const)('%s access', (_route, action) => {
  it('refuses a signed-out caller with 401 and a bearer challenge', async () => {
    const setupped = setup();
    const response = await setupped[action](undefined);

    expect(response.status).toBe(401);
    expect(errorOf(response.body).code).toBe('unauthenticated');
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setupped.devices.calls).toEqual([]);
  });

  it('refuses a suspended account with 403 before the database is asked', async () => {
    const setupped = setup();
    const response = await setupped[action]('suspended');

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('account_suspended');
    expect(setupped.devices.calls).toEqual([]);
  });

  it.each([
    ['a missing token', {}],
    ['a short token', { token: 'short-token' }],
    ['a token over 1,024 characters', { token: 'a'.repeat(1025) }],
    ['a token with whitespace', { token: 'abcdefghij abcdefghijklmn' }],
    ['a token with markup', { token: 'abcdefghijabcdefghij<script>' }],
    ['a non-string token', { token: 12_345 }],
    ['a user id', { token: TOKEN, userId: randomUUID() }],
  ])('rejects %s', async (_label, body) => {
    const setupped = setup();
    const response = await setupped[action]('customer', { platform: 'android', ...body });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setupped.devices.calls).toEqual([]);
  });
});

describe('POST /api/v1/me/devices validation', () => {
  it.each([
    ['no platform', { token: TOKEN }],
    ['an unknown platform', { token: TOKEN, platform: 'windows' }],
    [
      'an app version over 32 characters',
      { token: TOKEN, platform: 'ios', appVersion: '1'.repeat(33) },
    ],
    ['a blank app version', { token: TOKEN, platform: 'ios', appVersion: ' ' }],
    [
      'an invalidation time',
      { token: TOKEN, platform: 'ios', invalidatedAt: '2026-10-26T08:00:00Z' },
    ],
  ])('rejects %s', async (_label, body) => {
    const { register, devices } = setup();
    const response = await register('customer', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(devices.calls).toEqual([]);
  });
});

describe('tokens follow the session that registered them', () => {
  const logout = (app: ReturnType<typeof setup>['app'], accessToken: string) =>
    request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);

  it('accepts a token of exactly 1,024 characters and refuses one a character longer', async () => {
    const { register, devices } = setup();
    const longest = await register('customer', { token: 'a'.repeat(1024), platform: 'android' });
    const tooLong = await register('customer', { token: 'a'.repeat(1025), platform: 'android' });

    expect(longest.status).toBe(200);
    expect(tooLong.status).toBe(400);
    expect(errorOf(tooLong.body).code).toBe('validation_failed');
    expect(devices.rows).toHaveLength(1);
  });

  it('stops delivering to a token once its session ends, though the row remains', async () => {
    const { register, app, devices, users, tokens } = setup();
    await register('customer');
    expect(devices.deliverable(users.customer.id)).toEqual([TOKEN]);

    // The client never removed the token (offline, killed app); the session is revoked.
    expect((await logout(app, tokens.customer)).status).toBe(204);

    expect(devices.deliverable()).toEqual([]);
    expect(devices.tokensOf(users.customer.id)).toEqual([TOKEN]);
  });

  it('delivers to the account now using the phone, not the one that signed out', async () => {
    const { register, app, devices, users, tokens } = setup();
    await register('customer');
    await register('other');

    expect(devices.deliverable(users.customer.id)).toEqual([]);
    expect(devices.deliverable(users.other.id)).toEqual([TOKEN]);
    // The previous account's session ending changes nothing for the new owner.
    await logout(app, tokens.customer);
    expect(devices.deliverable()).toEqual([TOKEN]);
    await logout(app, tokens.other);
    expect(devices.deliverable()).toEqual([]);
  });

  it('keeps a token deliverable only while the session that registered it lives', async () => {
    const { register, app, devices, identity, users, tokens } = setup();
    const secondSession = identity.tokenFor(users.customer);
    await register('customer');
    await request(app)
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${secondSession}`)
      .send({ token: OTHER_TOKEN, platform: 'android' })
      .expect(200);
    expect(devices.deliverable(users.customer.id)).toEqual([OTHER_TOKEN, TOKEN]);

    await logout(app, tokens.customer);
    expect(devices.deliverable(users.customer.id)).toEqual([OTHER_TOKEN]);
  });

  it('stops delivering when the session expires', async () => {
    const { register, devices, identity, tokens } = setup();
    await register('customer');
    const session = identity.sessions.get(tokens.customer);
    if (session) session.expired = true;

    expect(devices.deliverable()).toEqual([]);
  });
});

describe('database failures', () => {
  it.each([
    ['NZ403', 403, 'account_suspended'],
    ['NZ412', 400, 'bad_request'],
    ['XX000', 503, 'service_unavailable'],
    ['42501', 503, 'service_unavailable'],
    ['', 503, 'service_unavailable'],
  ])('maps %s to %i %s on both routes', async (sqlstate, status, code) => {
    const { register, remove, devices } = setup();
    for (const send of [register, remove]) {
      devices.nextFailure = sqlstate;
      const response = await send('customer');

      expect(response.status).toBe(status);
      expect(errorOf(response.body).code).toBe(code);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(response.body)).not.toContain('internal detail');
    }
  });
});

describe('the token never leaves the API', () => {
  it('is in no response body, header or log line, whatever the outcome', async () => {
    const { register, remove, devices, logs, app, tokens } = setup();
    const responses = [
      await register('customer'),
      await register('other'),
      await remove('customer'),
      await register(undefined),
      await register('suspended'),
      await register('customer', { token: TOKEN, platform: 'windows' }),
      await register('customer', { token: TOKEN, platform: 'android', userId: 'x' }),
      await remove('customer', { token: `${TOKEN}<` }),
    ];
    for (const failure of ['NZ403', 'NZ412', 'XX000', '42501']) {
      devices.nextFailure = failure;
      responses.push(await register('customer'));
      devices.nextFailure = failure;
      responses.push(await remove('customer'));
    }
    // A body that is not valid JSON is answered without echoing any of it.
    responses.push(
      await request(app)
        .post('/api/v1/me/devices')
        .set('Authorization', `Bearer ${tokens.customer}`)
        .set('Content-Type', 'application/json')
        .send(`{"token": "${TOKEN}", "platform": `),
    );

    for (const response of responses) {
      expect(JSON.stringify(response.body)).not.toContain(TOKEN);
      expect(JSON.stringify(response.headers)).not.toContain(TOKEN);
      expect(response.text).not.toContain(TOKEN);
    }
    expect(logs.raw()).not.toContain(TOKEN);
    expect(logs.raw()).not.toContain(OTHER_TOKEN);
    expect(logs.raw()).not.toContain(dbDetail('').slice(0, 20));
    // The failures were logged (so the absence above means something).
    expect(logs.entries().some((entry) => String(entry.msg).includes('unavailable'))).toBe(true);
  });
});

describe('toDeviceStoreError', () => {
  it('keeps nothing of the database failure but its SQLSTATE', () => {
    const failure = { code: 'XX000', message: 'internal detail', details: dbDetail(TOKEN) };
    const error = toDeviceStoreError(failure, 'register_device_token');

    expect(error).toBeInstanceOf(StoreUnavailableError);
    expect(error.message).toBe('register_device_token failed (XX000)');
    expect(error.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(error.cause)).not.toContain(TOKEN);
    expect((error.cause as Error).message).toBe('database error XX000');
    expect(error.cause).not.toBe(failure);
  });

  it('maps the two refusals and treats everything else as unavailable', () => {
    const refusal = (code: string) =>
      toDeviceStoreError({ code, message: 'x' }, 'op') as DeviceRefusalError;

    expect(refusal('NZ403')).toMatchObject({
      name: 'DeviceRefusalError',
      refusal: 'account_suspended',
    });
    expect(refusal('NZ412')).toMatchObject({ refusal: 'invalid_input' });
    expect(refusal('NZ404')).toBeInstanceOf(StoreUnavailableError);
    expect(refusal('')).toMatchObject({ message: 'op failed (network)' });
  });
});
