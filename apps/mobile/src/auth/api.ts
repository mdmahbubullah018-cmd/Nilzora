import { createApiClient, type ApiClient } from '@nilzora/api-client';
import Constants from 'expo-constants';

export type ApiConfigProblem = 'missing' | 'invalid' | 'insecure';

export type ApiConfig = { ok: true; baseUrl: string } | { ok: false; problem: ApiConfigProblem };

/** Origin (plus optional path) of the API; no credentials, query or fragment. */
const API_BASE_URL = /^(https?):\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[^\s?#@]*)?$/;

/**
 * Validates the configured API address. Plain http is accepted only in development
 * builds (a laptop on the LAN); release builds must use https, because bearer tokens
 * travel on every call.
 */
export function parseApiBaseUrl(
  value: string | undefined,
  { allowHttp }: { allowHttp: boolean },
): ApiConfig {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { ok: false, problem: 'missing' };
  const match = API_BASE_URL.exec(trimmed);
  if (!match) return { ok: false, problem: 'invalid' };
  if (match[1] === 'http' && !allowHttp) return { ok: false, problem: 'insecure' };
  return { ok: true, baseUrl: trimmed.replace(/\/+$/, '') };
}

/** Mobile networks are slower than a server-to-server hop. */
const MOBILE_TIMEOUT_MS = 15_000;

export type MobileApi = { ok: true; api: ApiClient } | { ok: false; problem: ApiConfigProblem };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/**
 * The computer's address as the phone reached it for the JavaScript bundle (Metro), e.g.
 * "192.168.1.20" from a hostUri of "192.168.1.20:8081". Development only; null when unknown,
 * or when the bundle came through a tunnel, which cannot reach a local API port.
 */
export function devServerHost(hostUri: string | null | undefined): string | null {
  const host = hostUri?.trim().replace(/:\d{1,5}$/, '') ?? '';
  if (host === '' || LOOPBACK_HOSTS.has(host)) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(host) || /\.exp\.direct$/i.test(host)) return null;
  return host;
}

/**
 * In a development build, a loopback API address ("localhost") means "the computer running
 * the dev tools". A phone resolves localhost to itself, so the address is pointed at the
 * computer the phone already reached for the bundle. Any other address is used as written,
 * and release builds are never rewritten.
 */
export function resolveDevApiAddress(baseUrl: string, metroHost: string | null): string {
  if (metroHost === null) return baseUrl;
  const match = /^(https?:\/\/)([^/:]+)(.*)$/.exec(baseUrl);
  if (!match?.[1] || !match[2] || !LOOPBACK_HOSTS.has(match[2].toLowerCase())) return baseUrl;
  return `${match[1]}${metroHost}${match[3] ?? ''}`;
}

/** The API address this build uses, or why there is none. */
export function configuredApiAddress(): ApiConfig {
  // Written out in full: Expo inlines `process.env.EXPO_PUBLIC_*` only for this exact
  // form at build time. The value is a public address, not a secret.
  const config = parseApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, { allowHttp: __DEV__ });
  if (!config.ok || !__DEV__) return config;
  const metro = devServerHost(Constants.expoConfig?.hostUri);
  return { ok: true, baseUrl: resolveDevApiAddress(config.baseUrl, metro) };
}

/** Builds a new API client from the bundled configuration, or reports why it cannot. */
export function createMobileApi(): MobileApi {
  const config = configuredApiAddress();
  if (!config.ok) return config;
  return {
    ok: true,
    api: createApiClient({ baseUrl: config.baseUrl, timeoutMs: MOBILE_TIMEOUT_MS }),
  };
}

/** The configured API address, for the native upload task that talks to the API directly. */
export function getMobileApiBaseUrl(): string | null {
  const config = configuredApiAddress();
  return config.ok ? config.baseUrl : null;
}

let sharedApi: MobileApi | undefined;

/**
 * The one API client the whole app shares: the session manager and the ApiProvider both
 * use it, so there is a single instance (and a single configuration warning) per launch.
 * Memoised, including a "not configured" outcome: the address is fixed at build time.
 */
export function getMobileApi(): MobileApi {
  sharedApi ??= createMobileApi();
  return sharedApi;
}

/** Forgets the shared client so the next getMobileApi() reads the configuration again. Tests only. */
export function resetMobileApi(): void {
  sharedApi = undefined;
}
