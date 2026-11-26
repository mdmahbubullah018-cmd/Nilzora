import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { googleAudiences, type GoogleSettings } from '../auth/config';
import { createGoogleOAuth, safeReturnTo, type OidcAdapter } from '../auth/oauth';

/*
 * Google sign-in policy, exercised without Google: the `state` is signed and expiring,
 * an address is only trusted when the identity provider says it is verified, and an
 * account is only ever linked to its own subject.
 */

const settings: GoogleSettings = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'http://127.0.0.1:4000/api/v1/auth/google/callback',
};
const codeSecret = 'google-oauth-test-pepper-at-least-32-characters';
const NOW = 1_767_225_600_000;

interface Recorded {
  sql: string;
  values: unknown[] | undefined;
}

/** A pool that answers the three queries account resolution makes, and records them. */
function fakePool(script: {
  linked?: string | null;
  existing?: string | null;
  /** The existing profile never verified its address (a legacy password sign-up). */
  unverified?: boolean;
  created?: string | null;
}) {
  const queries: Recorded[] = [];
  const client = {
    query(sql: string, values?: unknown[]) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (sql.includes('auth_oauth_accounts where provider')) {
        return Promise.resolve({ rows: script.linked ? [{ user_id: script.linked }] : [] });
      }
      if (sql.includes('from public.profiles where lower(email)')) {
        return Promise.resolve({
          rows: script.existing
            ? [
                {
                  id: script.existing,
                  email_verified_at: script.unverified ? null : new Date('2026-11-01T00:00:00Z'),
                },
              ]
            : [],
        });
      }
      if (sql.includes('provision_account')) {
        return Promise.resolve({ rows: script.created ? [{ id: script.created }] : [] });
      }
      return Promise.resolve({ rows: [] });
    },
    release() {},
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, queries };
}

function adapter(identity: {
  subject?: string;
  email?: string | null;
  emailVerified?: boolean;
}): OidcAdapter & { calls: string[]; urls: string[] } {
  const calls: string[] = [];
  const urls: string[] = [];
  return {
    calls,
    urls,
    authorizationUrl: ({ state, nonce, codeChallenge }) => {
      calls.push('authorizationUrl');
      return Promise.resolve(
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}&code_challenge=${codeChallenge}`,
      );
    },
    exchange: ({ nonce, currentUrl }) => {
      calls.push(`exchange:${nonce}`);
      urls.push(currentUrl);
      return Promise.resolve({
        subject: identity.subject ?? 'google-subject-1',
        email: identity.email === undefined ? 'customer@example.test' : identity.email,
        emailVerified: identity.emailVerified ?? true,
        name: 'Customer',
      });
    },
  };
}

/** An adapter whose exchange fails the way the real OIDC client does. */
function failingAdapter(error: Error): OidcAdapter {
  return {
    authorizationUrl: ({ state, nonce }) =>
      Promise.resolve(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`),
    exchange: () => Promise.reject(error),
  };
}

function service(options: {
  script?: Parameters<typeof fakePool>[0];
  identity?: Parameters<typeof adapter>[0];
  now?: number;
  secret?: string;
}) {
  const fake = fakePool(options.script ?? {});
  const oidc = adapter(options.identity ?? {});
  const oauth = createGoogleOAuth({
    settings,
    codeSecret: options.secret ?? codeSecret,
    pool: fake.pool,
    oidc,
    now: () => options.now ?? NOW,
  });
  return { oauth, oidc, queries: fake.queries };
}

/** The state a start() produced, so finish() can be called with it. */
async function stateFrom(oauth: ReturnType<typeof service>['oauth']): Promise<string> {
  const { url } = await oauth.start('/account');
  return new URL(url).searchParams.get('state') ?? '';
}

