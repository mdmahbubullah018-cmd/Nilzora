import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import type { FcmConfig } from '../../config/env';

/*
 * Firebase Cloud Messaging over HTTP v1, without the Firebase SDK: a service-account JWT
 * (RS256) is exchanged for a short-lived OAuth token, which authorises each send. Nothing
 * here logs or returns a token, key, message body or response body: results are small
 * machine codes the worker can store and log safely.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ORIGIN = 'https://fcm.googleapis.com';
/** The Android notification channel the mobile app creates (push-service.ts ANDROID_CHANNEL_ID). */
export const ANDROID_CHANNEL_ID = 'default';

const ASSERTION_LIFETIME_SECONDS = 3600;
/** An access token is replaced this long before it expires. */
const TOKEN_EARLY_REFRESH_MS = 60_000;
const MAX_RETRY_AFTER_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Public https URL of a rich picture; omitted for a text-only notification. */
  imageUrl?: string | undefined;
  /** Custom data. Values are strings, as FCM requires. */
  data: Readonly<Record<string, string>>;
  /**
   * The one identity of this notification, sent on every attempt. Android builds its
   * identifier from the remote message's `data.tag` (expo-notifications, FirebaseMessagingDelegate),
   * so a message that arrives twice under the same tag replaces the first instead of stacking.
   * It must be the same value on every attempt of one logical notification.
   */
  tag?: string | undefined;
}

export type PushOutcome =
  | { kind: 'sent' }
  /** The push service says this token can never receive messages again. */
  | { kind: 'invalid_token' }
  /** Worth trying again, no sooner than `retryAfterSeconds` when given. */
  | { kind: 'retry'; code: string; retryAfterSeconds?: number }
  | { kind: 'failed'; code: string }
  /**
   * The request left the process but its fate is unknown: our own timeout fired, or the
   * connection died after the message could have been written. FCM offers no idempotent
   * send, so sending it again could show the same notification twice; the caller must not
   * retry and must not treat it as delivered either.
   */
  | { kind: 'uncertain'; code: string };

export interface PushSender {
  send(message: PushMessage): Promise<PushOutcome>;
}

export interface FcmSenderOptions {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch; replaceable in tests. */
  now?: () => number;
  timeoutMs?: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signAssertion(config: FcmConfig, key: KeyObject, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key);
  return `${header}.${claims}.${base64url(signature)}`;
}

/** Retry-After as seconds: either a number or an HTTP date. */
function retryAfterSeconds(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return undefined;
    seconds = Math.ceil((date - nowMs) / 1000);
  }
  if (seconds <= 0) return undefined;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

