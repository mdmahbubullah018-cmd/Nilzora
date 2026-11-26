import { Pool, type PoolConfig } from 'pg';
import { SUPABASE_ROOT_CA } from './supabase-ca';

/** One API process keeps a small pool: every request is short and server-side. */
const DEFAULT_POOL_MAX = 10;
const IDLE_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 10_000;

export interface DatabaseOptions {
  /**
   * Server-only connection string. TLS and any other libpq options come from the URL
   * (for example `?sslmode=require`), except for hosted Supabase hosts, which always get
   * verified TLS (see `connectionSettings`). Never log this value.
   */
  connectionString: string;
  max?: number;
  /** Receives failures of idle clients, which happen outside any request. */
  onError?: (error: Error) => void;
}

const SSL_URL_PARAMETERS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

/**
 * A hosted Supabase database (pooler or direct) is always reached over TLS with the
 * certificate chain and host name verified against Supabase's root CA, whatever `sslmode`
 * the URL asked for: `require` would otherwise mean "verify against Node's own CAs" and fail
 * (the chain ends at a CA Node does not ship), and the URL's TLS options override anything
 * set beside it, so they are removed. Verification is never switched off. Any other host
 * keeps exactly what its URL says (for example `?sslmode=require` in production).
 */
export function connectionSettings(
  connectionString: string,
): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  if (!/(^|\.)supabase\.(co|com)$/i.test(url.hostname)) return { connectionString };

  const hadTlsOptions = SSL_URL_PARAMETERS.some((key) => url.searchParams.has(key));
  for (const key of SSL_URL_PARAMETERS) url.searchParams.delete(key);
  return {
    connectionString: hadTlsOptions ? url.toString() : connectionString,
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
  };
}

/**
 * A PostgreSQL pool for the Nilzora API: the direct connection used instead of
 * Supabase's Data API for queries that must run as a signed-in account (see
 * `withUser` in ./user-context.ts).
 */
export function createDatabasePool({
  connectionString,
  max = DEFAULT_POOL_MAX,
  onError,
}: DatabaseOptions): Pool {
  const pool = new Pool({
    ...connectionSettings(connectionString),
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  // An idle client can fail (a restart, a dropped socket). Without a listener Node
  // would terminate the process; the pool discards that client and carries on.
  pool.on('error', (error) => onError?.(error));
  return pool;
}
