import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import {
  isPublicCacheKey,
  PUBLIC_CACHE_KEY,
  PUBLIC_CACHE_MAX_AGE_MS,
  PUBLIC_CACHE_SAVE_DELAY_MS,
  restorePublicCache,
  savePublicCache,
  startPublicCache,
} from '../query/public-cache';
import { queryKeys } from '../query/query-keys';
import { resetAsyncStorage } from '../test-utils/render-with-providers';

const PRIVATE_MARKER = 'private-address-7c1e';
const NOW = 1_800_000_000_000;

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

/** A client holding public catalog answers and an account's private ones. */
function filledClient(): QueryClient {
  const qc = client();
  qc.setQueryData(queryKeys.catalog.categories(), [{ id: 'c1', name: 'Shoes' }]);
  qc.setQueryData(queryKeys.catalog.products({ sort: 'newest', pageSize: 8, page: 1 }), {
    items: [{ id: 'p1' }],
    total: 1,
  });
  qc.setQueryData(['catalog', 'brands'], [{ slug: 'acme' }]);
  qc.setQueryData(queryKeys.site.storeProfile(), { name: 'Nilzora' });
  // Never to be written: account data, the onboarding answer, live campaigns, cart quotes.
  qc.setQueryData(queryKeys.addresses.list('user-1'), [{ line1: PRIVATE_MARKER }]);
  qc.setQueryData(queryKeys.orders.detail('user-1', 'NZ-1'), { note: PRIVATE_MARKER });
  qc.setQueryData(queryKeys.onboarding.campaign(null), { campaign: { id: PRIVATE_MARKER } });
  qc.setQueryData(['catalog', 'campaigns', null], [{ id: PRIVATE_MARKER }]);
  qc.setQueryData(queryKeys.cart.quote([{ productId: 'p1', quantity: 1 }]), {
    total: PRIVATE_MARKER,
  });
  qc.setQueryData(queryKeys.catalog.product('slug-1'), { id: PRIVATE_MARKER });
  return qc;
}

beforeEach(async () => {
  await resetAsyncStorage();
});

describe('isPublicCacheKey', () => {
  it('allows only the public catalog answers Home and Search start with', () => {
    expect(isPublicCacheKey(queryKeys.catalog.categories())).toBe(true);
    expect(isPublicCacheKey(queryKeys.catalog.shoppingZones())).toBe(true);
    expect(isPublicCacheKey(queryKeys.catalog.products({ page: 1 }))).toBe(true);
    expect(isPublicCacheKey(queryKeys.catalog.discovery())).toBe(true);
    expect(isPublicCacheKey(['catalog', 'brands'])).toBe(true);
    expect(isPublicCacheKey(['catalog', 'banners', 'home_hero', null])).toBe(true);
    expect(isPublicCacheKey(queryKeys.site.storeProfile())).toBe(true);
  });

  it('refuses everything that belongs to an account, a viewer or a live window', () => {
    expect(isPublicCacheKey(queryKeys.addresses.list('user-1'))).toBe(false);
    expect(isPublicCacheKey(queryKeys.wishlist(null))).toBe(false);
    expect(isPublicCacheKey(queryKeys.onboarding.campaign('user-1'))).toBe(false);
    expect(isPublicCacheKey(queryKeys.onboarding.guestHistory())).toBe(false);
    expect(isPublicCacheKey(queryKeys.cart.quote([]))).toBe(false);
    expect(isPublicCacheKey(['catalog', 'campaigns', null])).toBe(false);
    expect(isPublicCacheKey(queryKeys.catalog.product('slug'))).toBe(false);
    expect(isPublicCacheKey(queryKeys.catalog.productFeed({}))).toBe(false);
    expect(isPublicCacheKey(['user'])).toBe(false);
    expect(isPublicCacheKey([])).toBe(false);
  });
});

