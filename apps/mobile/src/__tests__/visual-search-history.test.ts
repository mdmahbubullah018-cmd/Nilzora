import { createMemoryCartStorage } from '../test-utils/cart-fakes';
import {
  createImageHistoryStore,
  IMAGE_HISTORY_STORAGE_KEY,
  MAX_IMAGE_HISTORY,
  parseStoredHistory,
  sanitizeHistory,
  serializeHistory,
  type ImageHistoryEntry,
} from '../features/visual-search/search-history';

const AT = 1_764_000_000_000;
const entry = (index: number, uri = `file:///cache/photo-${String(index)}.jpg`): ImageHistoryEntry => ({
  uri,
  at: AT + index,
});

describe('searched-photo storage format', () => {
  it('round-trips the list', () => {
    const entries = [entry(2), entry(1)];
    expect(parseStoredHistory(serializeHistory(entries))).toEqual(entries);
  });

  it('refuses data this app did not write', () => {
    expect(parseStoredHistory('nope')).toBeNull();
    expect(parseStoredHistory('[]')).toBeNull();
    expect(parseStoredHistory(JSON.stringify({ v: 2, entries: [] }))).toBeNull();
    expect(parseStoredHistory(JSON.stringify({ v: 1, entries: 'photo' }))).toBeNull();
  });

  it('keeps only local pictures, each once, newest first and capped', () => {
    expect(
      sanitizeHistory([
        entry(3),
        { uri: 'https://elsewhere.example/photo.jpg', at: AT },
        entry(3),
        { uri: 'file:///cache/x.jpg', at: Number.NaN },
        entry(2),
      ]),
    ).toEqual([entry(3), entry(2)]);

    const many = Array.from({ length: MAX_IMAGE_HISTORY + 4 }, (_, index) => entry(index));
    expect(sanitizeHistory(many)).toHaveLength(MAX_IMAGE_HISTORY);
  });
});

describe('searched-photo store', () => {
  it('remembers the newest first, moves a repeat up and persists it', async () => {
    const storage = createMemoryCartStorage();
    const store = createImageHistoryStore({ storage });
    await store.hydrate();

    store.remember(entry(1));
    store.remember(entry(2));
    store.remember(entry(1));
    await store.flush();

    expect(store.getEntries().map((item) => item.uri)).toEqual([entry(1).uri, entry(2).uri]);
    const saved = await storage.getItem(IMAGE_HISTORY_STORAGE_KEY);
    expect(parseStoredHistory(saved ?? '')).toEqual([entry(1), entry(2)]);
  });

  it('forgets one picture and can clear the list', async () => {
    const storage = createMemoryCartStorage();
    const store = createImageHistoryStore({ storage });
    await store.hydrate();
    store.remember(entry(1));
    store.remember(entry(2));

    store.forget(entry(1).uri);
    expect(store.getEntries()).toEqual([entry(2)]);

    store.clear();
    await store.flush();
    expect(store.getEntries()).toEqual([]);
    expect(parseStoredHistory((await storage.getItem(IMAGE_HISTORY_STORAGE_KEY)) ?? '')).toEqual([]);
  });

  it('keeps a search made before the saved list was read', async () => {
    const storage = createMemoryCartStorage();
    const saved = serializeHistory([entry(5)]);
    await storage.setItem(IMAGE_HISTORY_STORAGE_KEY, saved);
    const store = createImageHistoryStore({ storage });

    store.remember(entry(9));
    await store.hydrate();

    expect(store.getEntries().map((item) => item.uri)).toEqual([entry(9).uri, entry(5).uri]);
  });

  it('starts empty when the saved data is unusable', async () => {
    const storage = createMemoryCartStorage();
    await storage.setItem(IMAGE_HISTORY_STORAGE_KEY, 'not ours');
    const store = createImageHistoryStore({ storage });

    await store.hydrate();

    expect(store.getEntries()).toEqual([]);
    expect(await storage.getItem(IMAGE_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
