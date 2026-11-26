import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseRedisUrl } from '../cache/redis-url';
import {
  R2EndpointError,
  isR2StorageHost,
  normalizeR2AccountId,
} from '../modules/media/r2-endpoint';
import { deriveChatTicketSecret } from '../realtime/ticket';
import {
  emptyCourierConfig,
  parseCourierBaseUrl,
  RETIRED_COURIER_VARIABLES,
  type CourierConfig,
  type CourierDatabaseTarget,
} from '../modules/couriers/config';

import {
  classifyDatabaseUrl,
  classifySupabaseUrl,
  targetProblems,
  withProjectRef,
  type DatabaseTarget,
} from './target';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = 'development' | 'test' | 'production';

/** Local storefront (3000) and admin (3001) dev servers; never used in production. */
const DEVELOPMENT_CORS_ORIGINS = 'http://localhost:3000,http://localhost:3001';

/** The local admin workspace (3001); staff invitations link to its /accept-invite page. */
const DEVELOPMENT_ADMIN_APP_ORIGIN = 'http://localhost:3001';

const DEFAULT_LOG_LEVEL: Record<NodeEnv, LogLevel> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  /** Comma-separated browser origins allowed by CORS. Required in production. */
  CORS_ORIGINS: z.string().optional(),
  /**
   * Number of reverse-proxy hops whose X-Forwarded-For entries are trusted for the
   * client IP. 0 (default) ignores the header entirely, so it cannot be spoofed.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
  /** Stricter per-IP limit for register, email confirmation, login and token refresh (20 per 15 min). */
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  /** Stricter per-IP limit for placing and cancelling orders (30 per 10 min). */
  ORDER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(600_000),
  ORDER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
  /** Per-IP limit for admin and moderator changes (120 per minute). */
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  /** Per-IP limit for sending chat messages (60 per minute). The database also caps each sender. */
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  /**
   * Upload budgets, per account (or per address when signed out) in one window. These are the
   * ceilings for the expensive operations — a picture is decoded and re-encoded, and a document
   * or a recording is written straight to Cloudflare R2 — so they are deliberately lower than the
   * message limit while still allowing a whole conversation's worth of files in a minute.
   */
  CHAT_UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(86_400_000)
    .default(60_000),
  /** Every upload of any kind together (12 per minute). */
  CHAT_UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(12),
  /** Pictures (8 per minute): each one costs a decode, a resize and two stored objects. */
  CHAT_UPLOAD_IMAGE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(8),
  /** Documents (6 per minute): up to 20 MB each, stored as sent. */
  CHAT_UPLOAD_DOCUMENT_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(6),
  /** Voice messages (6 per minute): five minutes of audio each. */
  CHAT_UPLOAD_AUDIO_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(6),
  /**
   * The worker that drains scheduled automation jobs (`chat_automation_jobs`). Off by
   * default: it needs the direct database connection and the `service_role` grant, so it is
   * switched on deliberately rather than by accident in a read-only or replica setup.
   */
  CHAT_AUTOMATION_WORKER: z.enum(['true', 'false']).default('false'),
  CHAT_AUTOMATION_WORKER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(30_000),
  /** Jobs claimed per tick, so one tick cannot monopolise the connection. */
  CHAT_AUTOMATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  /**
   * The worker that sends customer order emails (order received, out for delivery, return and
   * refund updates) from `email_outbox`. Off by default so a development API never emails a
   * customer by accident; it also needs DATABASE_URL and SMTP to do anything.
   */
  ORDER_EMAIL_WORKER: z.enum(['true', 'false']).default('false'),
  ORDER_EMAIL_WORKER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(15_000),
  /**
   * Visual search. The embedding model runs locally by default (CLIP through ONNX Runtime),
   * so no key is needed and a customer photograph never leaves the server. Setting
   * IMAGE_EMBEDDING_PROVIDER=http switches to the hosted endpoint below.
   */
  IMAGE_SEARCH_ENABLED: z.enum(['true', 'false']).default('true'),
  IMAGE_EMBEDDING_PROVIDER: z.enum(['local', 'http']).default('local'),
  IMAGE_EMBEDDING_MODEL: z.string().min(1).max(120).default('Xenova/clip-vit-base-patch32'),
  IMAGE_EMBEDDING_MODEL_VERSION: z.string().min(1).max(60).default('1'),
  /** Must match the width of the stored vector column (a migration widens it). */
  IMAGE_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(2048).default(512),
  /** Where the local weights are cached. Defaults to <cwd>/.cache/transformers. */
  IMAGE_EMBEDDING_CACHE_DIR: z.string().min(1).max(1024).optional(),
  IMAGE_EMBEDDING_HTTP_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' })
    .optional(),
  IMAGE_EMBEDDING_HTTP_API_KEY: z.string().min(1).max(512).optional(),
  IMAGE_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  /** The worker that embeds queued pictures. On by default; it needs DATABASE_URL. */
  IMAGE_SEARCH_WORKER: z.enum(['true', 'false']).default('true'),
  IMAGE_SEARCH_WORKER_INTERVAL_MS: z.coerce.number().int().min(500).max(600_000).default(3_000),
  IMAGE_SEARCH_WORKER_BATCH: z.coerce.number().int().min(1).max(50).default(4),
  /** Requests per address per window on POST /search/image (the brief's 20 a minute). */
  IMAGE_SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(600).default(20),
  IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  /**
   * Signs the short-lived ticket the web apps use to open a chat socket, because their
   * access tokens live in HttpOnly cookies. Server-only, at least 32 characters. Unset:
   * a separate key is derived from OTP_HASH_SECRET, and without that realtime stays off.
   */
  CHAT_SOCKET_SECRET: z.string().min(32, { error: 'must be at least 32 characters' }).optional(),
  /** Origin of the admin workspace, for invitation links. Required (https) in production. */
  ADMIN_APP_ORIGIN: z.string().optional(),
  /** Supabase project URL (local: `supabase status`). */
  SUPABASE_URL: z.url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' }),
  /**
   * Direct PostgreSQL connection used for queries that must run as a signed-in account.
   * Server-only, never logged. Hosted databases need `?sslmode=require` (or stricter).
   * Unset until the direct connection is configured: those queries then use Supabase.
   */
  DATABASE_URL: z.string().optional(),
  /**
   * Redis for the optional catalog cache (`redis://user:password@host:port/0`, or `rediss://`
   * for TLS). Server-only, never logged. Unset: the cache is off and every read queries the
   * database, exactly as before it existed.
   */
  REDIS_URL: z.string().optional(),
  /** Publishable (anon) key: used for sign-up, sign-in and user-scoped queries under RLS. */
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(
      20,
    ) /** Secret (service-role) key: bypasses RLS. Server-only; used for revocation and role changes. */,
  SUPABASE_SECRET_KEY: z.string().min(20),
  /**
   * Shared secret of the Nilzora web servers (their API_CLIENT_SECRET): a request carrying it
   * may name the browser address used for rate limits. Unset: the headers are ignored.
   * Required in production, where the web servers always send it.
   *
   * This is the canonical name, and it wins when TRUSTED_CLIENT_SECRET is also set.
   */
  API_CLIENT_SECRET: z.string().min(32).max(512).optional(),
  /**
   * Earlier name for the same shared secret, kept so an existing deployment keeps working.
   * Read only when API_CLIENT_SECRET is unset: one name, one secret, no guessing.
   */
  TRUSTED_CLIENT_SECRET: z.string().min(32).max(512).optional(),
  /** Cloudflare R2 media storage. Server-only; media uploads are off until all five are set. */
  R2_ACCOUNT_ID: z.string().min(1).max(128).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).max(256).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).max(512).optional(),
  R2_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
    .optional(),
  /** Public origin that serves the bucket (r2.dev or a custom domain). */
  R2_PUBLIC_BASE_URL: z.string().optional(),
  /** Firebase service account for Cloud Messaging. Server-only; push is off until all three are set. */
  FCM_PROJECT_ID: z.string().min(1).max(128).optional(),
  FCM_CLIENT_EMAIL: z.string().min(1).max(256).optional(),
  FCM_PRIVATE_KEY: z.string().min(1).max(8192).optional(),
  /**
   * Path to the Firebase Admin SDK service-account JSON instead of the three values above.
   * Replacing the file rotates the credential without touching .env. It wins when set.
   */
  FCM_SERVICE_ACCOUNT_FILE: z.string().min(1).max(1024).optional(),
  /*
   * Couriers (Steadfast, Pathao). The operating switches (mode, real bookings, tracking
   * sync, timeouts) are managed in the admin workspace and stored in the database; the
   * environment keeps only bootstrap secrets and fallbacks below.
   */
  /** Signs mock webhooks (HMAC-SHA256). Server-only, at least 32 characters. */
  COURIER_MOCK_WEBHOOK_SECRET: z
    .string()
    .min(32, { error: 'must be at least 32 characters' })
    .max(512)
    .optional(),
  /**
   * Steadfast fallback credentials and base URL, used per field when the encrypted store
   * has none. Server-only; unused while the adapter is blocked.
   */
  STEADFAST_API_BASE_URL: z.string().max(512).optional(),
  STEADFAST_API_KEY: z.string().min(1).max(512).optional(),
  STEADFAST_SECRET_KEY: z.string().min(1).max(512).optional(),
  STEADFAST_WEBHOOK_TOKEN: z.string().min(1).max(512).optional(),
  /** Pathao fallback credentials and base URL, as for Steadfast. */
  PATHAO_API_BASE_URL: z.string().max(512).optional(),
  PATHAO_CLIENT_ID: z.string().min(1).max(512).optional(),
  PATHAO_CLIENT_SECRET: z.string().min(1).max(512).optional(),
  PATHAO_USERNAME: z.string().min(1).max(512).optional(),
  PATHAO_PASSWORD: z.string().min(1).max(512).optional(),
  PATHAO_WEBHOOK_SECRET: z.string().min(1).max(512).optional(),
});

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  /** Never log, return or forward this value. */
  secretKey: string;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  /** Never log, return or forward this value. */
  secretAccessKey: string;
  bucket: string;
  /** Normalised origin (plus optional path) that serves the bucket; object keys are appended. */
  publicBaseUrl: string;
}

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** PEM private key with real newlines. Never log, return or forward this value. */
  privateKey: string;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: LogLevel;
  /** Exact, normalised origins (scheme://host[:port]) allowed by CORS. */
  corsOrigins: readonly string[];
  trustProxyHops: number;
  rateLimit: { windowMs: number; limit: number };
  authRateLimit: { windowMs: number; limit: number };
  orderRateLimit: { windowMs: number; limit: number };
  adminRateLimit: { windowMs: number; limit: number };
  chatRateLimit: { windowMs: number; limit: number };
  /** Upload budgets, per account (or address when signed out), by kind and in total. */
  chatUploadRateLimit: {
    windowMs: number;
    total: number;
    image: number;
    document: number;
    audio: number;
  };
  /**
   * The background worker that drains `chat_automation_jobs`. Off unless asked for, because
   * it needs the direct database connection and the service-role grant.
   */
  chatAutomationWorker: { enabled: boolean; intervalMs: number; batchSize: number };
  orderEmailWorker: { enabled: boolean; intervalMs: number };
  /**
   * Visual search. `provider` describes the model this process produces vectors with; the
   * stored settings row is what the catalogue was indexed against, and the two are compared
   * on the admin screen rather than assumed equal.
   */
  imageSearch: {
    enabled: boolean;
    provider: {
      id: 'local' | 'http';
      model: string;
      modelVersion: string;
      dimensions: number;
      cacheDir?: string | undefined;
      httpUrl?: string | undefined;
      /** Server-only. Never log, return or forward this value. */
      httpApiKey?: string | undefined;
      timeoutMs: number;
    };
    worker: { enabled: boolean; intervalMs: number; batchSize: number };
    rateLimit: { windowMs: number; limit: number };
  };
  /** Undefined when neither CHAT_SOCKET_SECRET nor OTP_HASH_SECRET is set: realtime stays off. */
  realtime: { secret: string } | undefined;
  /** Exact origin of the admin workspace; staff invitations open its /accept-invite page. */
  adminAppOrigin: string;
  supabase: SupabaseConfig;
  /** Direct PostgreSQL connection. Never log, return or forward this value. */
  databaseUrl: string | undefined;
  /**
   * Redis connection for the optional catalog cache. Never log, return or forward this
   * value. Unset: every cached read goes straight to the database.
   */
  redisUrl: string | undefined;
  /** Classification of where `databaseUrl` points, safe to log and to serve. */
  databaseTarget: DatabaseTarget;
  /**
   * The web servers' shared secret (their API_CLIENT_SECRET), from whichever name supplied it.
   * Never log, return or forward this value.
   */
  trustedClientSecret: string | undefined;
  /** Undefined until every R2 setting is present: media uploads are then unavailable. */
  media: R2Config | undefined;
  /** Undefined until every FCM setting is present: push delivery is then switched off. */
  push: FcmConfig | undefined;
  /** Partly configured integrations (outside production), for a start-up warning. */
  incompleteIntegrations: readonly string[];
  /** Courier mode, switches and server-only credentials. */
  couriers: CourierConfig;
}

