/*
 * The only way a future live courier adapter may reach the network. Nothing uses it while
 * both real adapters are blocked; it exists so that, once a courier's merchant
 * documentation is verified, the adapter inherits these rules instead of re-inventing them:
 *
 *  - https only, and only hosts on that courier's allow-list (checked before any I/O);
 *  - redirects are refused (a redirect could leave the allow-list);
 *  - every request has a timeout (COURIER_HTTP_TIMEOUT_MS);
 *  - nothing is retried here. A non-idempotent call (a booking, a cancellation) that timed
 *    out or got a 5xx may have taken effect, so it is reported `uncertain`; the caller
 *    decides, and a booking is never retried automatically;
 *  - the response body is capped, and must be JSON;
 *  - any text this module produces is passed through `redactSecrets`, so a credential, a
 *    phone number or an email can never reach a log or an error message.
 */

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export interface CourierHttpOptions {
  /** Hosts this client may call (lower case). */
  allowedHosts: readonly string[];
  timeoutMs: number;
  maxResponseBytes?: number;
  /** Values that must never appear in any message (credentials). */
  secrets?: readonly (string | undefined)[];
  /** Replaceable in tests; never a real network in unit tests. */
  fetch?: typeof fetch;
}

export interface CourierHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Readonly<Record<string, string>>;
  /** Serialised as JSON. */
  body?: unknown;
  /**
   * Whether calling again is harmless (a lookup). This client never retries either kind; a
   * future adapter may retry an idempotent call itself, and must never retry the others.
   */
  idempotent: boolean;
}

export type CourierHttpOutcome =
  /** The courier answered with this status and a JSON body. */
  | { kind: 'response'; status: number; body: unknown }
  /** Refused locally before any network I/O (bad URL, host not allowed). Nothing was sent. */
  | { kind: 'blocked'; message: string }
  /** No usable answer; the request may have taken effect at the courier. */
  | {
      kind: 'uncertain';
      reason: 'timeout' | 'network' | 'server_error' | 'too_large' | 'unparseable';
      message: string;
    };

/** Bangladeshi mobile numbers, with or without +88 / 88, and email addresses. */
const PHONE_PATTERN = /(?:\+?88)?01[3-9]\d{8}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Removes credentials and personal data from text that may be logged or returned. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= 4) safe = safe.split(secret).join('[redacted]');
  }
  return safe.replace(PHONE_PATTERN, '[phone]').replace(EMAIL_PATTERN, '[email]');
}

async function readCapped(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createCourierHttpClient(options: CourierHttpOptions) {
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  const limit = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const secrets = options.secrets ?? [];
  const call = options.fetch ?? fetch;
  const safe = (text: string) => redactSecrets(text, secrets);

  return {
    async request(request: CourierHttpRequest): Promise<CourierHttpOutcome> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return { kind: 'blocked', message: 'The courier URL is not valid' };
      }
      if (url.protocol !== 'https:') {
        return { kind: 'blocked', message: 'Courier calls must use https' };
      }
      if (!allowed.has(url.hostname.toLowerCase())) {
        return { kind: 'blocked', message: 'The courier host is not on the allow-list' };
      }
      if (url.username || url.password) {
        return { kind: 'blocked', message: 'Courier URLs must not carry credentials' };
      }

      let response: Response;
      try {
        response = await call(url, {
          method: request.method,
          headers: {
            accept: 'application/json',
            ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...request.headers,
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return timedOut
          ? { kind: 'uncertain', reason: 'timeout', message: 'The courier did not answer in time' }
          : {
              kind: 'uncertain',
              reason: 'network',
              message: safe('The courier could not be reached'),
            };
      }

      let text: string | null;
      try {
        text = await readCapped(response, limit);
      } catch {
        return {
          kind: 'uncertain',
          reason: 'network',
          message: 'The connection to the courier broke during its answer',
        };
      }
      if (text === null) {
        return {
          kind: 'uncertain',
          reason: 'too_large',
          message: 'The courier answer was too large',
        };
      }
      if (response.status >= 500) {
        // Idempotent or not, there is no usable answer; for a booking it may have been created.
        return {
          kind: 'uncertain',
          reason: 'server_error',
          message: `The courier answered with a server error (${response.status})`,
        };
      }
      let body: unknown = null;
      if (text.trim() !== '') {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          return {
            kind: 'uncertain',
            reason: 'unparseable',
            message: 'The courier answer could not be read',
          };
        }
      }
      return { kind: 'response', status: response.status, body };
    },
  };
}

export type CourierHttpClient = ReturnType<typeof createCourierHttpClient>;
