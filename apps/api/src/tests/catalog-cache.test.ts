import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_CACHE_KEYS,
  CATALOG_CACHE_KEYS,
  createCatalogCache,
  disabledCatalogCache,
} from '../cache/catalog-cache';
import type { KeyValueStore } from '../cache/redis-client';

/**
 * An in-memory stand-in for Redis: it records what was asked for and can be told to fail a
 * command, which is how the "Redis is down" behaviour is tested without a server.
 */
function fakeStore(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const ttl = new Map<string, number>();
  const calls: string[] = [];
  const fail = { get: false, set: false, del: false };

  const store: KeyValueStore = {
    get: (key) => {
      calls.push(`get ${key}`);
      if (fail.get) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(entries.get(key) ?? null);
    },
    set: (key, value, seconds) => {
      calls.push(`set ${key} ${seconds}`);
      if (fail.set) return Promise.reject(new Error('connection refused'));
      entries.set(key, value);
      ttl.set(key, seconds);
      return Promise.resolve();
    },
    del: (keys) => {
      calls.push(`del ${keys.join(',')}`);
      if (fail.del) return Promise.reject(new Error('connection refused'));
      let removed = 0;
      for (const key of keys) if (entries.delete(key)) removed += 1;
      return Promise.resolve(removed);
    },
    ping: () => Promise.resolve(true),
    increment: (key, seconds) => {
      calls.push(`incr ${key} ${seconds}`);
      const next = Number(entries.get(key) ?? '0') + 1;
      entries.set(key, String(next));
      ttl.set(key, seconds);
      return Promise.resolve(next);
    },
    close: () => {
      calls.push('close');
      return Promise.resolve();
    },
  };

  return { store, entries, ttl, calls, fail };
}

const CATEGORIES = CATALOG_CACHE_KEYS[0];
const BRANDS = CATALOG_CACHE_KEYS[1];

const listOfStrings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;