/** Raised when the environment is invalid. Messages name variables, never their values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid Nilzora API configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

function parseOrigin(entry: string): { origin: string } | { problem: string } {
  if (entry === '*' || entry === 'null') {
    return { problem: 'wildcard and "null" origins are not allowed' };
  }
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return { problem: 'is not an absolute http(s) origin' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { problem: 'must use http or https' };
  }
  if (url.username || url.password) return { problem: 'must not contain credentials' };
  if (url.pathname !== '/' || url.search || url.hash || entry.endsWith('/')) {
    return { problem: 'must be a bare origin without a path, query or trailing slash' };
  }
  return { origin: url.origin };
}

function parseCorsOrigins(
  value: string | undefined,
  nodeEnv: NodeEnv,
  problems: string[],
): string[] {
  const source = value ?? (nodeEnv === 'production' ? undefined : DEVELOPMENT_CORS_ORIGINS);
  if (source === undefined) {
    problems.push('CORS_ORIGINS: required in production (comma-separated https origins)');
    return [];
  }

  const entries = source
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    problems.push('CORS_ORIGINS: must list at least one origin');
    return [];
  }

  const origins: string[] = [];
  entries.forEach((entry, index) => {
    const result = parseOrigin(entry);
    if ('problem' in result) {
      problems.push(`CORS_ORIGINS: entry ${index + 1} ${result.problem}`);
    } else if (nodeEnv === 'production' && !result.origin.startsWith('https://')) {
      problems.push(`CORS_ORIGINS: entry ${index + 1} must use https in production`);
    } else {
      origins.push(result.origin);
    }
  });
  return [...new Set(origins)];
}

function parseAdminAppOrigin(
  value: string | undefined,
  nodeEnv: NodeEnv,
  problems: string[],
): string {
  const source = value ?? (nodeEnv === 'production' ? undefined : DEVELOPMENT_ADMIN_APP_ORIGIN);
  if (source === undefined) {
    problems.push('ADMIN_APP_ORIGIN: required in production (the https origin of the admin app)');
    return '';
  }
  const result = parseOrigin(source.trim());
  if ('problem' in result) {
    problems.push(`ADMIN_APP_ORIGIN: ${result.problem}`);
    return '';
  }
  if (nodeEnv === 'production' && !result.origin.startsWith('https://')) {
    problems.push('ADMIN_APP_ORIGIN: must use https in production');
    return '';
  }
  return result.origin;
}

/** Catches keys pasted into the wrong variable, which would silently change privileges. */
function checkSecrets(
  values: {
    SUPABASE_URL: string;
    SUPABASE_PUBLISHABLE_KEY: string;
    SUPABASE_SECRET_KEY: string;
    API_CLIENT_SECRET?: string | undefined;
    TRUSTED_CLIENT_SECRET?: string | undefined;
  },
  nodeEnv: NodeEnv,
  problems: string[],
): void {
  if (nodeEnv === 'production' && !values.SUPABASE_URL.startsWith('https://')) {
    problems.push('SUPABASE_URL: must use https in production');
  }
  if (values.SUPABASE_SECRET_KEY === values.SUPABASE_PUBLISHABLE_KEY) {
    problems.push('SUPABASE_SECRET_KEY: must differ from SUPABASE_PUBLISHABLE_KEY');
  }
  if (values.SUPABASE_SECRET_KEY.startsWith('sb_publishable_')) {
    problems.push('SUPABASE_SECRET_KEY: contains a publishable key; use the secret key');
  }
  if (values.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_')) {
    problems.push('SUPABASE_PUBLISHABLE_KEY: contains a secret key, which must stay server-only');
  }
  const clientSecret = values.API_CLIENT_SECRET ?? values.TRUSTED_CLIENT_SECRET;
  // The variable that supplied the value, so a message names the one the deployment set.
  const clientSecretName =
    values.API_CLIENT_SECRET !== undefined ? 'API_CLIENT_SECRET' : 'TRUSTED_CLIENT_SECRET';
  if (nodeEnv === 'production' && clientSecret === undefined) {
    // Without it every storefront and admin visitor shares the web server's rate limit.
    problems.push('API_CLIENT_SECRET: required in production (the same value in the web servers)');
  }
  if (
    clientSecret !== undefined &&
    (clientSecret === values.SUPABASE_SECRET_KEY ||
      clientSecret === values.SUPABASE_PUBLISHABLE_KEY)
  ) {
    problems.push(`${clientSecretName}: must be its own random value, not a Supabase key`);
  }
}

