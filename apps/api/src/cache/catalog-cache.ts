import type { BannerPlacement } from '@nilzora/contracts';
import type { KeyValueStore } from './redis-client';

/**
 * Cache-aside for the public reads that every customer client repeats: the category tree, the
 * brand collection, the two page-wide banner placements and the active shopping zones (whose
 * product counts, like the category tree's, may trail a product publish by the TTL). They change
 * only when an
 * administrator edits them, so a five minute TTL plus an explicit key deletion on every admin
 * write keeps them fresh without polling or key scans.
 *
 * Nothing else is cached on purpose:
 *  - products carry stock and price that must never be stale;
 *  - a category placement's banner list has a per-slug key space, so invalidating it would
 *    need a scan (it is cheap and always read from the database);
 *  - orders, addresses, customers and permissions are per-user and must always come from the
 *    database (see the audit in the report).
 */
export const CATALOG_CACHE_TTL_SECONDS = 300;

export const CATALOG_CACHE_KEYS = [
  'nilzora:v1:catalog:categories',
  'nilzora:v1:catalog:brands',
  'nilzora:v1:catalog:banners:home_hero',
  'nilzora:v1:catalog:banners:home_secondary',
  // The active shopping zones (see modules/zones/cached-store.ts).
  'nilzora:v1:catalog:shopping-zones',
] as const;

export type CatalogCacheKey = (typeof CATALOG_CACHE_KEYS)[number];

/** The cached banner placements, by placement name; a category placement has no cached key. */
export const BANNER_CACHE_KEYS: Partial<Record<BannerPlacement, CatalogCacheKey>> = {
  home_hero: 'nilzora:v1:catalog:banners:home_hero',
  home_secondary: 'nilzora:v1:catalog:banners:home_secondary',
};

export interface CatalogCache {
  /** False when Redis is not configured: every read goes straight to the database. */
  readonly enabled: boolean;
  /**
   * The cached value for `key`, or `load()` when there is none (or Redis is unavailable).
   * `parse` turns the cached JSON back into the value and returns null when it cannot, which
   * counts as a miss.
   */
  read<T>(
    key: CatalogCacheKey,
    parse: (value: unknown) => T | null,
    load: () => Promise<T>,
  ): Promise<T>;
  /** Deletes the cached catalog documents. Never throws: a miss only costs one query. */
  invalidate(): Promise<void>;
  /** Releases the connection during shutdown. */
  close(): Promise<void>;
}

export interface CatalogCacheOptions {
  ttlSeconds?: number;
  /** Called on a failed read/write/invalidate; never given cached content. */
  onError?: (operation: 'get' | 'set' | 'del', error: unknown) => void;
}

const DISABLED: CatalogCache = {
  enabled: false,
  read: (_key, _parse, load) => load(),
  invalidate: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

/** A cache that always misses. Used when REDIS_URL is unset, and by tests. */
export function disabledCatalogCache(): CatalogCache {
  return DISABLED;
}

export function createCatalogCache(
  store: KeyValueStore | null,
  options: CatalogCacheOptions = {},
): CatalogCache {
  if (store === null) return DISABLED;
  const ttlSeconds = options.ttlSeconds ?? CATALOG_CACHE_TTL_SECONDS;
  const onError = options.onError ?? ((): void => undefined);
  /** One load per key at a time: a burst of misses asks the database once. */
  const inFlight = new Map<CatalogCacheKey, Promise<unknown>>();
  /**
   * Bumped on every invalidation. A load that started before a write finished must not put
   * its (now older) value back into the cache: that is the one stale-cache race a delete
   * alone cannot prevent.
   */
  let generation = 0;

  const cache: CatalogCache = {
    enabled: true,

    async read<T>(
      key: CatalogCacheKey,
      parse: (value: unknown) => T | null,
      load: () => Promise<T>,
    ): Promise<T> {
      let cached: string | null;
      try {
        cached = await store.get(key);
      } catch (error) {
        // Redis is down or slow: answer from the database, exactly as if it were off.
        onError('get', error);
        return load();
      }

      if (cached !== null) {
        let value: unknown;
        try {
          value = JSON.parse(cached) as unknown;
        } catch {
          value = undefined;
        }
        const parsed = value === undefined ? null : parse(value);
        if (parsed !== null) return parsed;
        // An entry this version cannot use (corrupt, or written by an older shape): drop it
        // and treat the read as a miss, so it cannot be re-parsed on every request.
        await store.del([key]).catch((error: unknown) => {
          onError('del', error);
        });
      }

      const running = inFlight.get(key);
      if (running !== undefined) return running as Promise<T>;

      const startedAt = generation;
      const pending = load()
        .then(async (value) => {
          // An administrator wrote while this was loading: drop the result instead of
          // caching a value that is already behind the database.
          if (generation !== startedAt) return value;
          await store.set(key, JSON.stringify(value), ttlSeconds).catch((error: unknown) => {
            onError('set', error);
          });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, pending);
      return pending;
    },

    async invalidate() {
      generation += 1;
      await store.del([...CATALOG_CACHE_KEYS]).catch((error: unknown) => {
        onError('del', error);
      });
    },

    close: () => store.close(),
  };
  return cache;
}
