import { slugSchema } from '@nilzora/contracts';

/*
 * Wishlist store (device-local)
 * -----------------------------
 * Nilzora's API has no wishlist endpoint, so this list lives only in this app on this
 * device. It stores product slugs — never prices or names — and the Wishlist tab reads the
 * live product for each one, so nothing on screen can be out of date. It is deliberately not
 * keyed by account: signing in or out does not move or merge it, and nothing here is synced.
 *
 * Loading is tolerant (anything unusable is dropped, never thrown) and a failed save never
 * breaks the in-memory list.
 */

/** Versioned, so a future format can migrate or discard this one deliberately. */
export const WISHLIST_STORAGE_KEY = 'nilzora.wishlist.v1';
const STORAGE_FORMAT = 1;

/** A generous cap: far beyond it the list stops being useful, and the stored JSON grows. */
export const MAX_WISHLIST_ENTRIES = 100;
export const MAX_STORED_WISHLIST_LENGTH = 32_768;

/** The slice of AsyncStorage the wishlist needs. */
export interface WishlistStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface WishlistEntry {
  readonly slug: string;
  /** When it was saved, so the newest appears first even after a restart. */
  readonly savedAt: string;
}

export interface WishlistSnapshot {
  /** Newest first. */
  readonly entries: readonly WishlistEntry[];
  readonly count: number;
  /** False until the saved list has been read (or found unusable). */
  readonly hydrated: boolean;
}

const NO_ENTRIES: readonly WishlistEntry[] = [];

/** Valid slugs, each once, newest first, capped. Anything else is dropped. */
export function sanitizeEntries(values: readonly unknown[]): WishlistEntry[] {
  const seen = new Set<string>();
  const entries: WishlistEntry[] = [];
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue;
    const { slug, savedAt } = value as { slug?: unknown; savedAt?: unknown };
    if (typeof slug !== 'string' || !slugSchema.safeParse(slug).success) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    entries.push({
      slug,
      savedAt: typeof savedAt === 'string' ? savedAt : new Date(0).toISOString(),
    });
    if (entries.length >= MAX_WISHLIST_ENTRIES) break;
  }
  return entries;
}

/** Reads a saved wishlist. Returns null when the data is not a wishlist this app can use. */
export function parseStoredWishlist(raw: string): WishlistEntry[] | null {
  if (raw.length > MAX_STORED_WISHLIST_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { v, entries } = value as { v?: unknown; entries?: unknown };
  if (v !== STORAGE_FORMAT || !Array.isArray(entries)) return null;
  return sanitizeEntries(entries);
}

export function serializeWishlist(entries: readonly WishlistEntry[]): string {
  return JSON.stringify({
    v: STORAGE_FORMAT,
    entries: entries.map(({ slug, savedAt }) => ({ slug, savedAt })),
  });
}

export interface WishlistStore {
  getSnapshot: () => WishlistSnapshot;
  /** The listener runs after every change. */
  subscribe: (listener: () => void) => () => void;
  /** Reads the saved list once; repeated calls share one run. Never rejects. */
  hydrate: () => Promise<void>;
  has: (slug: string) => boolean;
  /** Saves a product, or removes it when it is already saved. Returns whether it is now saved. */
  toggle: (slug: string) => boolean;
  remove: (slug: string) => void;
  /** Resolves when everything changed so far has been written (or failed to be). */
  flush: () => Promise<void>;
}

export interface WishlistStoreOptions {
  storage: WishlistStorage;
  key?: string;
  now?: () => Date;
}

export function createWishlistStore({
  storage,
  key = WISHLIST_STORAGE_KEY,
  now = () => new Date(),
}: WishlistStoreOptions): WishlistStore {
  let snapshot: WishlistSnapshot = { entries: NO_ENTRIES, count: 0, hydrated: false };
  const listeners = new Set<() => void>();
  let hydration: Promise<void> | null = null;
  /** Edits made before the saved list was read; replayed on top of it so none is lost. */
  let pending: ((entries: readonly WishlistEntry[]) => readonly WishlistEntry[])[] = [];
  let writeChain: Promise<void> = Promise.resolve();
  let writeQueued = false;

  function publish(entries: readonly WishlistEntry[], hydrated: boolean): void {
    snapshot = { entries, count: entries.length, hydrated };
    for (const listener of listeners) listener();
  }

  function schedulePersist(): void {
    if (writeQueued) return;
    writeQueued = true;
    writeChain = writeChain.then(async () => {
      writeQueued = false;
      try {
        await storage.setItem(key, serializeWishlist(snapshot.entries));
      } catch {
        console.warn('[nilzora] the wishlist could not be saved on this device');
      }
    });
  }

  function commit(
    transform: (entries: readonly WishlistEntry[]) => readonly WishlistEntry[],
  ): void {
    if (snapshot.hydrated) {
      const next = transform(snapshot.entries);
      if (next === snapshot.entries) return;
      publish(next, true);
      schedulePersist();
      return;
    }
    pending.push(transform);
    publish(transform(snapshot.entries), false);
  }

  async function load(): Promise<void> {
    let saved: readonly WishlistEntry[] = NO_ENTRIES;
    try {
      const raw = await storage.getItem(key);
      if (raw !== null) {
        const parsed = parseStoredWishlist(raw);
        if (parsed === null) {
          void Promise.resolve()
            .then(() => storage.removeItem(key))
            .catch(() => undefined);
        } else {
          saved = parsed;
        }
      }
    } catch {
      console.warn('[nilzora] the saved wishlist could not be read on this device');
    }
    const replay = pending;
    pending = [];
    const merged = sanitizeEntries(
      replay.reduce<readonly WishlistEntry[]>((acc, edit) => edit(acc), saved),
    );
    publish(merged, true);
    if (replay.length > 0) schedulePersist();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate() {
      hydration ??= load();
      return hydration;
    },
    has(slug) {
      return snapshot.entries.some((entry) => entry.slug === slug);
    },
    toggle(slug) {
      if (!slugSchema.safeParse(slug).success) return false;
      const saved = !snapshot.entries.some((entry) => entry.slug === slug);
      if (saved) {
        const entry: WishlistEntry = { slug, savedAt: now().toISOString() };
        commit((entries) => [entry, ...entries].slice(0, MAX_WISHLIST_ENTRIES));
      } else {
        commit((entries) => entries.filter((item) => item.slug !== slug));
      }
      return saved;
    },
    remove(slug) {
      if (!snapshot.entries.some((entry) => entry.slug === slug)) return;
      commit((entries) => entries.filter((entry) => entry.slug !== slug));
    },
    flush: () => writeChain,
  };
}