/**
 * A direct database URL must be a real PostgreSQL connection string, and in production
 * it must be encrypted: the connection carries every query the API runs as a user.
 */
/**
 * The embedding configuration must agree with the indexed vector column: pgvector's HNSW
 * index is built for one fixed width, so a provider that returned a different number of
 * values could neither be compared with nor inserted beside the vectors already stored.
 */
function checkImageSearch(
  values: z.infer<typeof envSchema> | undefined,
  problems: string[],
): void {
  if (values === undefined) return;
  if (values.IMAGE_EMBEDDING_DIMENSIONS !== 512) {
    problems.push(
      'IMAGE_EMBEDDING_DIMENSIONS: must be 512, the width of the indexed vector column (a migration rebuilds that column for another model)',
    );
  }
  if (values.IMAGE_EMBEDDING_PROVIDER === 'http' && values.IMAGE_EMBEDDING_HTTP_URL === undefined) {
    problems.push('IMAGE_EMBEDDING_HTTP_URL: is required when IMAGE_EMBEDDING_PROVIDER is http');
  }
}

function checkDatabaseUrl(
  databaseUrl: string | undefined,
  nodeEnv: NodeEnv,
  problems: string[],
): void {
  if (databaseUrl === undefined) return;
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL: must be a postgres:// or postgresql:// connection string');
    return;
  }
  if (
    nodeEnv === 'production' &&
    !/[?&]sslmode=(require|verify-ca|verify-full)(&|$)/.test(databaseUrl)
  ) {
    problems.push('DATABASE_URL: must enable TLS in production (sslmode=require or stricter)');
  }
}

