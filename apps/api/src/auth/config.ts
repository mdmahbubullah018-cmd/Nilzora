import { parseSecretBoxKey } from './secret-box';
import { createEmailSender, smtpSettings, type EmailSender } from './sender';

export interface FirstPartySettings {
  /** Pepper for six-digit codes. Server-only; never logged or returned. */
  codeSecret: string;
  email: EmailSender | undefined;
  accessTtlSeconds: number | undefined;
  refreshTtlSeconds: number | undefined;
}

export interface GoogleSettings {
  clientId: string;
  /** Never log, return or forward this value. */
  clientSecret: string;
  redirectUri: string;
}

const DEFAULT_ACCESS_TTL = 15 * 60;
const DEFAULT_REFRESH_TTL = 30 * 24 * 60 * 60;

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(trimmed(value) ?? '');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * First-party authentication is on only when `OTP_HASH_SECRET` is set. Without it the
 * API keeps using Supabase Auth, so a missing setting degrades instead of failing.
 * `OTP_HASH_SECRET` must be at least 32 characters: it peppers every emailed code.
 */
export function firstPartySettings(
  env: NodeJS.ProcessEnv = process.env,
): FirstPartySettings | undefined {
  const codeSecret = trimmed(env.OTP_HASH_SECRET);
  if (!codeSecret || codeSecret.length < 32) return undefined;
  return {
    codeSecret,
    email: createEmailSender(smtpSettings(env)),
    accessTtlSeconds: positiveInteger(env.SESSION_ACCESS_TTL_SECONDS, DEFAULT_ACCESS_TTL),
    refreshTtlSeconds: positiveInteger(env.SESSION_REFRESH_TTL_SECONDS, DEFAULT_REFRESH_TTL),
  };
}

/**
 * The key that encrypts the super_admin TOTP secrets at rest: 32 bytes as base64 or hex, from
 * TWO_FACTOR_ENCRYPTION_KEY. Undefined when unset. A malformed value throws (the API refuses to
 * start rather than run with a key it cannot use). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export function twoFactorKey(env: NodeJS.ProcessEnv = process.env): Buffer | undefined {
  return parseSecretBoxKey(env.TWO_FACTOR_ENCRYPTION_KEY);
}

/** Google sign-in stays off — and its routes answer 503 — until all three settings exist. */
export function googleSettings(env: NodeJS.ProcessEnv = process.env): GoogleSettings | undefined {
  const clientId = trimmed(env.GOOGLE_CLIENT_ID);
  const clientSecret = trimmed(env.GOOGLE_CLIENT_SECRET);
  const redirectUri = trimmed(env.GOOGLE_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return { clientId, clientSecret, redirectUri };
}

/**
 * Client ids accepted as the audience of a Google ID token from a native app. The app
 * signs in with the web client id (`webClientId`), so a token's `aud` is normally that;
 * `GOOGLE_ANDROID_CLIENT_ID` is accepted too for apps configured with only an Android
 * client. Empty when Google is not configured at all.
 */
export function googleAudiences(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const web = trimmed(env.GOOGLE_CLIENT_ID);
  if (!web) return [];
  const android = trimmed(env.GOOGLE_ANDROID_CLIENT_ID);
  return android && android !== web ? [web, android] : [web];
}
