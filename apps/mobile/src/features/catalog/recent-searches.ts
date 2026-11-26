/*
 * Recent searches (device-local)
 * ------------------------------
 * The catalog API has no suggestion or history endpoint, so the terms a customer has already
 * searched for are kept only in this app on this device. They are plain, trimmed strings —
 * no account, no prices, nothing personal beyond what was typed into the search box — and
 * they are never sent anywhere.
 */

export const RECENT_SEARCHES_STORAGE_KEY = 'nilzora.recent-searches.v1';
const STORAGE_FORMAT = 1;

/** Enough to be useful without turning the empty search state into a wall of chips. */
export const MAX_RECENT_SEARCHES = 8;
/** Matches the catalog's own query limit (MAX_SEARCH_LENGTH). */
export const MAX_RECENT_SEARCH_LENGTH = 100;
const MAX_STORED_LENGTH = 8_192;

export interface RecentSearchesStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface RecentSearchesSnapshot {
  /** Newest first. */
  readonly queries: readonly string[];
  /** False until the saved list has been read (or found unusable). */
  readonly hydrated: boolean;
}

const NO_QUERIES: readonly string[] = [];

/** Trimmed, non-empty, newest first, each term once (case-insensitively), capped. */
export function sanitizeQueries(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const query = value.trim().slice(0, MAX_RECENT_SEARCH_LENGTH).trim();
    if (query === '') continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= MAX_RECENT_SEARCHES) break;
  }
  return queries;
}

/** Reads the saved list. Returns null when the data is not something this app wrote. */
export function parseStoredSearches(raw: string): string[] | null {
  if (raw.length > MAX_STORED_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { v, queries } = value as { v?: unknown; queries?: unknown };
  if (v !== STORAGE_FORMAT || !Array.isArray(queries)) return null;
  return sanitizeQueries(queries);
}

export function serializeSearches(queries: readonly string[]): string {
  return JSON.stringify({ v: STORAGE_FORMAT, queries });
}

export interface RecentSearchesStore {
  getSnapshot: () => RecentSearchesSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the saved list once; repeated calls share one run. Never rejects. */
  hydrate: () => Promise<void>;
  /** Puts a term at the top, moving an existing one up rather than duplicating it. */
  remember: (query: string) => void;
  clear: () => void;
  /** Resolves when everything changed so far has been written (or failed to be). */
  flush: () => Promise<void>;
}

export interface RecentSearchesStoreOptions {
  storage: RecentSearchesStorage;
  key?: string;
}

export function createRecentSearchStore({
  storage,
  key = RECENT_SEARCHES_STORAGE_KEY,
}: RecentSearchesStoreOptions): RecentSearchesStore {
  let snapshot: RecentSearchesSnapshot = { queries: NO_QUERIES, hydrated: false };
  const listeners = new Set<() => void>();
  let hydration: Promise<void> | null = null;
  /** Edits made before the saved list was read; replayed so none is lost. */
  let pending: ((queries: readonly string[]) => readonly string[])[] = [];
  let writeChain: Promise<void> = Promise.resolve();
  let writeQueued = false;

  function publish(queries: readonly string[], hydrated: boolean): void {
    snapshot = { queries, hydrated };
    for (const listener of listeners) listener();
  }

  function schedulePersist(): void {
    if (writeQueued) return;
    writeQueued = true;
    writeChain = writeChain.then(async () => {
      writeQueued = false;
      try {
        await storage.setItem(key, serializeSearches(snapshot.queries));
      } catch {
        console.warn('[nilzora] recent searches could not be saved on this device');
      }
    });
  }

  function commit(transform: (queries: readonly string[]) => readonly string[]): void {
    if (snapshot.hydrated) {
      const next = transform(snapshot.queries);
      if (next === snapshot.queries) return;
      publish(next, true);
      schedulePersist();
      return;
    }
    pending.push(transform);
    publish(transform(snapshot.queries), false);
  }

  async function load(): Promise<void> {
    let saved: readonly string[] = NO_QUERIES;
    try {
      const raw = await storage.getItem(key);
      if (raw !== null) {
        const parsed = parseStoredSearches(raw);
        if (parsed === null) {
          void Promise.resolve()
            .then(() => storage.removeItem(key))
            .catch(() => undefined);
        } else {
          saved = parsed;
        }
      }
    } catch {
      console.warn('[nilzora] saved recent searches could not be read on this device');
    }
    const replay = pending;
    pending = [];
    const merged = sanitizeQueries(
      replay.reduce<readonly string[]>((acc, edit) => edit(acc), saved),
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
    remember(query) {
      const [clean] = sanitizeQueries([query]);
      if (clean === undefined) return;
      commit((queries) =>
        sanitizeQueries([
          clean,
          ...queries.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase()),
        ]),
      );
    },
    clear() {
      if (snapshot.queries.length === 0) return;
      commit(() => NO_QUERIES);
    },
    flush: () => writeChain,
  };
}