/**
 * A database and Supabase API must describe the same stack. A mismatch is refused rather
 * than warned about: Auth against one environment with rows in another loses accounts, and
 * the damage is only visible much later. Production may never run on the local stack, and
 * the test environment may never reach the hosted one, so a stray `DATABASE_URL` in the
 * shell cannot point a test run at real data.
 */
function checkTarget(
  databaseUrl: string | undefined,
  database: DatabaseTarget,
  supabase: DatabaseTarget,
  nodeEnv: NodeEnv,
  problems: string[],
): void {
  // With no direct connection the API uses Supabase's Data API only, so there are no two
  // stacks to disagree.
  if (databaseUrl === undefined) return;
  // A malformed scheme is already reported by checkDatabaseUrl; comparing stacks as well
  // would bury that one real problem under a second, misleading one.
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) return;
  problems.push(...targetProblems(database, supabase));
  if (nodeEnv === 'production' && database.mode !== 'other' && database.mode !== 'hosted') {
    problems.push('DATABASE_URL: production must not use the local database');
  }
  if (nodeEnv === 'test' && database.mode === 'hosted') {
    problems.push('DATABASE_URL: tests must not connect to a hosted database');
  }
}

/**
 * `REDIS_URL` is optional. A value that cannot be used turns the cache off with a warning
 * instead of stopping the API: an optional cache must never be able to take the shop down.
 */
