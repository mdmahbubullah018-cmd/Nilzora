import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FcmConfig } from '../config/env';
import { createFcmSender, type PushMessage } from '../modules/notifications/fcm';
import { orderStatusNotification } from '../modules/notifications/messages';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG: FcmConfig = {
  projectId: 'nilzora-test',
  clientEmail: 'sender@nilzora-test.iam.gserviceaccount.com',
  privateKey,
};
const DEVICE_TOKEN = 'device-token-SECRET-0123456789abcdef';
const ACCESS_TOKEN = 'ya29.access-token-SECRET';
const MESSAGE: PushMessage = {
  token: DEVICE_TOKEN,
  title: 'Order shipped',
  body: 'Order NZ100001 has been shipped.',
  data: { orderNumber: 'NZ100001' },
};

interface Call {
  url: string;
  init: RequestInit;
}

type Reply = Response | Error;

/** A fetch that records calls and answers from `reply`. */
function fakeFetch(reply: (call: Call, index: number) => Reply) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init: RequestInit = {}) => {
    const call = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    };
    calls.push(call);
    const answer = reply(call, calls.length - 1);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const tokenReply = (expiresIn = 3600) =>
  Response.json({ access_token: ACCESS_TOKEN, expires_in: expiresIn, token_type: 'Bearer' });

/** The shape undici rejects with: a TypeError whose `cause` carries the system error code. */
function transportError(code: string): TypeError {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = Object.assign(new Error(`socket ${code}`), { code });
  return error;
}

/** Token endpoint answers OK; the send endpoint answers `send`. */
function scenario(send: () => Reply, options: { now?: () => number } = {}) {
  const f = fakeFetch((call) => (call.url.includes('oauth2') ? tokenReply() : send()));
  const sender = createFcmSender(CONFIG, { fetch: f.fetch, ...options });
  return { sender, calls: f.calls, sends: () => f.calls.filter((c) => !c.url.includes('oauth2')) };
}

function fcmError(status: number, httpStatus: string, errorCode?: string, extra: object = {}) {
  return Response.json(
    {
      error: {
        code: status,
        status: httpStatus,
        message: 'A message that must never be stored',
        details: errorCode
          ? [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode,
                ...extra,
              },
            ]
          : [],
      },
    },
    { status },
  );
}