describe('start', () => {
  it('builds a Google URL carrying a state and a PKCE challenge', async () => {
    const { oauth, oidc } = service({});

    const { url } = await oauth.start('/account');

    expect(oidc.calls).toEqual(['authorizationUrl']);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('accounts.google.com');
    expect(parsed.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(parsed.searchParams.get('nonce')).toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(parsed.searchParams.get('code_challenge')).toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('gives every start a fresh state and nonce', async () => {
    const { oauth } = service({});

    const first = await stateFrom(oauth);
    const second = await stateFrom(oauth);

    expect(first).not.toBe(second);
  });
});

describe('finish', () => {
  const QUERY = { code: 'authorization-code', state: 'placeholder' };

  it('creates an account for a new verified address and links the subject', async () => {
    const created = '11111111-1111-4111-8111-111111111111';
    const { oauth, queries } = service({ script: { created } });
    const state = await stateFrom(oauth);

    const result = await oauth.finish({ ...QUERY, state });

    expect(result).toEqual({ userId: created, returnTo: '/account' });
    expect(queries.some((entry) => entry.sql.includes('provision_account'))).toBe(true);
    const link = queries.find((entry) =>
      entry.sql.includes('insert into public.auth_oauth_accounts'),
    );
    expect(link?.values).toEqual(['google', 'google-subject-1', created, 'customer@example.test']);
  });

  it('signs an already-linked subject in without touching other accounts', async () => {
    const linked = '22222222-2222-4222-8222-222222222222';
    const { oauth, queries } = service({ script: { linked } });
    const state = await stateFrom(oauth);

    const result = await oauth.finish({ ...QUERY, state });

    expect(result.userId).toBe(linked);
    expect(queries.some((entry) => entry.sql.includes('provision_account'))).toBe(false);
    expect(queries.some((entry) => entry.sql.includes('insert into'))).toBe(false);
  });

  it('links a new subject to the account that already owns the verified address', async () => {
    const existing = '33333333-3333-4333-8333-333333333333';
    const { oauth, queries } = service({ script: { existing } });
    const state = await stateFrom(oauth);

    const result = await oauth.finish({ ...QUERY, state });

    expect(result.userId).toBe(existing);
    expect(queries.some((entry) => entry.sql.includes('provision_account'))).toBe(false);
    // An existing, verified account is only linked: no takeover and no second welcome.
    expect(queries.some((entry) => entry.sql.includes('password_hash = null'))).toBe(false);
    expect(queries.some((entry) => entry.sql.includes('queue_welcome_email'))).toBe(false);
  });

  it('takes over an unverified profile safely: drops its password, ends its sessions, welcomes once', async () => {
    const existing = '55555555-5555-4555-8555-555555555555';
    const { oauth, queries } = service({ script: { existing, unverified: true } });
    const state = await stateFrom(oauth);

    const result = await oauth.finish({ ...QUERY, state });

    expect(result.userId).toBe(existing);
    const sql = queries.map((entry) => entry.sql);
    expect(sql.some((text) => text.includes('for update'))).toBe(true);
    expect(
      sql.some((text) => text.includes('set password_hash = null, email_verified_at = now()')),
    ).toBe(true);
    expect(sql.some((text) => text.includes('update public.auth_sessions set revoked_at'))).toBe(
      true,
    );
    expect(sql.filter((text) => text.includes('queue_welcome_email'))).toHaveLength(1);
    expect(sql.some((text) => text.includes('provision_account'))).toBe(false);
  });

  it('queues the welcome email once for a new Google account, and clears a pending sign-up', async () => {
    const created = '66666666-6666-4666-8666-666666666666';
    const { oauth, queries } = service({ script: { created } });
    const state = await stateFrom(oauth);

    const result = await oauth.finish({ ...QUERY, state });

    expect(result.userId).toBe(created);
    const sql = queries.map((entry) => entry.sql);
    expect(sql.filter((text) => text.includes('queue_welcome_email'))).toHaveLength(1);
    expect(sql.some((text) => text.includes('delete from public.auth_pending_registrations'))).toBe(
      true,
    );
  });

  it('refuses an address Google has not verified, and creates nothing', async () => {
    const { oauth, queries } = service({
      script: { created: '44444444-4444-4444-8444-444444444444' },
      identity: { emailVerified: false },
    });
    const state = await stateFrom(oauth);

    await expect(oauth.finish({ ...QUERY, state })).rejects.toMatchObject({
      failure: 'email_not_confirmed',
    });
    expect(queries.some((entry) => entry.sql.includes('provision_account'))).toBe(false);
  });

  it('refuses an identity with no address at all', async () => {
    const { oauth } = service({ identity: { email: null } });
    const state = await stateFrom(oauth);

    await expect(oauth.finish({ ...QUERY, state })).rejects.toMatchObject({
      failure: 'email_not_confirmed',
    });
  });

  it('refuses a tampered state', async () => {
    const { oauth } = service({});
    const state = await stateFrom(oauth);
    const [body, signature] = state.split('.');
    const forged = `${body}.${signature?.slice(0, -2)}aa`;

    await expect(oauth.finish({ ...QUERY, state: forged })).rejects.toMatchObject({
      failure: 'oauth_unavailable',
    });
  });

  it('refuses a state signed with another secret', async () => {
    const issuer = service({});
    const verifier = service({ secret: 'a-different-pepper-value-32-characters' });
    const state = await stateFrom(issuer.oauth);

    await expect(verifier.oauth.finish({ ...QUERY, state })).rejects.toMatchObject({
      failure: 'oauth_unavailable',
    });
  });

  it('refuses an expired state', async () => {
    const { oauth } = service({ now: NOW });
    const state = await stateFrom(oauth);
    const later = service({ now: NOW + 11 * 60 * 1000, secret: codeSecret });

    await expect(later.oauth.finish({ ...QUERY, state })).rejects.toMatchObject({
      failure: 'oauth_unavailable',
    });
  });

  it('refuses a callback with no code or no state', async () => {
    const { oauth, oidc } = service({});

    await expect(oauth.finish({ state: 'anything' })).rejects.toMatchObject({
      failure: 'oauth_unavailable',
    });
    await expect(oauth.finish({ code: 'anything' })).rejects.toMatchObject({
      failure: 'oauth_unavailable',
    });
    expect(oidc.calls).toEqual([]);
  });

  it('reports a refusal at Google as a failed sign-in, not an outage', async () => {
    const { oauth } = service({});

    await expect(
      oauth.finish({ error: 'access_denied', state: await stateFrom(oauth) }),
    ).rejects.toMatchObject({ failure: 'invalid_credentials' });
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/account', '/account'],
    ['/checkout', '/checkout'],
  ])('keeps %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  it.each([
    ['https://evil.example/account'],
    ['//evil.example/account'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['/account?next=https://evil.example'],
    ['/account#fragment'],
    [''],
    [undefined],
    [42],
  ])('drops %s', (value) => {
    expect(safeReturnTo(value)).toBe('');
  });
});

describe('the authorization response is relayed intact', () => {
  const ISS = 'https://accounts.google.com';

  it('forwards the iss parameter to the OIDC client, which requires it', async () => {
    const { oauth, oidc } = service({ script: { linked: '22222222-2222-4222-8222-222222222222' } });
    const state = await stateFrom(oauth);

    await oauth.finish({ code: 'authorization-code', state, iss: ISS });

    const url = new URL(oidc.urls[0] ?? '');
    expect(url.searchParams.get('code')).toBe('authorization-code');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('iss')).toBe(ISS);
    expect(url.origin + url.pathname).toBe(settings.redirectUri);
  });

  it('leaves iss out when the callback did not carry one', async () => {
    const { oauth, oidc } = service({ script: { linked: '22222222-2222-4222-8222-222222222222' } });
    const state = await stateFrom(oauth);

    await oauth.finish({ code: 'authorization-code', state });

    expect(new URL(oidc.urls[0] ?? '').searchParams.has('iss')).toBe(false);
  });

  it.each([
    // What openid-client raises when the response is missing iss or is otherwise malformed.
    Object.assign(new Error('invalid response encountered'), { code: 'OAUTH_INVALID_RESPONSE' }),
    Object.assign(new Error('token endpoint refused'), { code: 'OAUTH_INVALID_GRANT' }),
    Object.assign(new Error('refused'), { name: 'ResponseBodyError', error: 'invalid_grant' }),
  ])('reports a rejected exchange as a failed sign-in, not an outage (%s)', async (failure) => {
    const fake = fakePool({});
    const oauth = createGoogleOAuth({
      settings,
      codeSecret,
      pool: fake.pool,
      oidc: failingAdapter(failure),
      now: () => NOW,
    });
    const state = await stateFrom(oauth);

    await expect(oauth.finish({ code: 'code', state, iss: ISS })).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('reports a provider that cannot be reached as unavailable', async () => {
    const fake = fakePool({});
    const oauth = createGoogleOAuth({
      settings,
      codeSecret,
      pool: fake.pool,
      oidc: failingAdapter(new TypeError('fetch failed')),
      now: () => NOW,
    });
    const state = await stateFrom(oauth);

    await expect(oauth.finish({ code: 'code', state, iss: ISS })).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });
});

describe('the accepted audiences of a native ID token', () => {
  it('uses the web client id, which is what the app signs in with', () => {
    expect(
      googleAudiences({
        GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com',
      }),
    ).toEqual(['web.apps.googleusercontent.com']);
  });

  it('also accepts an Android client id when one is configured', () => {
    expect(
      googleAudiences({
        GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com',
        GOOGLE_ANDROID_CLIENT_ID: 'android.apps.googleusercontent.com',
      }),
    ).toEqual(['web.apps.googleusercontent.com', 'android.apps.googleusercontent.com']);
  });

  it('is empty when Google is not configured at all', () => {
    expect(googleAudiences({})).toEqual([]);
  });
});
