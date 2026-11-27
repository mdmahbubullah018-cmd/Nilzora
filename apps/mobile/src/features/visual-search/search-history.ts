import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Photos searched from this device
 * --------------------------------
 * The API keeps no record of a search's picture — it hashes it, compares it and discards it —
 * so the camera's History strip is filled here, on the phone, from the pictures this app
 * prepared. Nothing is uploaded to make it work and nothing is shared between accounts.
 *
 * Only local files are kept (`file://` from the crop, `content://` from the picker): a remote
 * URL would be someone else's address, and this list is never more than a convenience.
 */

export const IMAGE_HISTORY_STORAGE_KEY = 'nilzora.visual-search-history.v1';
const STORAGE_FORMAT = 1;
/** One screenful of recent pictures; more would never be reachable in the strip. */
export const MAX_IMAGE_HISTORY = 12;
const MAX_STORED_LENGTH = 16_384;

export interface ImageHistoryEntry {
  uri: string;
  /** When the search ran, in epoch milliseconds. */
  at: number;
}

export interface ImageHistoryStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const LOCAL_URI = /^(file|content|ph|assets-library):/i;

function isEntry(value: unknown): value is ImageHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { uri, at } = value as { uri?: unknown; at?: unknown };
  return (
    typeof uri === 'string' && LOCAL_URI.test(uri) && typeof at === 'number' && Number.isFinite(at)
  );
}

/** Newest first, each picture once, capped. */
export function sanitizeHistory(values: readonly unknown[]): ImageHistoryEntry[] {
  const seen = new Set<string>();
  const entries: ImageHistoryEntry[] = [];
  for (const value of values) {
    if (!isEntry(value) || seen.has(value.uri)) continue;
    seen.add(value.uri);
    entries.push({ uri: value.uri, at: value.at });
    if (entries.length >= MAX_IMAGE_HISTORY) break;
  }
  return entries;
}

/** Reads the saved list. Returns null when the data is not something this app wrote. */
export function parseStoredHistory(raw: string): ImageHistoryEntry[] | null {
  if (raw.length > MAX_STORED_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { v, entries } = value as { v?: unknown; entries?: unknown };
  if (v !== STORAGE_FORMAT || !Array.isArray(entries)) return null;
  return sanitizeHistory(entries);
}

export function serializeHistory(entries: readonly ImageHistoryEntry[]): string {
  return JSON.stringify({ v: STORAGE_FORMAT, entries });
}

export interface ImageHistoryStore {
  /** Newest first; empty until the saved list has been read. */
  getEntries: () => readonly ImageHistoryEntry[];
  hydrate: () => Promise<void>;
  remember: (entry: ImageHistoryEntry) => void;
  forget: (uri: string) => void;
  clear: () => void;
  /** Resolves when everything changed so far has been written (or failed to be). */
  flush: () => Promise<void>;
}

export interface ImageHistoryStoreOptions {
  storage: ImageHistoryStorage;
  key?: string;
}

export function createImageHistoryStore({
  storage,
  key = IMAGE_HISTORY_STORAGE_KEY,
}: ImageHistoryStoreOptions): ImageHistoryStore {
  let entries: ImageHistoryEntry[] = [];
  let hydration: Promise<void> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  function persist(): void {
    writeChain = writeChain.then(async () => {
      try {
        await storage.setItem(key, serializeHistory(entries));
      } catch {
        console.warn('[nilzora] searched photos could not be saved on this device');
      }
    });
  }

  function replace(next: ImageHistoryEntry[]): void {
    if (
      next.length === entries.length &&
      next.every((item, index) => item.uri === entries[index]?.uri)
    ) {
      return;
    }
    entries = next;
    persist();
  }

  async function load(): Promise<void> {
    try {
      const raw = await storage.getItem(key);
      if (raw === null) return;
      const parsed = parseStoredHistory(raw);
      if (parsed === null) {
        void Promise.resolve()
          .then(() => storage.removeItem(key))
          .catch(() => undefined);
        return;
      }
      // Something remembered before the read finished still wins: it is the newer search.
      entries = sanitizeHistory([...entries, ...parsed]);
    } catch {
      console.warn('[nilzora] saved searched photos could not be read on this device');
    }
  }

  return {
    getEntries: () => entries,
    hydrate() {
      hydration ??= load();
      return hydration;
    },
    remember(entry) {
      const [clean] = sanitizeHistory([entry]);
      if (clean === undefined) return;
      replace(sanitizeHistory([clean, ...entries]));
    },
    forget(uri) {
      replace(entries.filter((item) => item.uri !== uri));
    },
    clear() {
      replace([]);
    },
    flush: () => writeChain,
  };
}

/** The store the camera screen uses; hydration is started by the hook that reads it. */
export const imageHistory = createImageHistoryStore({ storage: AsyncStorage });
