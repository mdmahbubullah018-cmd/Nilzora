import { createCatalogCache, disabledCatalogCache, type CatalogCache } from './catalog-cache';
import { createRedisClient, type KeyValueStore } from './redis-client';
import { describeRedisConnection, parseRedisUrl } from './redis-url';

export {
  CATALOG_CACHE_KEYS,
  CATALOG_CACHE_TTL_SECONDS,
  BANNER_CACHE_KEYS,
  type CatalogCache,
} from './catalog-cache';
export { createCatalogCache, disabledCatalogCache } from './catalog-cache';
export { RedisUnavailableError, type KeyValueStore } from './redis-client';
export { parseRedisUrl } from './redis-url';

export interface ProcessCacheLog {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/** What this process uses Redis for, from one shared connection. */
export interface ProcessRedis {
  /** The catalog cache (always present; it always misses without Redis). */
  catalogCache: CatalogCache;
  /**
   * Shared rate-limit counters, present only with a usable REDIS_URL. Rate limits fall back to
   * process memory without it.
   */
  counters: KeyValueStore | undefined;
  /** Whether Redis answers right now; undefined when Redis is not configured at all. */
  ping: (() => Promise<boolean>) | undefined;
}

/**
 * The catalog cache for this process, from `REDIS_URL`. Unset (or unusable) means a cache
 * that always misses, so a developer without Redis, or a Redis outage, only costs the direct
 * database query the API made before caching existed. Only the host, port and TLS flag are
 * ever logged, never the credentials.
 */
export function createProcessCatalogCache(
  redisUrl: string | undefined,
  log: ProcessCacheLog,
): CatalogCache {
  return createProcessRedis(redisUrl, log).catalogCache;
}

/**
 * Redis for this process: the catalog cache, the shared rate-limit counters and a readiness
 * probe, all on one connection. Redis is never the source of truth for anything: without it the
 * cache misses and the counters stay in process memory.
 */
export function createProcessRedis(
  redisUrl: string | undefined,
  log: ProcessCacheLog,
): ProcessRedis {
  const off: ProcessRedis = {
    catalogCache: disabledCatalogCache(),
    counters: undefined,
    ping: undefined,
  };
  if (redisUrl === undefined || redisUrl.trim() === '') {
    log.info('redis cache: off (no usable REDIS_URL)');
    return off;
  }

  const parsed = parseRedisUrl(redisUrl);
  if (!parsed.ok) {
    log.warn(`redis cache: off (REDIS_URL ${parsed.problem})`);
    return off;
  }

  const where = describeRedisConnection(parsed.connection);
  let reportedUnavailable = false;
  const client = createRedisClient(parsed.connection, {
    onEvent: (event, detail) => {
      if (event === 'connected') {
        reportedUnavailable = false;
        log.info(`redis cache: connected to ${where}`);
      } else if (!reportedUnavailable) {
        reportedUnavailable = true;
        log.warn(`redis cache: ${where} unavailable (${detail}); falling back to the database`);
      }
    },
  });

  const catalogCache = createCatalogCache(client, {
    onError: (operation, error) => {
      log.warn(
        `redis cache: ${operation} failed (${error instanceof Error ? error.message : 'unknown'})`,
      );
    },
  });
  return { catalogCache, counters: client, ping: () => client.isAvailable() };
}
