import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { AuthError } from './first-party';
import type { GoogleIdentity } from './oauth';

/*
 * Google ID-token verification for native apps.
 * ---------------------------------------------
 * A native Android app obtains an ID token from Google Identity Services and hands it to
 * the API. Nothing in that token is taken on trust: this module checks the RS256 signature
 * against Google's published keys, the issuer, the audience (this deployment's client id),
 * the expiry, and the `email_verified` claim before returning an identity. The token's own
 * claims are the only source of the address and subject, so a client cannot claim an
 * account by sending a made-up email.
 *
 * The keys are cached for as long as Google's Cache-Control allows and refetched once when
 * an unknown key id appears, which is what rotation looks like.
 */

const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google has used both spellings in `iss`. */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * A Google OAuth client id is `<project number>-<random>.apps.googleusercontent.com`, and the
 * number is the Google Cloud project the client belongs to. Every client of one project (web,
 * Android, iOS) is a different id with the same number.
 */
const CLIENT_ID_SHAPE = /^(\d{6,})-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

/** The project number inside a Google client id, or null when the value is not one. */
function projectOf(clientId: string): string | null {
  return CLIENT_ID_SHAPE.exec(clientId)?.[1] ?? null;
}

const CLOCK_SKEW_SECONDS = 120;
const DEFAULT_CACHE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 8_000;
/** A Google ID token is a few kilobytes; anything larger is not one. */
const MAX_TOKEN_LENGTH = 8_192;

export interface GoogleIdTokenVerifierOptions {
  /** Client ids accepted as the token audience, e.g. the web client id the app signs in with. */
  audiences: readonly string[];
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  jwksUri?: string | undefined;
}

export interface GoogleIdTokenVerifier {
  /** The identity the token proves, or an AuthError when it proves nothing. */
  verify(idToken: string): Promise<GoogleIdentity>;
}

interface IdTokenHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

function decodeSegment<T>(segment: string | undefined): T | undefined {
  if (!segment) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

/** A failed check is a refused sign-in; only an unreachable key set is an outage. */
function invalid(): AuthError {
  return new AuthError('invalid_credentials');
}

/** Google sends `true` (and, in older tokens, the string "true"). */
function isVerified(value: unknown): boolean {
  return value === true || value === 'true';
}

export function createGoogleIdTokenVerifier({
  audiences,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  jwksUri = GOOGLE_JWKS_URI,
}: GoogleIdTokenVerifierOptions): GoogleIdTokenVerifier {
  const allowed = new Set(audiences);
  /** The Google Cloud projects the accepted client ids belong to. */
  const projects = new Set(
    [...allowed].map(projectOf).filter((project): project is string => project !== null),
  );
  let keys = new Map<string, KeyObject>();
  let expiresAt = 0;
  let inflight: Promise<void> | undefined;

  async function loadKeys(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(jwksUri, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new AuthError('unavailable');
      const body: unknown = await response.json();
      const rawKeys =
        typeof body === 'object' && body !== null ? (body as { keys?: unknown }).keys : undefined;
      const list: unknown[] = Array.isArray(rawKeys) ? rawKeys : [];
      const next = new Map<string, KeyObject>();
      for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) continue;
        const jwk = entry as { kid?: unknown; kty?: unknown; n?: unknown; e?: unknown };
        if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
        try {
          next.set(
            jwk.kid,
            createPublicKey({
              key: { kty: 'RSA', n: jwk.n as string, e: jwk.e as string },
              format: 'jwk',
            }),
          );
        } catch {
          // A key this runtime cannot read is skipped rather than failing the whole set.
        }
      }
      if (next.size === 0) throw new AuthError('unavailable');
      keys = next;
      const maxAge = Number(
        /(?:max-age=)(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1],
      );
      const ttl = Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_CACHE_SECONDS;
      expiresAt = now() + Math.min(ttl, 24 * 3600) * 1000;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('unavailable', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Loads the key set, collapsing concurrent requests into one. */
  function refresh(): Promise<void> {
    inflight ??= loadKeys().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  async function keyFor(kid: string): Promise<KeyObject | undefined> {
    if (keys.size === 0 || now() >= expiresAt) await refresh();
    const cached = keys.get(kid);
    if (cached) return cached;
    // An unknown key id usually means Google rotated: look once more, then give up.
    await refresh();
    return keys.get(kid);
  }

  return {
    async verify(idToken) {
      if (
        typeof idToken !== 'string' ||
        idToken.length === 0 ||
        idToken.length > MAX_TOKEN_LENGTH
      ) {
        throw invalid();
      }
      const [rawHeader, rawClaims, rawSignature] = idToken.split('.');
      if (!rawHeader || !rawClaims || !rawSignature) throw invalid();

      const header = decodeSegment<IdTokenHeader>(rawHeader);
      const claims = decodeSegment<IdTokenClaims>(rawClaims);
      if (!header || !claims) throw invalid();
      // Only RS256 is accepted: "none" or a symmetric algorithm would defeat verification.
      if (header.alg !== 'RS256') throw invalid();
      if (typeof header.kid !== 'string' || header.kid.length === 0) throw invalid();

      const key = await keyFor(header.kid);
      if (!key) throw invalid();

      const signed = Buffer.from(`${rawHeader}.${rawClaims}`, 'utf8');
      const signature = Buffer.from(rawSignature, 'base64url');
      let valid = false;
      try {
        valid = verifySignature('RSA-SHA256', signed, key, signature);
      } catch {
        valid = false;
      }
      if (!valid) throw invalid();

      if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) throw invalid();

      const audience = claims.aud;
      const audiencesOfToken = Array.isArray(audience)
        ? audience.filter((entry): entry is string => typeof entry === 'string')
        : typeof audience === 'string'
          ? [audience]
          : [];
      if (audiencesOfToken.length === 0) throw invalid();
      // Every audience must be one this API serves, so a token minted for another app fails.
      if (!audiencesOfToken.every((entry) => allowed.has(entry))) throw invalid();
      // `azp` names the client that asked for the token. A native app is a client of its own:
      // Google signs an Android token with `aud` = the server (web) client id the app passed as
      // serverClientId and `azp` = the app's Android OAuth client — a different client in the
      // same Google Cloud project. That pairing is expected and accepted. A token naming a
      // client from another project is refused, so the party is still constrained.
      if (typeof claims.azp === 'string' && !allowed.has(claims.azp)) {
        const project = projectOf(claims.azp);
        if (project === null || !projects.has(project)) throw invalid();
      }

      const nowSeconds = Math.floor(now() / 1000);
      if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
        throw invalid();
      }
      if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
        throw invalid();
      }

      if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw invalid();

      return {
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: isVerified(claims.email_verified),
        name:
          typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name : undefined,
      };
    },
  };
}