describe('save and restore', () => {
  it('writes only public answers and puts them back on the next launch', async () => {
    await savePublicCache(filledClient(), () => NOW);
    const stored = await AsyncStorage.getItem(PUBLIC_CACHE_KEY);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(PRIVATE_MARKER);

    const next = client();
    const restored = await restorePublicCache(next, () => NOW + 60_000);
    expect(restored).toBe(4);
    expect(next.getQueryData(queryKeys.catalog.categories())).toEqual([
      { id: 'c1', name: 'Shoes' },
    ]);
    expect(next.getQueryData(queryKeys.site.storeProfile())).toEqual({ name: 'Nilzora' });
    expect(next.getQueryData(queryKeys.addresses.list('user-1'))).toBeUndefined();
    // Restored data is old, so every screen still refetches it.
    expect(next.getQueryState(queryKeys.catalog.categories())?.dataUpdatedAt).toBeLessThan(
      NOW + 60_000,
    );
  });

  it('drops a snapshot that is too old, and deletes it', async () => {
    await savePublicCache(filledClient(), () => NOW);
    const next = client();
    expect(await restorePublicCache(next, () => NOW + PUBLIC_CACHE_MAX_AGE_MS + 1)).toBe(0);
    expect(next.getQueryData(queryKeys.catalog.categories())).toBeUndefined();
    expect(await AsyncStorage.getItem(PUBLIC_CACHE_KEY)).toBeNull();
  });

  it('drops a snapshot from another app version or one that cannot be read', async () => {
    await savePublicCache(filledClient(), () => NOW);
    const raw = (await AsyncStorage.getItem(PUBLIC_CACHE_KEY)) ?? '';
    const otherVersion = { ...(JSON.parse(raw) as object), appVersion: 'some-older-build' };
    await AsyncStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(otherVersion));
    expect(await restorePublicCache(client(), () => NOW)).toBe(0);
    expect(await AsyncStorage.getItem(PUBLIC_CACHE_KEY)).toBeNull();

    await AsyncStorage.setItem(PUBLIC_CACHE_KEY, '{not json');
    expect(await restorePublicCache(client(), () => NOW)).toBe(0);
    expect(await AsyncStorage.getItem(PUBLIC_CACHE_KEY)).toBeNull();
  });

  it('never smuggles a private key that a tampered snapshot contains', async () => {
    await savePublicCache(filledClient(), () => NOW);
    const snapshot = JSON.parse((await AsyncStorage.getItem(PUBLIC_CACHE_KEY)) ?? '{}') as {
      state: { queries: { queryKey: unknown[]; queryHash: string }[] };
    };
    const forged = { ...snapshot.state.queries[0]! };
    forged.queryKey = ['user', 'user-1', 'addresses', 'list'];
    forged.queryHash = JSON.stringify(forged.queryKey);
    snapshot.state.queries.push(forged);
    await AsyncStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(snapshot));

    const next = client();
    await restorePublicCache(next, () => NOW);
    expect(next.getQueryData(['user', 'user-1', 'addresses', 'list'])).toBeUndefined();
  });

  it('never replaces newer data that is already in the cache', async () => {
    await savePublicCache(filledClient(), () => NOW);
    const next = client();
    next.setQueryData(queryKeys.catalog.categories(), [{ id: 'fresh', name: 'Live' }]);
    await restorePublicCache(next, () => NOW);
    expect(next.getQueryData(queryKeys.catalog.categories())).toEqual([
      { id: 'fresh', name: 'Live' },
    ]);
  });
});

describe('startPublicCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves once after a burst of public answers, and stops when asked', async () => {
    const qc = client();
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    const stop = startPublicCache(qc);
    await jest.advanceTimersByTimeAsync(0);

    await qc.fetchQuery({ queryKey: queryKeys.catalog.categories(), queryFn: () => ['a'] });
    await qc.fetchQuery({ queryKey: ['catalog', 'brands'], queryFn: () => ['b'] });
    await qc.fetchQuery({ queryKey: queryKeys.addresses.list('u'), queryFn: () => ['x'] });
    const cacheWrites = () => setItem.mock.calls.filter(([key]) => key === PUBLIC_CACHE_KEY).length;
    expect(cacheWrites()).toBe(0);
    await jest.advanceTimersByTimeAsync(PUBLIC_CACHE_SAVE_DELAY_MS + 10);
    expect(cacheWrites()).toBe(1);

    stop();
    await qc.fetchQuery({ queryKey: queryKeys.catalog.shoppingZones(), queryFn: () => ['z'] });
    await jest.advanceTimersByTimeAsync(PUBLIC_CACHE_SAVE_DELAY_MS + 10);
    expect(cacheWrites()).toBe(1);
    setItem.mockRestore();
  });
});
