import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultShouldDehydrateQuery,
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import Constants from 'expo-constants';
import { USER_QUERY_ROOT } from './query-keys';

/*
 * Public catalog cache
 * --------------------
 * Home's first screen should not wait for the network. The store's public catalog answers
 * (categories, collections, the Home product rows, brands, banners, the search discovery
 * sections, the store profile) are saved to device storage after they load, and put back into
 * the query cache on the next launch, so Home can draw real content at once while every query
 * still refetches in the background (restored data is always older than the 30 s stale time).
 *
 * Rules that keep it safe:
 * - Allow-list only. Nothing under the account root (`['user', ...]`), no onboarding answer,
 *   no cart or checkout quote, no live campaign windows, nothing that depends on who is
 *   signed in, is ever written: those keys are not on the list.
 * - Prices shown from the cache are display only; the cart and checkout always ask the server.
 * - Bounded: entries older than PUBLIC_CACHE_MAX_AGE_MS, from another app version, or that
 *   cannot be read are dropped (and the stored copy deleted), never trusted.
 * - Restored data never replaces anything newer already in the cache.
 */

export const PUBLIC_CACHE_KEY = 'nilzora.query-cache.public.v1';
/**
 * 2: the saved catalog now carries each product's colour preview. A snapshot written before it
 * would paint cards without their swatches until the refetch lands, so version 1 is dropped.
 */
const FORMAT_VERSION = 2;
/** Saved catalog data older than this is thrown away instead of shown (three days: offline, the
 * "you are offline" pill already says it is saved information, and prices are display-only). */
export const PUBLIC_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Writes are batched: a screen that loads several rows saves once. */
export const PUBLIC_CACHE_SAVE_DELAY_MS = 1500;
/** A larger snapshot is not written (the allow-list should keep it far below this). */
const MAX_SNAPSHOT_CHARS = 1_500_000;

const PERSISTED_CATALOG_KINDS: ReadonlySet<string> = new Set([
  'categories',
  'shopping-zones',
  'products',
  'brands',
  'banners',
  'discovery',
]);

/** Whether a query's data is public, the same for every visitor, and worth keeping. */
export function isPublicCacheKey(queryKey: QueryKey): boolean {
  const [root, kind] = queryKey;
  if (root === USER_QUERY_ROOT || typeof kind !== 'string') return false;
  if (root === 'site') return kind === 'store-profile';
  return root === 'catalog' && PERSISTED_CATALOG_KINDS.has(kind);
}

interface Snapshot {
  format: number;
  appVersion: string;
  savedAt: number;
  state: DehydratedState;
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Snapshot>;
  return (
    candidate.format === FORMAT_VERSION &&
    typeof candidate.appVersion === 'string' &&
    typeof candidate.savedAt === 'number' &&
    typeof candidate.state === 'object' &&
    candidate.state !== null &&
    Array.isArray(candidate.state.queries)
  );
}

async function forget(): Promise<void> {
  await AsyncStorage.removeItem(PUBLIC_CACHE_KEY).catch(() => undefined);
}

/**
 * Puts the saved public catalog back into the cache. Resolves to the number of queries
 * restored; any problem means nothing is restored and the stored copy is removed.
 */
export async function restorePublicCache(
  client: QueryClient,
  now: () => number = Date.now,
): Promise<number> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PUBLIC_CACHE_KEY);
  } catch {
    return 0;
  }
  if (raw === null) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await forget();
    return 0;
  }
  if (
    !isSnapshot(parsed) ||
    parsed.appVersion !== appVersion() ||
    now() - parsed.savedAt > PUBLIC_CACHE_MAX_AGE_MS ||
    parsed.savedAt > now()
  ) {
    await forget();
    return 0;
  }

  // Checked again on the way in: a snapshot written by an older rule set cannot smuggle a key.
  const queries = parsed.state.queries.filter(
    (query) => Array.isArray(query.queryKey) && isPublicCacheKey(query.queryKey),
  );
  try {
    hydrate(client, { queries, mutations: [] });
  } catch {
    await forget();
    return 0;
  }
  return queries.length;
}

/** Writes the current public catalog answers to device storage. */
export async function savePublicCache(
  client: QueryClient,
  now: () => number = Date.now,
): Promise<void> {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && isPublicCacheKey(query.queryKey),
    shouldDehydrateMutation: () => false,
  });
  if (state.queries.length === 0) return;
  const snapshot: Snapshot = {
    format: FORMAT_VERSION,
    appVersion: appVersion(),
    savedAt: now(),
    state,
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > MAX_SNAPSHOT_CHARS) return;
  await AsyncStorage.setItem(PUBLIC_CACHE_KEY, serialized).catch(() => undefined);
}

/**
 * Restores the saved catalog and keeps the saved copy up to date while the app runs. Returns
 * the function that stops saving (and flushes nothing: a pending write is simply dropped).
 */
export function startPublicCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'success' ||
      !isPublicCacheKey(event.query.queryKey as QueryKey)
    ) {
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) void savePublicCache(client);
    }, PUBLIC_CACHE_SAVE_DELAY_MS);
  });

  void restorePublicCache(client);

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}
