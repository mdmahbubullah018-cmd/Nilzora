/**
 * A parsed `REDIS_URL`. Nilzora talks to Redis over the Redis protocol (TCP or TLS), which
 * both a local `redis-server` and an Upstash `redis://`/`rediss://` endpoint speak, so the
 * same code runs in development and in the hosted environment.
 */
export interface RedisConnection {
  tls: boolean;
  host: string;
  port: number;
  username: string | undefined;
  password: string | undefined;
  /** Database index from the path (`redis://host/2`); 0 when absent. */
  database: number;
}

export type RedisUrlProblem =
  | 'unparseable'
  | 'wrong_scheme'
  | 'missing_host'
  | 'credentials_in_query'
  | 'bad_database';

export type RedisUrlResult =
  | { ok: true; connection: RedisConnection }
  | { ok: false; problem: RedisUrlProblem };

const DEFAULT_PORT = 6379;
const MAX_DATABASE = 15;

/**
 * Parses `redis://user:password@host:port/0`. Query strings are refused: credentials belong
 * in the authority (Upstash's own console shows them there), and a query string is an easy
 * place to leave a secret in a log line.
 */
export function parseRedisUrl(value: string | undefined): RedisUrlResult {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { ok: false, problem: 'unparseable' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: 'unparseable' };
  }

  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    return { ok: false, problem: 'wrong_scheme' };
  }
  if (url.hostname === '') return { ok: false, problem: 'missing_host' };
  if (url.search !== '') return { ok: false, problem: 'credentials_in_query' };

  const path = url.pathname.replace(/^\//, '');
  const database = path === '' ? 0 : Number(path);
  if (!Number.isInteger(database) || database < 0 || database > MAX_DATABASE) {
    return { ok: false, problem: 'bad_database' };
  }

  return {
    ok: true,
    connection: {
      tls: url.protocol === 'rediss:',
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port === '' ? DEFAULT_PORT : Number(url.port),
      username: url.username === '' ? undefined : decodeURIComponent(url.username),
      password: url.password === '' ? undefined : decodeURIComponent(url.password),
      database,
    },
  };
}

/** A short, safe description of a connection for logs: host, port and TLS only. */
export function describeRedisConnection(connection: RedisConnection): string {
  return `${connection.tls ? 'rediss' : 'redis'}://${connection.host}:${connection.port}`;
}