describe('createFcmSender: authorisation', () => {
  it('signs a service-account JWT that the matching public key verifies', async () => {
    const { sender, calls } = scenario(() => new Response('{}'), { now: () => 1_700_000_000_000 });
    await sender.send(MESSAGE);

    const tokenCall = calls[0];
    expect(tokenCall?.url).toBe('https://oauth2.googleapis.com/token');
    expect(tokenCall?.init.method).toBe('POST');
    const form = new URLSearchParams(bodyText(tokenCall));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: CONFIG.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const verifier = createVerify('RSA-SHA256').update(`${header}.${claims}`);
    expect(
      verifier.verify(createPublicKey(publicKey), Buffer.from(signature ?? '', 'base64url')),
    ).toBe(true);
  });

  it('sends the message to the project with the access token, carrying only the order number as data', async () => {
    const { sender, sends } = scenario(() => new Response('{}'));
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'sent' });

    const call = sends()[0];
    expect(call?.url).toBe('https://fcm.googleapis.com/v1/projects/nilzora-test/messages:send');
    expect(new Headers(call?.init.headers).get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(bodyText(call))).toEqual({
      message: {
        token: DEVICE_TOKEN,
        notification: { title: MESSAGE.title, body: MESSAGE.body },
        data: { orderNumber: 'NZ100001' },
        android: { priority: 'HIGH', notification: { channel_id: 'default' } },
      },
    });
  });

  it('adds the notification identity to the data on every attempt of the same notification', async () => {
    const { sender, sends } = scenario(() => new Response('{}'));
    const message = { ...MESSAGE, tag: '0a000000-0000-4000-8000-000000000001' };

    await sender.send(message);
    await sender.send(message);

    const bodies = sends().map(
      (call) => JSON.parse(bodyText(call)) as { message: { data: Record<string, string> } },
    );
    for (const body of bodies) {
      expect(body.message.data).toEqual({
        orderNumber: 'NZ100001',
        tag: '0a000000-0000-4000-8000-000000000001',
      });
    }
  });

  it('reuses the access token until shortly before it expires', async () => {
    let now = 1_000_000;
    const { sender, calls } = scenario(() => new Response('{}'), { now: () => now });
    await sender.send(MESSAGE);
    now += 3_000_000; // 50 minutes
    await sender.send(MESSAGE);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);

    now += 600_000; // now within a minute of the hour
    await sender.send(MESSAGE);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('shares one token request between simultaneous sends', async () => {
    const { sender, calls } = scenario(() => new Response('{}'));
    await Promise.all([sender.send(MESSAGE), sender.send(MESSAGE), sender.send(MESSAGE)]);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
  });

  it('fetches a new access token after FCM refuses the old one, and asks for a retry', async () => {
    let sendCount = 0;
    const { sender, calls } = scenario(() => {
      sendCount += 1;
      return sendCount === 1 ? fcmError(401, 'UNAUTHENTICATED') : new Response('{}');
    });
    await expect(sender.send(MESSAGE)).resolves.toEqual({
      kind: 'retry',
      code: 'fcm_unauthenticated',
    });
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'sent' });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it.each([
    ['a token endpoint outage', () => new Response('', { status: 503 }), 'fcm_auth_unavailable'],
    [
      'a rejected service account',
      () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      'fcm_auth_rejected',
    ],
    ['an answer without a token', () => Response.json({}), 'fcm_auth_rejected'],
    ['an unreachable token endpoint', () => new TypeError('fetch failed'), 'fcm_network'],
  ])('retries on %s, without sending anything', async (_name, reply, code) => {
    const f = fakeFetch(reply);
    const sender = createFcmSender(CONFIG, { fetch: f.fetch });
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'retry', code });
    expect(f.calls).toHaveLength(1);
  });

  it('refuses a private key that is not usable when the sender is created', () => {
    expect(() => createFcmSender({ ...CONFIG, privateKey: 'not a key' })).toThrow();
  });
});

