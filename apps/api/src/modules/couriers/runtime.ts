import type { CourierMode, CourierProviderId } from '@nilzora/contracts';
import { COURIER_CREDENTIAL_FIELDS, parseCourierBaseUrl, type CourierConfig } from './config';
import type { CourierRuntimeSettings, CourierStore } from './store';
import type { AdapterContext } from './types';

/*
 * The courier settings the API runs on, read from the database (service_courier_runtime)
 * rather than the environment, and cached for a few seconds. Every admin change invalidates
 * the cache, so a saved switch applies to the very next request; another API instance picks
 * it up within the cache lifetime.
 *
 * The EFFECTIVE mode can be stricter than the saved one: test (mock) mode is honoured only
 * when the API's database is local and NODE_ENV is not production, so test shipments can
 * never be created in production data. A saved mock mode is then treated as off, with a
 * notice the admin screen shows.
 */

const DEFAULT_TTL_MS = 5_000;

export interface EffectiveCourierRuntime {
  /** As saved by the owner. */
  saved: CourierRuntimeSettings;
  /** The mode actually in effect. */
  mode: CourierMode;
  /** Real API bookings are on (live mode and the saved switch). */
  bookingEnabled: boolean;
  /** Automatic tracking sync is on (any mode but off, and the saved switch). */
  trackingSyncEnabled: boolean;
  trackingSyncIntervalSeconds: number;
  httpTimeoutMs: number;
  databaseTarget: CourierConfig['databaseTarget'];
  mockAllowed: boolean;
  /** Why the saved mode is not in effect, when it is not. */
  modeNotice: string | null;
}

/** Why test mode is not allowed here (null when it is). */
export function mockRefusal(config: CourierConfig): string | null {
  if (config.mockAllowed) return null;
  return config.databaseTarget === 'local'
    ? 'Courier test mode is not allowed while the API runs in production'
    : 'Courier test mode is allowed only with a local database: test shipments must never reach real data';
}

export function effectiveRuntime(
  saved: CourierRuntimeSettings,
  config: CourierConfig,
): EffectiveCourierRuntime {
  const refusal = saved.mode === 'mock' ? mockRefusal(config) : null;
  const mode: CourierMode = refusal === null ? saved.mode : 'off';
  return {
    saved,
    mode,
    bookingEnabled: mode === 'live' && saved.bookingEnabled,
    trackingSyncEnabled: mode !== 'off' && saved.trackingSyncEnabled,
    trackingSyncIntervalSeconds: saved.trackingSyncIntervalSeconds,
    httpTimeoutMs: saved.httpTimeoutMs,
    databaseTarget: config.databaseTarget,
    mockAllowed: config.mockAllowed,
    modeNotice: refusal === null ? null : `${refusal}. The saved test mode is treated as off.`,
  };
}

/**
 * A courier's base URL: the admin-saved one first (validated again against the courier's
 * allow-list, so a value written around the API is never trusted), the environment's next.
 */
export function resolveBaseUrl(
  provider: CourierProviderId,
  saved: string | null,
  config: CourierConfig,
): { url: string | null; valid: boolean } {
  if (saved !== null && saved !== '') {
    const parsed = parseCourierBaseUrl('apiBaseUrl', provider, saved);
    return 'url' in parsed ? { url: parsed.url, valid: true } : { url: saved, valid: false };
  }
  const fallback = config.baseUrls[provider];
  return { url: fallback ?? null, valid: fallback !== undefined };
}

export interface CourierRuntime {
  current(): Promise<EffectiveCourierRuntime>;
  /** Credentials (Vault first, the environment per field), base URL and timeout. */
  adapterContext(provider: CourierProviderId): Promise<AdapterContext>;
  /** Forget the cached settings and credentials (after every admin change). */
  invalidate(): void;
}

export function createCourierRuntime(options: {
  store: Pick<CourierStore, 'runtime' | 'credentials'>;
  config: CourierConfig;
  ttlMs?: number;
  now?: () => number;
}): CourierRuntime {
  const { store, config } = options;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  let settings: { at: number; value: Promise<EffectiveCourierRuntime> } | undefined;
  const secrets = new Map<
    CourierProviderId,
    { at: number; value: Promise<Record<string, string>> }
  >();

  async function current(): Promise<EffectiveCourierRuntime> {
    if (settings && now() - settings.at < ttl) return settings.value;
    const value = store.runtime().then((saved) => effectiveRuntime(saved, config));
    settings = { at: now(), value };
    try {
      return await value;
    } catch (error) {
      // A failed read is not cached: the next request asks again.
      settings = undefined;
      throw error;
    }
  }

  async function vault(provider: CourierProviderId): Promise<Record<string, string>> {
    const cached = secrets.get(provider);
    if (cached && now() - cached.at < ttl) return cached.value;
    const value = store.credentials(provider);
    secrets.set(provider, { at: now(), value });
    try {
      return await value;
    } catch (error) {
      secrets.delete(provider);
      throw error;
    }
  }

  return {
    current,
    async adapterContext(provider) {
      const [rt, stored] = await Promise.all([current(), vault(provider)]);
      const credentials: Record<string, string> = {};
      for (const field of COURIER_CREDENTIAL_FIELDS[provider]) {
        const value = stored[field] ?? config.credentials[provider][field];
        if (value !== undefined && value !== '') credentials[field] = value;
      }
      const row = rt.saved.providers.find((p) => p.provider === provider);
      const base = resolveBaseUrl(provider, row?.apiBaseUrl ?? null, config);
      return {
        credentials,
        baseUrl: base.valid && base.url !== null ? base.url : undefined,
        timeoutMs: rt.httpTimeoutMs,
      };
    },
    invalidate() {
      settings = undefined;
      secrets.clear();
    },
  };
}
