import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { withServiceRole } from '../db/user-context';
import { randomToken } from './tokens';
import { AuthError } from './first-party';
import type { GoogleSettings } from './config';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';

/*
 * Google sign-in
 * --------------
 * The API is stateless, so the OAuth round trip is carried by a signed `state` value
 * instead of a server-side store: it contains the nonce, the PKCE verifier, the return
 * path and an expiry, and is authenticated with HMAC over the code pepper. Nothing in it
 * is a credential — the verifier it carries is single-use at Google and only useful with
 * the matching authorization code.
 *
 * Secured by: state signature + expiry, nonce comparison by the OIDC client, PKCE (S256),
 * `email_verified` from the ID token before any account is touched, and a subject-to-account
 * link that never merges accounts by an unverified address.
 *
 * Disabled until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are set.
 */

const STATE_TTL_SECONDS = 10 * 60;

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name?: string | undefined;
}

/** The IdP side, so the policy below can be tested without Google. */
export interface OidcAdapter {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string>;
  exchange(input: {
    currentUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleIdentity>;
}

interface StatePayload {
  /** Nonce for the ID token. */
  n: string;
  /** PKCE verifier. */
  v: string;
  /** Return path inside the calling app, or empty. */
  r: string;
  /** Expiry, unix seconds. */
  e: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeState(payload: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export interface GoogleOAuth {
  /** The Google URL to send the browser to, and the state to expect back. */
  start(returnTo: string): Promise<{ url: string }>;
  /** Redeems the callback and returns the account to sign in, creating or linking it. */
  finish(query: Record<string, unknown>): Promise<{ userId: string; returnTo: string }>;
}

/** A verified Google identity turned into the Nilzora account it belongs to. */
export interface GoogleIdentitySignIn {
  /** Verifies a Google ID token (native apps) and returns the account it proves. */
  signIn(idToken: string): Promise<{ userId: string }>;
}

export interface GoogleIdentityVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

/**
 * The native-app path: a token from Google Identity Services is verified (signature,
 * issuer, audience, expiry, verified email) by `verifier`, then linked with exactly the
 * same rules as the browser flow, so both entry points share one account-linking policy.
 */
export function createGoogleIdentitySignIn(options: {
  verifier: GoogleIdentityVerifier;
  pool: Pool;
}): GoogleIdentitySignIn {
  return {
    async signIn(idToken) {
      const identity = await options.verifier.verify(idToken);
      return { userId: await resolveGoogleAccount(options.pool, identity) };
    },
  };
}

export interface GoogleOAuthOptions {
  settings: GoogleSettings;
  /** Pepper for the signed state; the same secret the codes use. */
  codeSecret: string;
  pool: Pool;
  oidc: OidcAdapter;
  now?: () => number;
}

/** Reads one query value, refusing repeated parameters (they are ambiguous). */
function single(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  return typeof value === 'string' ? value : undefined;
}

export function createGoogleOAuth({
  settings,
  codeSecret,
  pool,
  oidc,
  now = Date.now,
}: GoogleOAuthOptions): GoogleOAuth {
  function readState(state: string): StatePayload {
    const [body, signature] = state.split('.');
    if (!body || !signature) throw new AuthError('oauth_unavailable');
    const expected = sign(body, codeSecret);
    const given = Buffer.from(signature, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new AuthError('oauth_unavailable');
    }
    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      throw new AuthError('oauth_unavailable');
    }
    if (typeof payload.e !== 'number' || payload.e * 1000 < now()) {
      throw new AuthError('oauth_unavailable');
    }
    return payload;
  }

  /**
   * The account for a verified Google identity: the linked account, else the account with
   * that verified address, else a new customer account. An unverified address never links.
   */
  async function resolveAccount(identity: GoogleIdentity): Promise<string> {
    return resolveGoogleAccount(pool, identity);
  }

  return {
    async start(returnTo) {
      const nonce = randomToken();
      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const state = encodeState(
        {
          n: nonce,
          v: codeVerifier,
          r: returnTo.slice(0, 200),
          e: Math.floor(now() / 1000) + STATE_TTL_SECONDS,
        },
        codeSecret,
      );
      const url = await oidc.authorizationUrl({
        state,
        nonce,
        codeChallenge,
        redirectUri: settings.redirectUri,
      });
      return { url };
    },

    async finish(query) {
      const error = single(query, 'error');
      if (error) throw new AuthError('invalid_credentials');
      const state = single(query, 'state');
      const code = single(query, 'code');
      if (!state || !code) throw new AuthError('oauth_unavailable');

      const payload = readState(state);
      // RFC 9207: Google advertises `authorization_response_iss_parameter_supported`, so
      // the OIDC client requires the `iss` parameter alongside `code` and `state`. A relay
      // must forward it, otherwise the response is rejected as non-conformant.
      const params = new URLSearchParams({ code, state });
      const issuer = single(query, 'iss');
      if (issuer) params.set('iss', issuer);
      const currentUrl = `${settings.redirectUri}?${params.toString()}`;

      let identity: GoogleIdentity;
      try {
        identity = await oidc.exchange({
          currentUrl,
          state,
          nonce: payload.n,
          codeVerifier: payload.v,
          redirectUri: settings.redirectUri,
        });
      } catch (exchangeError) {
        // A rejected or malformed provider response is a failed sign-in, not an outage;
        // only a transport failure is reported as one.
        if (isTransportFailure(exchangeError)) {
          throw new AuthError('unavailable', { cause: exchangeError });
        }
        throw new AuthError('invalid_credentials', { cause: exchangeError });
      }
      return { userId: await resolveAccount(identity), returnTo: payload.r };
    },
  };
}

/** True when the provider could not be reached at all, rather than refusing the exchange. */
function isTransportFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch/undici network failure
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND';
}

/** Only the return path of the calling app survives, never a full URL or another host. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return '';
  if (!value.startsWith('/') || value.startsWith('//') || /[\\:@?#\s]/.test(value)) return '';
  return value;
}

/**
 * The account for a verified Google identity, shared by every Google entry point: the
 * linked account, else the account that already owns the verified address, else a new
 * customer account. An address Google has not verified never links to anything, and the
 * role comes from provision_account(), so this path can never grant more than customer.
 */
export async function resolveGoogleAccount(pool: Pool, identity: GoogleIdentity): Promise<string> {
  const linked = await withServiceRole(pool, async (client) => {
    const result = await client.query<{ user_id: string }>(
      'select user_id from public.auth_oauth_accounts where provider = $1 and provider_subject = $2',
      ['google', identity.subject],
    );
    return result.rows[0]?.user_id ?? null;
  });
  if (linked) return linked;

  const email = identity.email?.trim().toLowerCase() ?? null;
  if (email === null || !identity.emailVerified) {
    throw new AuthError('email_not_confirmed');
  }

  return withServiceRole(pool, async (client) => {
    const existing = await client.query<{ id: string; email_verified_at: Date | null }>(
      'select id, email_verified_at from public.profiles where lower(email) = $1 for update',
      [email],
    );
    let userId = existing.rows[0]?.id;
    if (userId && existing.rows[0]?.email_verified_at === null) {
      // A profile that claimed this address but never proved it (a password sign-up from
      // before registrations were verified). Google has now proved who owns the address, so
      // that owner takes it over: the unverified password is dropped — whoever chose it may
      // not be the owner — any session is ended, and the account is activated.
      await client.query(
        `update public.profiles
            set password_hash = null, email_verified_at = now(),
                failed_login_count = 0, locked_until = null
          where id = $1::uuid`,
        [userId],
      );
      await client.query(
        'update public.auth_sessions set revoked_at = now() where user_id = $1::uuid and revoked_at is null',
        [userId],
      );
      await client.query('select public.queue_welcome_email($1::uuid)', [userId]);
    }
    if (!userId) {
      const created = await client.query<{ id: string }>(
        'select public.provision_account($1::uuid, $2, $3, null, null, true) as id',
        [randomUUID(), email, identity.name ?? null],
      );
      userId = created.rows[0]?.id;
      if (!userId) throw new AuthError('unavailable');
      // The account is genuinely new: its welcome email is queued once, in this transaction.
      await client.query('select public.queue_welcome_email($1::uuid)', [userId]);
    }
    // A password sign-up waiting for its code can no longer claim an address Google verified.
    await client.query('delete from public.auth_pending_registrations where email = $1', [email]);
    await client.query(
      `insert into public.auth_oauth_accounts (provider, provider_subject, user_id, email)
       values ($1, $2, $3::uuid, $4)
       on conflict (provider, provider_subject) do update set user_id = excluded.user_id`,
      ['google', identity.subject, userId, email],
    );
    return userId;
  });
}
