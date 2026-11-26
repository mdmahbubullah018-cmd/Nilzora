import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoogleIdTokenVerifier } from '../auth/google-id-token';

/*
 * Verification of the ID token a native app receives from Google Identity Services. A real
 * RSA key pair signs the tokens and a fake key set stands in for Google's, so every check
 * (signature, issuer, audience, expiry, verified email) is exercised without the network.
 */

const CLIENT_ID = '1234567890-nilzora.apps.googleusercontent.com';
const OTHER_CLIENT = '9999999999-someone-else.apps.googleusercontent.com';
const NOW = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const KID = 'test-key-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwkOf(key: KeyObject, kid: string): Record<string, unknown> {
  const jwk = key.export({ format: 'jwk' });
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signToken(
  claims: Record<string, unknown>,
  options: {
    kid?: string;
    alg?: string;
    key?: KeyObject;
    tamper?: boolean;
  } = {},
): string {
  const header = base64({ alg: options.alg ?? 'RS256', kid: options.kid ?? KID, typ: 'JWT' });
  const body = base64(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  const signature = signer.sign(options.key ?? privateKey).toString('base64url');
  return options.tamper
    ? `${header}.${body}.${signature.slice(0, -4)}AAAA`
    : `${header}.${body}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(NOW / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    sub: 'google-subject-1',
    email: 'customer@example.test',
    email_verified: true,
    name: 'Customer',
    iat: nowSeconds - 30,
    exp: nowSeconds + 3600,
    ...overrides,
  };
}

/** A fetch that serves Google's key set, with a settable body and status. */
function keySet(keys: unknown[], cacheControl = 'public, max-age=3600') {
  return vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
      }),
    ),
  );
}

function verifier(fetchImpl: typeof fetch, now = NOW) {
  return createGoogleIdTokenVerifier({
    audiences: [CLIENT_ID],
    fetch: fetchImpl,
    now: () => now,
    jwksUri: 'https://keys.example.test/certs',
  });
}

describe('a valid Google ID token', () => {
  it('returns the identity Google signed', async () => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);
    const identity = await verifier(fetchImpl).verify(signToken(claims()));

    expect(identity).toEqual({
      subject: 'google-subject-1',
      email: 'customer@example.test',
      emailVerified: true,
      name: 'Customer',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts the short issuer spelling and a string "true" for email_verified', async () => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);
    const identity = await verifier(fetchImpl).verify(
      signToken(claims({ iss: 'accounts.google.com', email_verified: 'true' })),
    );

    expect(identity.emailVerified).toBe(true);
  });

  it('reports an unverified address as such, so it can never link an account', async () => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);
    const identity = await verifier(fetchImpl).verify(signToken(claims({ email_verified: false })));

    expect(identity.emailVerified).toBe(false);
  });

  it('caches the key set between calls', async () => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);
    const check = verifier(fetchImpl);

    await check.verify(signToken(claims()));
    await check.verify(signToken(claims()));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once for an unknown key id, which is what rotation looks like', async () => {
    const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwkOf(publicKey, KID)] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwkOf(rotated.publicKey, 'test-key-2')] }), {
          status: 200,
        }),
      );
    const check = verifier(fetchImpl);

    const identity = await check.verify(
      signToken(claims(), { kid: 'test-key-2', key: rotated.privateKey }),
    );

    expect(identity.subject).toBe('google-subject-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('a token that proves nothing is refused', () => {
  const cases: Array<[string, () => string]> = [
    ['signed with another key', () => signToken(claims(), { key: otherPrivateKey })],
    ['tampered after signing', () => signToken(claims(), { tamper: true })],
    ['from another issuer', () => signToken(claims({ iss: 'https://evil.example' }))],
    ['minted for another app', () => signToken(claims({ aud: OTHER_CLIENT, azp: OTHER_CLIENT }))],
    [
      'with an authorized party from another Google project',
      () => signToken(claims({ azp: OTHER_CLIENT })),
    ],
    [
      'expired beyond the clock skew',
      () => signToken(claims({ exp: Math.floor(NOW / 1000) - 600 })),
    ],
    ['issued in the future', () => signToken(claims({ iat: Math.floor(NOW / 1000) + 600 }))],
    ['without a subject', () => signToken(claims({ sub: undefined }))],
    ['with alg "none"', () => signToken(claims(), { alg: 'none' })],
    ['not a JWT at all', () => 'not-a-token'],
    ['empty', () => ''],
  ];

  it.each(cases)('refuses a token %s', async (_label, token) => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);

    await expect(verifier(fetchImpl).verify(token())).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('refuses a token whose key id is not in the set', async () => {
    const fetchImpl = keySet([jwkOf(publicKey, KID)]);

    await expect(
      verifier(fetchImpl).verify(signToken(claims(), { kid: 'unknown-key' })),
    ).rejects.toMatchObject({ failure: 'invalid_credentials' });
  });

  it('is an outage, not a refusal, when the key set cannot be fetched', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(verifier(fetchImpl).verify(signToken(claims()))).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });

  it('is an outage when the key set has no usable keys', async () => {
    const fetchImpl = keySet([{ kid: 'x', kty: 'EC' }]);

    await expect(verifier(fetchImpl).verify(signToken(claims()))).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });
});

describe('the accepted audiences', () => {
  it('accepts the token an Android app is actually given: web audience, Android client as the party', async () => {
    // This is the shape Google issues to the app: the audience is the server (web) client id
    // passed as serverClientId, while `azp` is the app's own Android OAuth client. Both belong
    // to the same Google Cloud project, which is what makes the pairing legitimate.
    const androidId = '1234567890-androidclient.apps.googleusercontent.com';
    const check = verifier(keySet([jwkOf(publicKey, KID)]));

    await expect(
      check.verify(signToken(claims({ aud: CLIENT_ID, azp: androidId }))),
    ).resolves.toMatchObject({ subject: 'google-subject-1' });
  });

  it('refuses an authorized party in the same project when the audience is not served', async () => {
    const androidId = '1234567890-androidclient.apps.googleusercontent.com';
    const check = verifier(keySet([jwkOf(publicKey, KID)]));

    await expect(
      check.verify(signToken(claims({ aud: OTHER_CLIENT, azp: androidId }))),
    ).rejects.toMatchObject({ failure: 'invalid_credentials' });
  });

  it('accepts a token minted for the Android client id when it is configured', async () => {
    const androidId = '1234567890-android.apps.googleusercontent.com';
    const check = createGoogleIdTokenVerifier({
      audiences: [CLIENT_ID, androidId],
      fetch: keySet([jwkOf(publicKey, KID)]),
      now: () => NOW,
    });

    await expect(
      check.verify(signToken(claims({ aud: androidId, azp: androidId }))),
    ).resolves.toMatchObject({ subject: 'google-subject-1' });
  });

  it('refuses a token whose audience list contains an app this API does not serve', async () => {
    const check = verifier(keySet([jwkOf(publicKey, KID)]));

    await expect(
      check.verify(signToken(claims({ aud: [CLIENT_ID, OTHER_CLIENT] }))),
    ).rejects.toMatchObject({ failure: 'invalid_credentials' });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
});