function resolveRedisUrl(redisUrl: string | undefined): {
  url: string | undefined;
  warning?: string;
} {
  if (redisUrl === undefined || redisUrl.trim() === '') return { url: undefined };
  const parsed = parseRedisUrl(redisUrl);
  if (parsed.ok) return { url: redisUrl };
  return {
    url: undefined,
    warning: `Redis cache (REDIS_URL ${parsed.problem.replaceAll('_', ' ')}; expected redis://host:port, for example redis://localhost:6379/0)`,
  };
}

/**
 * An integration is on when all of its variables are set and off when none are. A partial
 * set is a mistake: it fails the start in production and is reported (not used) elsewhere.
 */
function integrationState(
  name: string,
  values: Record<string, string | undefined>,
  nodeEnv: NodeEnv,
  problems: string[],
  incomplete: string[],
): 'on' | 'off' {
  const keys = Object.keys(values);
  const missing = keys.filter((key) => values[key] === undefined);
  if (missing.length === 0) return 'on';
  if (missing.length === keys.length) return 'off';
  if (nodeEnv === 'production') {
    problems.push(`${name}: set all of ${keys.join(', ')} (missing ${missing.join(', ')})`);
  } else {
    incomplete.push(`${name} (missing ${missing.join(', ')})`);
  }
  return 'off';
}

