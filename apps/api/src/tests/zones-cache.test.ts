import type { ShoppingZonesResponse } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_CACHE_KEYS,
  createCatalogCache,
  disabledCatalogCache,
} from '../cache/catalog-cache';
import type { KeyValueStore } from '../cache/redis-client';
import { SHOPPING_ZONES_CACHE_KEY, withZoneCache } from '../modules/zones/cached-store';
import type { ZoneStore } from '../modules/zones/store';

/** In-memory Redis stand-in that records commands and can be told to fail. */
function fakeRedis() {
  const entries = new Map<string, string>();
  const calls: string[] = [];
  const fail = { get: false };
  const store: KeyValueStore = {
    get: (key) => {
      calls.push(`get ${key}`);
      if (fail.get) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(entries.get(key) ?? null);
    },
    set: (key, value, seconds) => {
      calls.push(`set ${key} ${String(seconds)}`);
      entries.set(key, value);
      return Promise.resolve();
    },
    del: (keys) => {
      calls.push(`del ${keys.join(',')}`);
      let removed = 0;
      for (const key of keys) if (entries.delete(key)) removed += 1;
      return Promise.resolve(removed);
    },
    ping: () => Promise.resolve(true),
    increment: () => Promise.resolve(1),
    close: () => Promise.resolve(),
  };
  return { store, entries, calls, fail };
}

const ZONES: ShoppingZonesResponse = {
  zones: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'summer',
      name: 'Summer',
      description: null,
      audience: null,
      banner: null,
      bannerAlt: null,
      mobileBanner: null,
      productCount: 4,
    },
  ],
};

/** A zone store whose every method is a spy; only the ones a test calls need answers. */
function fakeZones() {
  const store = {
    list: vi.fn(() => Promise.resolve(ZONES)),
    zone: vi.fn(),
    adminList: vi.fn(),
    adminZone: vi.fn(),
    save: vi.fn(() => Promise.resolve('zone-id')),
    setActive: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve({ bannerKey: null, mobileBannerKey: null })),
    setProducts: vi.fn(() => Promise.resolve(3)),
    setCategories: vi.fn(() => Promise.resolve(2)),
    setBanner: vi.fn(() => Promise.resolve(null)),
    setMobileBanner: vi.fn(() => Promise.resolve(null)),
    productZones: vi.fn(),
    setProductZones: vi.fn(() => Promise.resolve(1)),
    categoryZones: vi.fn(),
    setCategoryZones: vi.fn(() => Promise.resolve(1)),
  };
  return { spies: store, store: store as unknown as ZoneStore };
}

describe('cached shopping zones', () => {
  it('is one of the catalog keys, so every catalog invalidation clears it too', () => {
    expect(CATALOG_CACHE_KEYS).toContain(SHOPPING_ZONES_CACHE_KEY);
  });

  it('serves the public list from the cache after the first read', async () => {
    const redis = fakeRedis();
    const { spies, store } = fakeZones();
    const zones = withZoneCache(store, createCatalogCache(redis.store));

    await expect(zones.list()).resolves.toStrictEqual(ZONES);
    await expect(zones.list()).resolves.toStrictEqual(ZONES);

    expect(spies.list).toHaveBeenCalledTimes(1);
    expect(redis.calls).toContain(`set ${SHOPPING_ZONES_CACHE_KEY} 300`);
  });

  it('clears the cache after every zone write has committed, and returns its answer', async () => {
    const redis = fakeRedis();
    const { spies, store } = fakeZones();
    const zones = withZoneCache(store, createCatalogCache(redis.store));
    const del = `del ${CATALOG_CACHE_KEYS.join(',')}`;

    const writes: [() => Promise<unknown>, unknown][] = [
      [() => zones.save('t', 'u', null, {} as never), 'zone-id'],
      [() => zones.setActive('t', 'u', 'z', false), undefined],
      [() => zones.delete('t', 'u', 'z'), { bannerKey: null, mobileBannerKey: null }],
      [() => zones.setProducts('t', 'u', 'z', []), 3],
      [() => zones.setCategories('t', 'u', 'z', []), 2],
      [() => zones.setBanner('t', 'u', 'z', null, null), null],
      [() => zones.setMobileBanner('t', 'u', 'z', null), null],
      [() => zones.setProductZones('t', 'u', 'p', []), 1],
      [() => zones.setCategoryZones('t', 'u', 'c', []), 1],
    ];
    for (const [write, expected] of writes) {
      redis.calls.length = 0;
      await expect(write()).resolves.toStrictEqual(expected);
      expect(redis.calls).toStrictEqual([del]);
    }
    expect(spies.save).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone when a write is refused', async () => {
    const redis = fakeRedis();
    const { spies, store } = fakeZones();
    spies.setActive.mockRejectedValueOnce(new Error('forbidden'));
    const zones = withZoneCache(store, createCatalogCache(redis.store));

    await expect(zones.setActive('t', 'u', 'z', true)).rejects.toThrow('forbidden');
    expect(redis.calls).toStrictEqual([]);
  });

  it('answers from the database when Redis is down', async () => {
    const redis = fakeRedis();
    redis.fail.get = true;
    const { spies, store } = fakeZones();
    const zones = withZoneCache(store, createCatalogCache(redis.store));

    await expect(zones.list()).resolves.toStrictEqual(ZONES);
    expect(spies.list).toHaveBeenCalledTimes(1);
  });

  it('drops a cached list the contract cannot read, and reloads it', async () => {
    const redis = fakeRedis();
    redis.entries.set(SHOPPING_ZONES_CACHE_KEY, JSON.stringify({ zones: [{ id: 'not-a-zone' }] }));
    const { spies, store } = fakeZones();
    const zones = withZoneCache(store, createCatalogCache(redis.store));

    await expect(zones.list()).resolves.toStrictEqual(ZONES);
    expect(spies.list).toHaveBeenCalledTimes(1);
  });

  it('is the plain store when Redis is not configured', () => {
    const { store } = fakeZones();
    expect(withZoneCache(store, disabledCatalogCache())).toBe(store);
  });
});
