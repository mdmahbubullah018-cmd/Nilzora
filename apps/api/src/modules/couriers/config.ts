import type { CourierProviderId } from '@nilzora/contracts';

/*
 * What the API's environment still says about couriers. Ordinary operating switches (mode,
 * real bookings, tracking sync, timeouts) live in the database and are managed in the admin
 * workspace (20261224090000_courier_operations_and_credentials.sql); the environment keeps
 * only bootstrap values: the mock webhook secret and FALLBACK credentials and base URLs,
 * used per field when the encrypted store (Supabase Vault) has none. Credentials are never
 * logged, never returned (the API reports which fields are set and where) and never sent to
 * a browser or an app.
 */

/** The credential fields each courier's adapter may use (the database's own list). */
export const COURIER_CREDENTIAL_FIELDS: Readonly<Record<CourierProviderId, readonly string[]>> = {
  steadfast: ['api_key', 'secret_key', 'webhook_token'],
  pathao: ['client_id', 'client_secret', 'username', 'password', 'webhook_secret'],
};

/** The fields a live adapter cannot work without (webhook secrets are optional). */
export const REQUIRED_CREDENTIAL_FIELDS: Readonly<Record<CourierProviderId, readonly string[]>> = {
  steadfast: ['api_key', 'secret_key'],
  pathao: ['client_id', 'client_secret', 'username', 'password'],
};

/** Where the API's database lives, for the mock-mode isolation rule. */
export type CourierDatabaseTarget = 'local' | 'hosted' | 'other';

export interface CourierConfig {
  /** The API's database (DATABASE_URL and SUPABASE_URL together). */
  databaseTarget: CourierDatabaseTarget;
  /** Test (mock) mode is allowed only on a local database outside production. */
  mockAllowed: boolean;
  /** Old operating variables still set in the environment (names only): they are ignored. */
  ignoredVariables: readonly string[];
  /** Signs mock webhooks (HMAC-SHA256). Never log, return or forward this value. */
  mockWebhookSecret: string | undefined;
  /** Fallback credentials by courier and field. Never log, return or forward these values. */
  credentials: Readonly<Record<CourierProviderId, Readonly<Record<string, string | undefined>>>>;
  /** Fallback base URLs (already validated against the allow-list). */
  baseUrls: Readonly<Record<CourierProviderId, string | undefined>>;
}

/**
 * The environment variables that used to switch couriers on. They no longer change
 * anything; a start-up warning names any that are still set.
 */
export const RETIRED_COURIER_VARIABLES = [
  'COURIER_MODE',
  'COURIER_BOOKING_ENABLED',
  'COURIER_TRACKING_SYNC_ENABLED',
  'COURIER_TRACKING_SYNC_INTERVAL_SECONDS',
  'COURIER_HTTP_TIMEOUT_MS',
] as const;

/**
 * Hosts each courier's base URL may point at. They come from UNVERIFIED sources (a
 * community Postman collection for Steadfast, the vendor's WooCommerce plugin for Pathao)
 * and must be confirmed against the merchant documentation before any live adapter is
 * written. Nothing calls them today: both real adapters are blocked.
 */
export const COURIER_HOST_ALLOW_LIST: Readonly<Record<CourierProviderId, readonly string[]>> = {
  steadfast: ['portal.packzy.com'],
  pathao: ['api-hermes.pathao.com', 'courier-api-sandbox.pathao.com'],
};

/**
 * A courier base URL: https, on that courier's allow-list, without credentials, a port, a
 * query or a fragment. Returns the normalised URL (no trailing slash) or a problem that
 * names the variable (or field) only, never its value.
 */
export function parseCourierBaseUrl(
  variable: string,
  provider: CourierProviderId,
  value: string,
): { url: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { problem: `${variable}: is not an absolute URL` };
  }
  if (url.protocol !== 'https:') return { problem: `${variable}: must use https` };
  if (url.username || url.password || url.search || url.hash) {
    return { problem: `${variable}: must not contain credentials, a query or a fragment` };
  }
  if (url.port !== '') return { problem: `${variable}: must not name a port` };
  if (!COURIER_HOST_ALLOW_LIST[provider].includes(url.hostname.toLowerCase())) {
    return {
      problem: `${variable}: host is not on the ${provider} allow-list (${COURIER_HOST_ALLOW_LIST[provider].join(', ')})`,
    };
  }
  return { url: url.origin + url.pathname.replace(/\/+$/, '') };
}

/** The settings used when nothing is configured (tests, a failed parse). */
export function emptyCourierConfig(
  databaseTarget: CourierDatabaseTarget = 'other',
  production = false,
): CourierConfig {
  return {
    databaseTarget,
    mockAllowed: databaseTarget === 'local' && !production,
    ignoredVariables: [],
    mockWebhookSecret: undefined,
    credentials: { steadfast: {}, pathao: {} },
    baseUrls: { steadfast: undefined, pathao: undefined },
  };
}
