import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** The two Nilzora web apps. Each keeps its own cookies, even on a shared host. */
export type WebApp = 'storefront' | 'admin';

/** Local development servers; never used in production. */
const DEVELOPMENT_ORIGINS: Record<WebApp, string> = {
  storefront: 'http://localhost:3000',
  admin: 'http://localhost:3001',
};
const DEVELOPMENT_API_URL = 'http://localhost:4000';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const envSchema = z.object({
  /** Origin of the Nilzora API, reached from this server only (never from browsers). */
  NILZORA_API_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' })
    .optional(),
  /** Exact public origin of this web app, used to reject cross-site form posts. */
  APP_ORIGIN: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http(s) origin' })
    .optional(),
  /** Key for signing CSRF tokens. At least 32 random characters; server-only. */
  SESSION_SECRET: z.string().min(32).max(512).optional(),
  /** The API's TRUSTED_CLIENT_SECRET, so it can rate-limit each browser separately. */
  API_CLIENT_SECRET: z.string().min(32).max(512).optional(),
  /** Reverse proxies in front of this server whose X-Forwarded-For entries are trusted. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

export interface WebSessionConfig {
  app: WebApp;
  /** Production enables Secure, `__Host-` cookies and requires every secret. */
  production: boolean;
  apiUrl: string;
  appOrigin: string;
  /** Never log, render or forward. */
  sessionSecret: Buffer;
  /** Never log, render or forward except to the API in its dedicated header. */
  apiClientSecret: string | undefined;
  trustProxyHops: number;
}

/** Raised for invalid settings. Messages name variables, never their values. */
export class WebSessionConfigError extends Error {
  override readonly name = 'WebSessionConfigError';
  readonly problems: readonly string[];

  constructor(app: WebApp, problems: readonly string[]) {
    super(
      `Invalid Nilzora ${app} session configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.problems = problems;
  }
}

function apiUrlProblems(apiUrl: string | undefined, production: boolean): string[] {
  if (apiUrl === undefined) return ['NILZORA_API_URL: required in production'];
  // `next start` always runs in production mode, so a local production run on this
  // machine may use http; any other host must be https.
  if (
    production &&
    !apiUrl.startsWith('https://') &&
    !LOOPBACK_HOSTS.has(new URL(apiUrl).hostname)
  ) {
    return ['NILZORA_API_URL: must use https in production unless it is on this machine'];
  }
  return [];
}

function bareOrigin(value: string): string | undefined {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return undefined;
  }
  return value.endsWith('/') ? undefined : url.origin;
}

/** The development keys, kept on the one object every bundle of a server process shares. */
interface DevelopmentSecrets {
  __nilzoraDevelopmentSecrets?: Partial<Record<WebApp, Buffer>>;
}

/**
 * The key a development server signs CSRF tokens with when SESSION_SECRET is unset.
 *
 * Next compiles a page, a Server Action and a route handler into separate bundles, and each
 * bundle gets its own copy of this module. A key generated per module would therefore differ
 * between the page that renders a form and the route that checks it, and every upload would be
 * refused as an expired form. `globalThis` is the only state those bundles share, so the key
 * lives there: one per process per app, still random, still gone on restart. Production never
 * reaches this code — it requires a real SESSION_SECRET.
 */
function developmentSecret(app: WebApp): Buffer {
  const shared = globalThis as typeof globalThis & DevelopmentSecrets;
  const existing = shared.__nilzoraDevelopmentSecrets?.[app];
  if (existing !== undefined) return existing;

  const created = randomBytes(32);
  shared.__nilzoraDevelopmentSecrets = {
    ...shared.__nilzoraDevelopmentSecrets,
    [app]: created,
  };
  return created;
}

/**
 * Validates the web app's server environment. Outside production, local defaults
 * apply and a missing SESSION_SECRET is replaced by a random key that every bundle of
 * this server process shares (see developmentSecret), so forms rendered before a
 * restart must be reloaded.
 */
export function loadWebSessionConfig(
  app: WebApp,
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
): WebSessionConfig {
  const input = Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, env[key] === '' ? undefined : env[key]]),
  );
  const parsed = envSchema.safeParse(input);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  if (!parsed.success) throw new WebSessionConfigError(app, problems);
  const values = parsed.data;

  const apiUrl = values.NILZORA_API_URL ?? (production ? undefined : DEVELOPMENT_API_URL);
  const originSource = values.APP_ORIGIN ?? (production ? undefined : DEVELOPMENT_ORIGINS[app]);
  const appOrigin = originSource === undefined ? undefined : bareOrigin(originSource);

  problems.push(...apiUrlProblems(apiUrl, production));
  if (originSource === undefined) problems.push('APP_ORIGIN: required in production');
  else if (appOrigin === undefined) {
    problems.push('APP_ORIGIN: must be a bare origin without a path or trailing slash');
  }
  if (production) {
    // As for the API URL, a local production run may use http on this machine only.
    if (
      appOrigin !== undefined &&
      !appOrigin.startsWith('https://') &&
      !LOOPBACK_HOSTS.has(new URL(appOrigin).hostname)
    ) {
      problems.push('APP_ORIGIN: must use https in production unless it is on this machine');
    }
    if (values.SESSION_SECRET === undefined)
      problems.push('SESSION_SECRET: required in production');
    if (values.API_CLIENT_SECRET === undefined) {
      problems.push('API_CLIENT_SECRET: required in production (the API TRUSTED_CLIENT_SECRET)');
    }
  }
  if (values.SESSION_SECRET !== undefined && values.SESSION_SECRET === values.API_CLIENT_SECRET) {
    problems.push('SESSION_SECRET: must differ from API_CLIENT_SECRET');
  }
  if (problems.length > 0 || apiUrl === undefined || appOrigin === undefined) {
    throw new WebSessionConfigError(app, problems);
  }

  return {
    app,
    production,
    apiUrl: apiUrl.replace(/\/+$/, ''),
    appOrigin,
    sessionSecret:
      values.SESSION_SECRET === undefined
        ? developmentSecret(app)
        : Buffer.from(values.SESSION_SECRET, 'utf8'),
    apiClientSecret: values.API_CLIENT_SECRET,
    trustProxyHops: values.TRUST_PROXY_HOPS,
  };
}

/**
 * Only the API's address, for clients that carry nothing about the visitor (public
 * catalog reads). It needs none of the session secrets, so pages that only read the
 * catalog work without them, and their absence never leaks into such code paths.
 */
export function loadApiUrl(
  app: WebApp,
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
): string {
  const raw = env.NILZORA_API_URL === '' ? undefined : env.NILZORA_API_URL;
  const parsed = envSchema.shape.NILZORA_API_URL.safeParse(raw);
  if (!parsed.success) {
    throw new WebSessionConfigError(
      app,
      parsed.error.issues.map((issue) => `NILZORA_API_URL: ${issue.message}`),
    );
  }
  const apiUrl = parsed.data ?? (production ? undefined : DEVELOPMENT_API_URL);
  const problems = apiUrlProblems(apiUrl, production);
  if (problems.length > 0 || apiUrl === undefined) throw new WebSessionConfigError(app, problems);
  return apiUrl.replace(/\/+$/, '');
}

const loadedApiUrls = new Map<WebApp, string>();

/** The process-wide API address, validated on first use. */
export function getApiUrl(app: WebApp): string {
  let apiUrl = loadedApiUrls.get(app);
  if (apiUrl === undefined) {
    apiUrl = loadApiUrl(app, process.env, process.env.NODE_ENV === 'production');
    loadedApiUrls.set(app, apiUrl);
  }
  return apiUrl;
}

const loaded = new Map<WebApp, WebSessionConfig>();

/** The process-wide configuration, validated on first use (never during the build). */
export function getWebSessionConfig(app: WebApp): WebSessionConfig {
  let config = loaded.get(app);
  if (!config) {
    config = loadWebSessionConfig(app, process.env, process.env.NODE_ENV === 'production');
    loaded.set(app, config);
  }
  return config;
}