function parsePublicBaseUrl(value: string, nodeEnv: NodeEnv, problems: string[]): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    problems.push('R2_PUBLIC_BASE_URL: is not an absolute URL');
    return '';
  }
  const secure = url.protocol === 'https:';
  if (!secure && (nodeEnv === 'production' || url.protocol !== 'http:')) {
    problems.push('R2_PUBLIC_BASE_URL: must use https');
    return '';
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push('R2_PUBLIC_BASE_URL: must not contain credentials, a query or a fragment');
    return '';
  }
  if (isR2StorageHost(url.hostname)) {
    problems.push(
      'R2_PUBLIC_BASE_URL: must be the public bucket address (an r2.dev subdomain or a custom domain), not the S3 API endpoint',
    );
    return '';
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * The account id is the only R2 setting with a shape to get wrong, and a wrong one produces a
 * host that does not resolve — a failure that would only surface on the first upload. It is
 * therefore checked here, without ever repeating the value. In production a bad id stops the
 * start alongside the other broken settings; elsewhere media stays off with a warning so that
 * every non-media feature of the API still runs.
 */
function parseR2AccountId(
  value: string,
  nodeEnv: NodeEnv,
  problems: string[],
  incomplete: string[],
): string | undefined {
  try {
    return normalizeR2AccountId(value);
  } catch (error) {
    const reason = error instanceof R2EndpointError ? error.message : 'R2_ACCOUNT_ID: is invalid';
    if (nodeEnv === 'production') problems.push(reason);
    else incomplete.push(`${reason} (media storage stays off)`);
    return undefined;
  }
}

/** A PKCS#8 PEM block, whether it arrived with real newlines or pasted "\n" sequences. */
const PRIVATE_KEY_BLOCK = /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/;

/** The key is usually pasted from the service-account JSON, with literal "\n" sequences. */
function parsePrivateKey(value: string, problems: string[]): string {
  const key = value.replace(/\\n/g, '\n').trim();
  if (!PRIVATE_KEY_BLOCK.test(key)) {
    problems.push('FCM_PRIVATE_KEY: must be a PEM "PRIVATE KEY" block');
    return '';
  }
  return key;
}

/** The three fields the sender needs, taken from the credential file. */
interface ServiceAccountFile {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Reads the Firebase Admin SDK's service-account JSON from `FCM_SERVICE_ACCOUNT_FILE`.
 * The file is the console's own download, so rotating a credential means replacing one file
 * instead of re-pasting a multi-line PEM into .env. Only the three values the sender needs
 * are kept, and neither the contents nor the key ever reaches an error message: a failure
 * reports the path and what is wrong with the file.
 */
function readServiceAccountFile(
  path: string,
  nodeEnv: NodeEnv,
  problems: string[],
  incomplete: string[],
): ServiceAccountFile | undefined {
  const unusable = (reason: string): undefined => {
    const message = `FCM_SERVICE_ACCOUNT_FILE: ${reason}`;
    // A broken credential is fatal in production, where nothing else can send, and a
    // warning elsewhere - the same treatment R2 gets.
    if (nodeEnv === 'production') problems.push(message);
    else incomplete.push(`${message} (push stays off)`);
    return undefined;
  };

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return unusable('cannot be read');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unusable('is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return unusable('must contain a JSON object');
  }

  const account = parsed as Record<string, unknown>;
  if (account.type !== 'service_account') {
    return unusable('must be a service_account credential');
  }
  const projectId = typeof account.project_id === 'string' ? account.project_id.trim() : '';
  const clientEmail = typeof account.client_email === 'string' ? account.client_email.trim() : '';
  const privateKey = typeof account.private_key === 'string' ? account.private_key.trim() : '';
  if (projectId === '' || clientEmail === '' || privateKey === '') {
    return unusable('is missing project_id, client_email or private_key');
  }
  if (!PRIVATE_KEY_BLOCK.test(privateKey)) {
    return unusable('holds no PEM private key');
  }
  return { projectId, clientEmail, privateKey };
}

/**
 * The key that signs short-lived chat socket tickets. `CHAT_SOCKET_SECRET` wins when it is
 * set; otherwise a key is derived from the first-party authentication secret with its own
 * context string, so the two uses can never produce the same MAC. With neither set,
 * realtime stays off and the ticket route answers 503 — chat still works over REST.
 */
function chatSocketSecret(values: {
  CHAT_SOCKET_SECRET?: string | undefined;
  OTP_HASH_SECRET?: string | undefined;
}): { secret: string } | undefined {
  const explicit = values.CHAT_SOCKET_SECRET?.trim();
  if (explicit) return { secret: explicit };
  const source = values.OTP_HASH_SECRET?.trim();
  if (!source || source.length < 32) return undefined;
  return { secret: deriveChatTicketSecret(source) };
}

/**
 * Courier settings. The mock is local test data and is refused in production; base URLs
 * must be https and on each courier's host allow-list. Problems name variables only.
 */
/**
 * Where the API's database lives, from both of its addresses: local only when every
 * configured one is local, hosted when any one is hosted.
 */
function courierDatabaseTarget(
  databaseUrl: string | undefined,
  supabaseUrl: string,
): CourierDatabaseTarget {
  const modes = [classifySupabaseUrl(supabaseUrl).mode];
  if (databaseUrl !== undefined) modes.push(classifyDatabaseUrl(databaseUrl).mode);
  if (modes.includes('hosted')) return 'hosted';
  return modes.every((mode) => mode === 'local') ? 'local' : 'other';
}

function courierSettings(
  v: z.infer<typeof envSchema>,
  env: Readonly<Record<string, string | undefined>>,
  problems: string[],
): CourierConfig {
  const databaseTarget = courierDatabaseTarget(v.DATABASE_URL, v.SUPABASE_URL);
  const baseUrl = (
    variable: string,
    provider: 'steadfast' | 'pathao',
    value: string | undefined,
  ): string | undefined => {
    if (value === undefined || value.trim() === '') return undefined;
    const result = parseCourierBaseUrl(variable, provider, value);
    if ('problem' in result) {
      problems.push(result.problem);
      return undefined;
    }
    return result.url;
  };
  return {
    databaseTarget,
    mockAllowed: databaseTarget === 'local' && v.NODE_ENV !== 'production',
    // Names only: the values of retired variables are never read.
    ignoredVariables: RETIRED_COURIER_VARIABLES.filter(
      (name) => env[name] !== undefined && env[name] !== '',
    ),
    mockWebhookSecret: v.COURIER_MOCK_WEBHOOK_SECRET,
    credentials: {
      steadfast: {
        api_key: v.STEADFAST_API_KEY,
        secret_key: v.STEADFAST_SECRET_KEY,
        webhook_token: v.STEADFAST_WEBHOOK_TOKEN,
      },
      pathao: {
        client_id: v.PATHAO_CLIENT_ID,
        client_secret: v.PATHAO_CLIENT_SECRET,
        username: v.PATHAO_USERNAME,
        password: v.PATHAO_PASSWORD,
        webhook_secret: v.PATHAO_WEBHOOK_SECRET,
      },
    },
    baseUrls: {
      steadfast: baseUrl('STEADFAST_API_BASE_URL', 'steadfast', v.STEADFAST_API_BASE_URL),
      pathao: baseUrl('PATHAO_API_BASE_URL', 'pathao', v.PATHAO_API_BASE_URL),
    },
  };
}

function integrations(
  v: z.infer<typeof envSchema>,
  problems: string[],
): { media: R2Config | undefined; push: FcmConfig | undefined; incomplete: string[] } {
  const incomplete: string[] = [];
  let media: R2Config | undefined;
  let push: FcmConfig | undefined;

  const r2On = integrationState(
    'R2 media storage',
    {
      R2_ACCOUNT_ID: v.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: v.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: v.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: v.R2_BUCKET,
      R2_PUBLIC_BASE_URL: v.R2_PUBLIC_BASE_URL,
    },
    v.NODE_ENV,
    problems,
    incomplete,
  );
  if (
    r2On === 'on' &&
    v.R2_ACCOUNT_ID !== undefined &&
    v.R2_ACCESS_KEY_ID !== undefined &&
    v.R2_SECRET_ACCESS_KEY !== undefined &&
    v.R2_BUCKET !== undefined &&
    v.R2_PUBLIC_BASE_URL !== undefined
  ) {
    const accountId = parseR2AccountId(v.R2_ACCOUNT_ID, v.NODE_ENV, problems, incomplete);
    const publicBaseUrl = parsePublicBaseUrl(v.R2_PUBLIC_BASE_URL, v.NODE_ENV, problems);
    if (accountId !== undefined) {
      media = {
        accountId,
        accessKeyId: v.R2_ACCESS_KEY_ID,
        secretAccessKey: v.R2_SECRET_ACCESS_KEY,
        bucket: v.R2_BUCKET,
        publicBaseUrl,
      };
    }
  }

  if (v.FCM_SERVICE_ACCOUNT_FILE !== undefined) {
    // The file wins: one credential, one place to rotate it.
    const account = readServiceAccountFile(
      v.FCM_SERVICE_ACCOUNT_FILE,
      v.NODE_ENV,
      problems,
      incomplete,
    );
    if (account !== undefined) {
      push = {
        projectId: account.projectId,
        clientEmail: account.clientEmail,
        privateKey: account.privateKey,
      };
    }
  } else {
    const fcmOn = integrationState(
      'FCM push notifications',
      {
        FCM_PROJECT_ID: v.FCM_PROJECT_ID,
        FCM_CLIENT_EMAIL: v.FCM_CLIENT_EMAIL,
        FCM_PRIVATE_KEY: v.FCM_PRIVATE_KEY,
      },
      v.NODE_ENV,
      problems,
      incomplete,
    );
    if (
      fcmOn === 'on' &&
      v.FCM_PROJECT_ID !== undefined &&
      v.FCM_CLIENT_EMAIL !== undefined &&
      v.FCM_PRIVATE_KEY !== undefined
    ) {
      push = {
        projectId: v.FCM_PROJECT_ID,
        clientEmail: v.FCM_CLIENT_EMAIL,
        privateKey: parsePrivateKey(v.FCM_PRIVATE_KEY, problems),
      };
    }
  }
  return { media, push, incomplete };
}

/**
 * Validates the process environment. Empty strings count as unset, so a blank
 * line in .env falls back to the default instead of failing.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const input = Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, env[key] === '' ? undefined : env[key]]),
  );

  const parsed = envSchema.safeParse(input);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  // Check CORS even when other variables are invalid, so every problem is reported at once.
  const nodeEnv = envSchema.shape.NODE_ENV.safeParse(input.NODE_ENV);
  const corsOrigins = parseCorsOrigins(
    typeof input.CORS_ORIGINS === 'string' ? input.CORS_ORIGINS : undefined,
    nodeEnv.success ? nodeEnv.data : 'development',
    problems,
  );
  const adminAppOrigin = parseAdminAppOrigin(
    typeof input.ADMIN_APP_ORIGIN === 'string' ? input.ADMIN_APP_ORIGIN : undefined,
    nodeEnv.success ? nodeEnv.data : 'development',
    problems,
  );
  if (parsed.success) checkSecrets(parsed.data, parsed.data.NODE_ENV, problems);
  checkDatabaseUrl(
    typeof input.DATABASE_URL === 'string' ? input.DATABASE_URL : undefined,
    nodeEnv.success ? nodeEnv.data : 'development',
    problems,
  );
  const databaseUrl = typeof input.DATABASE_URL === 'string' ? input.DATABASE_URL : undefined;
  checkTarget(
    databaseUrl,
    classifyDatabaseUrl(databaseUrl),
    classifySupabaseUrl(typeof input.SUPABASE_URL === 'string' ? input.SUPABASE_URL : ''),
    nodeEnv.success ? nodeEnv.data : 'development',
    problems,
  );
  const optional = parsed.success
    ? integrations(parsed.data, problems)
    : { media: undefined, push: undefined, incomplete: [] };
  // A malformed Redis URL is a warning, not a start-up failure: the cache simply stays off.
  const redis = resolveRedisUrl(parsed.success ? parsed.data.REDIS_URL : undefined);
  if (redis.warning !== undefined) optional.incomplete.push(redis.warning);
  const couriers = parsed.success ? courierSettings(parsed.data, env, problems) : undefined;
  checkImageSearch(parsed.success ? parsed.data : undefined, problems);
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);

  const values = parsed.data;
  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    logLevel: values.LOG_LEVEL ?? DEFAULT_LOG_LEVEL[values.NODE_ENV],
    corsOrigins,
    trustProxyHops: values.TRUST_PROXY_HOPS,
    rateLimit: { windowMs: values.RATE_LIMIT_WINDOW_MS, limit: values.RATE_LIMIT_MAX },
    authRateLimit: {
      windowMs: values.AUTH_RATE_LIMIT_WINDOW_MS,
      limit: values.AUTH_RATE_LIMIT_MAX,
    },
    orderRateLimit: {
      windowMs: values.ORDER_RATE_LIMIT_WINDOW_MS,
      limit: values.ORDER_RATE_LIMIT_MAX,
    },
    adminRateLimit: {
      windowMs: values.ADMIN_RATE_LIMIT_WINDOW_MS,
      limit: values.ADMIN_RATE_LIMIT_MAX,
    },
    chatRateLimit: {
      windowMs: values.CHAT_RATE_LIMIT_WINDOW_MS,
      limit: values.CHAT_RATE_LIMIT_MAX,
    },
    chatUploadRateLimit: {
      windowMs: values.CHAT_UPLOAD_RATE_LIMIT_WINDOW_MS,
      total: values.CHAT_UPLOAD_RATE_LIMIT_MAX,
      image: values.CHAT_UPLOAD_IMAGE_LIMIT_MAX,
      document: values.CHAT_UPLOAD_DOCUMENT_LIMIT_MAX,
      audio: values.CHAT_UPLOAD_AUDIO_LIMIT_MAX,
    },
    chatAutomationWorker: {
      enabled: values.CHAT_AUTOMATION_WORKER === 'true',
      intervalMs: values.CHAT_AUTOMATION_WORKER_INTERVAL_MS,
      batchSize: values.CHAT_AUTOMATION_WORKER_BATCH_SIZE,
    },
    orderEmailWorker: {
      enabled: values.ORDER_EMAIL_WORKER === 'true',
      intervalMs: values.ORDER_EMAIL_WORKER_INTERVAL_MS,
    },
    imageSearch: {
      enabled: values.IMAGE_SEARCH_ENABLED === 'true',
      provider: {
        id: values.IMAGE_EMBEDDING_PROVIDER,
        model: values.IMAGE_EMBEDDING_MODEL,
        modelVersion: values.IMAGE_EMBEDDING_MODEL_VERSION,
        dimensions: values.IMAGE_EMBEDDING_DIMENSIONS,
        cacheDir: values.IMAGE_EMBEDDING_CACHE_DIR,
        httpUrl: values.IMAGE_EMBEDDING_HTTP_URL,
        httpApiKey: values.IMAGE_EMBEDDING_HTTP_API_KEY,
        timeoutMs: values.IMAGE_EMBEDDING_TIMEOUT_MS,
      },
      worker: {
        enabled: values.IMAGE_SEARCH_WORKER === 'true',
        intervalMs: values.IMAGE_SEARCH_WORKER_INTERVAL_MS,
        batchSize: values.IMAGE_SEARCH_WORKER_BATCH,
      },
      rateLimit: {
        windowMs: values.IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS,
        limit: values.IMAGE_SEARCH_RATE_LIMIT_MAX,
      },
    },
    realtime: chatSocketSecret(values),
    adminAppOrigin,
    supabase: {
      url: values.SUPABASE_URL.replace(/\/+$/, ''),
      publishableKey: values.SUPABASE_PUBLISHABLE_KEY,
      secretKey: values.SUPABASE_SECRET_KEY,
    },
    databaseUrl: values.DATABASE_URL,
    redisUrl: redis.url,
    databaseTarget: withProjectRef(
      classifyDatabaseUrl(values.DATABASE_URL),
      classifySupabaseUrl(values.SUPABASE_URL),
    ),
    // Canonical name first; the older one is the fallback for a deployment mid-migration.
    trustedClientSecret: values.API_CLIENT_SECRET ?? values.TRUSTED_CLIENT_SECRET,
    media: optional.media,
    push: optional.push,
    incompleteIntegrations: optional.incomplete,
    couriers: couriers ?? emptyCourierConfig(),
  };
}