describe('createFcmSender: outcomes', () => {
  it.each([
    ['UNREGISTERED', () => fcmError(404, 'NOT_FOUND', 'UNREGISTERED')],
    ['a 404 without details', () => fcmError(404, 'NOT_FOUND')],
    ['a sender mismatch', () => fcmError(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH')],
    [
      'an invalid token argument',
      () =>
        fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', {
          fieldViolations: [
            { field: 'message.token', description: 'not a valid FCM registration token' },
          ],
        }),
    ],
  ])('treats %s as a dead token', async (_name, reply) => {
    const { sender } = scenario(reply);
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'invalid_token' });
  });

  it('treats other invalid arguments as a permanent failure, not a dead token', async () => {
    const { sender } = scenario(() =>
      fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', {
        fieldViolations: [{ field: 'message.data', description: 'bad' }],
      }),
    );
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'failed', code: 'fcm_rejected' });
  });

  it.each([
    [
      'a rate limit',
      () => fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'),
      'fcm_rate_limited',
    ],
    [
      'an unavailable service',
      () => fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE'),
      'fcm_unavailable',
    ],
    ['an internal error', () => fcmError(500, 'INTERNAL'), 'fcm_unavailable'],
    [
      'a gateway error',
      () => new Response('<html>bad gateway</html>', { status: 502 }),
      'fcm_unavailable',
    ],
  ])('retries on %s', async (_name, reply, code) => {
    const { sender } = scenario(reply);
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'retry', code });
  });

  it.each([
    ['a refused connection', 'ECONNREFUSED'],
    ['a host that does not exist', 'ENOTFOUND'],
    ['a connection that never opened in time', 'UND_ERR_CONNECT_TIMEOUT'],
  ])('retries after %s, where nothing can have been sent', async (_name, code) => {
    const { sender } = scenario(() => transportError(code));
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'retry', code: 'fcm_network' });
  });

  it.each([
    [
      'our own send timeout',
      new DOMException('The operation timed out', 'TimeoutError'),
      'fcm_timeout',
    ],
    ['an abort', new DOMException('The operation was aborted', 'AbortError'), 'fcm_timeout'],
    ['a connection reset after the request', transportError('ECONNRESET'), 'fcm_network_uncertain'],
    ['a socket the other side closed', transportError('UND_ERR_SOCKET'), 'fcm_network_uncertain'],
    ['a failure with no code at all', new TypeError('fetch failed'), 'fcm_network_uncertain'],
  ])('reports %s as uncertain, so it is never retried', async (_name, error, code) => {
    const { sender } = scenario(() => error);
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'uncertain', code });
  });

  it('passes on Retry-After given in seconds, capped at an hour', async () => {
    const seconds = scenario(
      () => new Response('', { status: 429, headers: { 'retry-after': '17' } }),
    );
    await expect(seconds.sender.send(MESSAGE)).resolves.toEqual({
      kind: 'retry',
      code: 'fcm_rate_limited',
      retryAfterSeconds: 17,
    });

    const huge = scenario(
      () => new Response('', { status: 503, headers: { 'retry-after': '999999' } }),
    );
    await expect(huge.sender.send(MESSAGE)).resolves.toMatchObject({ retryAfterSeconds: 3600 });
  });

  it('understands a Retry-After date and ignores nonsense', async () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    const date = scenario(
      () =>
        new Response('', {
          status: 503,
          headers: { 'retry-after': 'Tue, 27 Oct 2026 10:02:00 GMT' },
        }),
      { now: () => now },
    );
    await expect(date.sender.send(MESSAGE)).resolves.toMatchObject({ retryAfterSeconds: 120 });

    const nonsense = scenario(
      () => new Response('', { status: 503, headers: { 'retry-after': 'soon' } }),
    );
    await expect(nonsense.sender.send(MESSAGE)).resolves.toEqual({
      kind: 'retry',
      code: 'fcm_unavailable',
    });
  });

  it('fails permanently on other client errors', async () => {
    const { sender } = scenario(() => fcmError(400, 'FAILED_PRECONDITION'));
    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'failed', code: 'fcm_rejected' });
  });

  it('never puts the token, an access token or a response body into an outcome', async () => {
    const replies = [
      () => fcmError(404, 'NOT_FOUND', 'UNREGISTERED'),
      () => fcmError(400, 'FAILED_PRECONDITION'),
      () => fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE'),
      () => new TypeError(`fetch failed for ${DEVICE_TOKEN}`),
    ];
    for (const reply of replies) {
      const { sender } = scenario(reply);
      const text = JSON.stringify(await sender.send(MESSAGE));
      expect(text).not.toContain(DEVICE_TOKEN);
      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain('must never be stored');
    }
  });
});

describe('orderStatusNotification', () => {
  it.each(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'])(
    'builds a text for %s',
    (status) => {
      const message = orderStatusNotification('NZ100001', status);
      expect(message?.body).toContain('NZ100001');
      expect(message?.data).toEqual({ orderNumber: 'NZ100001' });
      expect(message?.title.length).toBeGreaterThan(0);
    },
  );

  it('sends nothing for other statuses, odd keys or malformed order numbers', () => {
    expect(orderStatusNotification('NZ100001', 'pending')).toBeNull();
    expect(orderStatusNotification('NZ100001', 'toString')).toBeNull();
    expect(orderStatusNotification('NZ100001', '__proto__')).toBeNull();
    expect(orderStatusNotification('<script>', 'shipped')).toBeNull();
  });
});

/** The text of a recorded request body (the sender only sends strings and URL-encoded forms). */
function bodyText(call: Call | undefined): string {
  const body = call?.init.body;
  if (typeof body === 'string') return body;
  return body instanceof URLSearchParams ? body.toString() : '';
}