interface FcmErrorBody {
  error?: {
    status?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The FCM-specific error code (such as UNREGISTERED) and whether the error points at the token. */
function describeError(body: unknown): { code: string | undefined; aboutToken: boolean } {
  const error = isRecord(body) ? (body as FcmErrorBody).error : undefined;
  if (!isRecord(error)) return { code: undefined, aboutToken: false };
  const details = Array.isArray(error.details) ? (error.details as unknown[]) : [];

  let code: string | undefined;
  let aboutToken = false;
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    if (typeof detail.errorCode === 'string') code = detail.errorCode;
    const violations = Array.isArray(detail.fieldViolations)
      ? (detail.fieldViolations as unknown[])
      : [];
    for (const violation of violations) {
      if (
        isRecord(violation) &&
        typeof violation.field === 'string' &&
        /token/i.test(violation.field)
      ) {
        aboutToken = true;
      }
    }
  }
  if (code === undefined && typeof error.status === 'string') code = error.status;
  if (
    typeof error.message === 'string' &&
    /registration token|message\.token/i.test(error.message)
  ) {
    aboutToken = true;
  }
  return { code, aboutToken };
}

/**
 * Failures of a connection that never opened: nothing was written, so nothing was accepted
 * and the send can safely be repeated. Every other transport failure could have happened
 * after FCM received the message.
 */
const NOT_DELIVERED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function nameOf(error: unknown): string {
  const name = isRecord(error) ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : '';
}

/** The system error code, looked for on the error and on what undici wraps in its `cause`. */
function codeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; isRecord(current) && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * What a failed send request means. A timeout, a reset or a stream cut short may have been
 * accepted by FCM before the answer was lost; reporting it as `retry` is what makes a
 * customer see the same notification twice, so only a connection that never opened is
 * retried.
 */
function sendFailure(error: unknown): PushOutcome {
  const name = nameOf(error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'uncertain', code: 'fcm_timeout' };
  }
  const code = codeOf(error);
  if (code !== undefined && NOT_DELIVERED_CODES.has(code)) {
    return { kind: 'retry', code: 'fcm_network' };
  }
  return { kind: 'uncertain', code: 'fcm_network_uncertain' };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createFcmSender(config: FcmConfig, options: FcmSenderOptions = {}): PushSender {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Parsed once, so an unusable key fails when the sender is created, not on the first send.
  const key = createPrivateKey(config.privateKey);
  const sendUrl = `${FCM_ORIGIN}/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`;

  let cached: { value: string; expiresAt: number } | undefined;
  let inFlight: Promise<{ token: string } | PushOutcome> | undefined;

  async function requestAccessToken(): Promise<{ token: string } | PushOutcome> {
    let response: Response;
    try {
      response = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signAssertion(config, key, now()),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: 'retry', code: 'fcm_network' };
    }
    if (response.status === 429 || response.status >= 500) {
      const wait = retryAfterSeconds(response.headers.get('retry-after'), now());
      return {
        kind: 'retry',
        code: 'fcm_auth_unavailable',
        ...(wait ? { retryAfterSeconds: wait } : {}),
      };
    }
    const body = await readJson(response);
    const value = isRecord(body) ? body.access_token : undefined;
    const lifetime = isRecord(body) && typeof body.expires_in === 'number' ? body.expires_in : 3600;
    if (!response.ok || typeof value !== 'string' || value === '') {
      // A rejected service account is a configuration problem that may be fixed while the
      // API runs, so the notification is retried (within its attempt limit), not dropped.
      return { kind: 'retry', code: 'fcm_auth_rejected' };
    }
    cached = { value, expiresAt: now() + lifetime * 1000 - TOKEN_EARLY_REFRESH_MS };
    return { token: value };
  }

  async function accessToken(): Promise<{ token: string } | PushOutcome> {
    if (cached && cached.expiresAt > now()) return { token: cached.value };
    // Concurrent sends share one token request.
    inFlight ??= requestAccessToken().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  return {
    async send(message) {
      const auth = await accessToken();
      if ('kind' in auth) return auth;

      let response: Response;
      try {
        response = await doFetch(sendUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${auth.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: {
                title: message.title,
                body: message.body,
                // A picture the system can show next to the text. Android renders it
                // expanded; iOS shows it as a thumbnail. Omitted when there is none, so the
                // notification is a normal text one rather than one with a broken image.
                ...(message.imageUrl === undefined ? {} : { image: message.imageUrl }),
              },
              data:
                message.tag === undefined ? message.data : { ...message.data, tag: message.tag },
              android: {
                priority: 'HIGH',
                notification: {
                  channel_id: ANDROID_CHANNEL_ID,
                  ...(message.imageUrl === undefined ? {} : { image: message.imageUrl }),
                },
              },
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return sendFailure(error);
      }

      if (response.ok) return { kind: 'sent' };

      const wait = retryAfterSeconds(response.headers.get('retry-after'), now());
      const retry = (code: string): PushOutcome => ({
        kind: 'retry',
        code,
        ...(wait ? { retryAfterSeconds: wait } : {}),
      });

      if (response.status === 401) {
        // The access token was refused (revoked or clock skew): fetch a new one next time.
        cached = undefined;
        return retry('fcm_unauthenticated');
      }
      if (response.status === 429) return retry('fcm_rate_limited');
      if (response.status >= 500) return retry('fcm_unavailable');

      const { code, aboutToken } = describeError(await readJson(response));
      if (code === 'UNREGISTERED' || response.status === 404) return { kind: 'invalid_token' };
      // The token belongs to another Firebase project: it can never work with this one.
      if (code === 'SENDER_ID_MISMATCH') return { kind: 'invalid_token' };
      if (code === 'INVALID_ARGUMENT' && aboutToken) return { kind: 'invalid_token' };
      if (code === 'QUOTA_EXCEEDED') return retry('fcm_rate_limited');
      if (code === 'UNAVAILABLE' || code === 'INTERNAL') return retry('fcm_unavailable');
      return { kind: 'failed', code: 'fcm_rejected' };
    },
  };
}