describe('catalog cache', () => {
  it('is off, and still answers, when Redis is not configured', async () => {
    const cache = disabledCatalogCache();
    const load = vi.fn(() => Promise.resolve(['a']));

    await expect(cache.read(CATEGORIES, listOfStrings, load)).resolves.toStrictEqual(['a']);
    expect(cache.enabled).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads on a miss and stores the value with the configured TTL', async () => {
    const { store, entries, ttl } = fakeStore();
    const cache = createCatalogCache(store);
    const load = vi.fn(() => Promise.resolve(['fashion']));

    await expect(cache.read(CATEGORIES, listOfStrings, load)).resolves.toStrictEqual(['fashion']);

    expect(load).toHaveBeenCalledTimes(1);
    expect(entries.get(CATEGORIES)).toBe('["fashion"]');
    expect(ttl.get(CATEGORIES)).toBe(300);
  });

  it('serves the second read from the cache without touching the database', async () => {
    const { store, calls } = fakeStore({ [CATEGORIES]: '["fashion"]' });
    const cache = createCatalogCache(store);
    const load = vi.fn(() => Promise.resolve(['database']));

    await expect(cache.read(CATEGORIES, listOfStrings, load)).resolves.toStrictEqual(['fashion']);
    expect(load).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.startsWith('get'))).toHaveLength(1);
  });

  it('treats an entry the contract cannot parse as a miss and drops it', async () => {
    const { store, entries } = fakeStore({ [CATEGORIES]: '{"not":"a list"}' });
    const cache = createCatalogCache(store);

    await expect(
      cache.read(CATEGORIES, listOfStrings, () => Promise.resolve(['fresh'])),
    ).resolves.toStrictEqual(['fresh']);
    expect(entries.get(CATEGORIES)).toBe('["fresh"]');
  });

  it('treats corrupt JSON as a miss instead of failing the request', async () => {
    const { store, entries } = fakeStore({ [CATEGORIES]: 'not json' });
    const cache = createCatalogCache(store);

    await expect(
      cache.read(CATEGORIES, listOfStrings, () => Promise.resolve(['fresh'])),
    ).resolves.toStrictEqual(['fresh']);
    expect(entries.get(CATEGORIES)).toBe('["fresh"]');
  });

  it('falls back to the database when Redis cannot be read', async () => {
    const { store, fail } = fakeStore();
    fail.get = true;
    const onError = vi.fn();
    const cache = createCatalogCache(store, { onError });

    await expect(
      cache.read(CATEGORIES, listOfStrings, () => Promise.resolve(['database'])),
    ).resolves.toStrictEqual(['database']);
    expect(onError).toHaveBeenCalledWith('get', expect.any(Error));
  });

  it('still answers when the value cannot be written back', async () => {
    const { store, fail } = fakeStore();
    fail.set = true;
    const cache = createCatalogCache(store);

    await expect(
      cache.read(CATEGORIES, listOfStrings, () => Promise.resolve(['database'])),
    ).resolves.toStrictEqual(['database']);
  });

  it('asks the database once for concurrent misses of the same key', async () => {
    const { store } = fakeStore();
    const cache = createCatalogCache(store);
    let resolveLoad: ((value: string[]) => void) | undefined;
    const pendingLoad = new Promise<string[]>((resolve) => {
      resolveLoad = resolve;
    });
    const load = vi.fn(() => pendingLoad);

    const first = cache.read(CATEGORIES, listOfStrings, load);
    const second = cache.read(CATEGORIES, listOfStrings, load);
    // Let the (async) cache lookup finish so the single load starts; then answer it.
    await new Promise((resolve) => setImmediate(resolve));
    resolveLoad?.(['fashion']);

    await expect(Promise.all([first, second])).resolves.toStrictEqual([['fashion'], ['fashion']]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('deletes both cached documents on invalidation, and never scans', async () => {
    const { store, calls } = fakeStore({ [CATEGORIES]: '[]', [BRANDS]: '[]' });
    const cache = createCatalogCache(store);

    await cache.invalidate();

    expect(calls).toStrictEqual([`del ${CATALOG_CACHE_KEYS.join(',')}`]);
    expect(calls.some((call) => call.includes('keys') || call.includes('*'))).toBe(false);
  });

  it('will not put an older value back when an admin writes during a load', async () => {
    // The one stale-cache race a delete cannot fix: the load started before the write and
    // would re-create the entry with pre-write data.
    const { store, entries } = fakeStore();
    const cache = createCatalogCache(store);
    let resolveLoad: ((value: string[]) => void) | undefined;
    const pendingLoad = new Promise<string[]>((resolve) => {
      resolveLoad = resolve;
    });

    const read = cache.read(CATEGORIES, listOfStrings, () => pendingLoad);
    await new Promise((resolve) => setImmediate(resolve));
    await cache.invalidate();
    resolveLoad?.(['before-the-write']);

    await expect(read).resolves.toStrictEqual(['before-the-write']);
    // The caller that started earlier still gets its answer, but nothing is cached…
    expect(entries.has(CATEGORIES)).toBe(false);
    // …so the next read goes back to the database and caches the new value.
    await expect(
      cache.read(CATEGORIES, listOfStrings, () => Promise.resolve(['after-the-write'])),
    ).resolves.toStrictEqual(['after-the-write']);
    expect(entries.get(CATEGORIES)).toBe('["after-the-write"]');
  });

  it('has a cached key only for the two page-wide banner placements', () => {
    expect(BANNER_CACHE_KEYS.home_hero).toBe('nilzora:v1:catalog:banners:home_hero');
    expect(BANNER_CACHE_KEYS.home_secondary).toBe('nilzora:v1:catalog:banners:home_secondary');
    // A category placement is per-slug: an unbounded key space, so it is never cached.
    expect(BANNER_CACHE_KEYS.category).toBeUndefined();
    // Every cacheable key is covered by the single invalidation.
    for (const key of Object.values(BANNER_CACHE_KEYS)) {
      expect(CATALOG_CACHE_KEYS).toContain(key);
    }
  });

  it('invalidation never throws when Redis is down', async () => {
    const { store, fail } = fakeStore();
    fail.del = true;
    const cache = createCatalogCache(store);

    await expect(cache.invalidate()).resolves.toBeUndefined();
  });

  it('closes the connection through the cache', async () => {
    const { store, calls } = fakeStore();
    const cache = createCatalogCache(store);

    await cache.close();

    expect(calls).toContain('close');
  });
});
