import { createMemoryCartStorage } from '../test-utils/cart-fakes';
import {
  createRecentSearchStore,
  MAX_RECENT_SEARCHES,
  MAX_RECENT_SEARCH_LENGTH,
  parseStoredSearches,
  RECENT_SEARCHES_STORAGE_KEY,
  sanitizeQueries,
  serializeSearches,
} from '../features/catalog/recent-searches';

describe('recent search storage format', () => {
  it('round-trips the list', () => {
    expect(parseStoredSearches(serializeSearches(['shirt', 'rice']))).toEqual(['shirt', 'rice']);
  });

  it('refuses data this app did not write', () => {
    expect(parseStoredSearches('nope')).toBeNull();
    expect(parseStoredSearches('[]')).toBeNull();
    expect(parseStoredSearches(JSON.stringify({ v: 2, queries: [] }))).toBeNull();
    expect(parseStoredSearches(JSON.stringify({ v: 1, queries: 'shirt' }))).toBeNull();
  });

  it('trims, drops blanks, ignores case when deduplicating and keeps the newest casing', () => {
    expect(sanitizeQueries(['  shirt ', '', '   ', 'SHIRT', 'rice'])).toEqual(['shirt', 'rice']);
  });

  it('caps the length of a term and the number of terms', () => {
    const long = 'a'.repeat(MAX_RECENT_SEARCH_LENGTH + 20);
    expect(sanitizeQueries([long])[0]).toHaveLength(MAX_RECENT_SEARCH_LENGTH);

    const many = Array.from(
      { length: MAX_RECENT_SEARCHES + 5 },
      (_, index) => `term ${String(index)}`,
    );
    expect(sanitizeQueries(many)).toHaveLength(MAX_RECENT_SEARCHES);
  });
});

describe('recent search store', () => {
  function store(initial: Record<string, string> = {}) {
    const storage = createMemoryCartStorage(initial);
    return { storage, recents: createRecentSearchStore({ storage }) };
  }

  it('starts empty and hydrates', async () => {
    const { recents } = store();
    expect(recents.getSnapshot()).toEqual({ queries: [], hydrated: false });

    await recents.hydrate();

    expect(recents.getSnapshot()).toEqual({ queries: [], hydrated: true });
  });

  it('remembers a term, most recent first, without duplicating it', async () => {
    const { recents } = store();
    await recents.hydrate();

    recents.remember('shirt');
    recents.remember('rice');
    recents.remember('SHIRT');

    expect(recents.getSnapshot().queries).toEqual(['SHIRT', 'rice']);
  });

  it('ignores blank terms', async () => {
    const { recents } = store();
    await recents.hydrate();

    recents.remember('   ');

    expect(recents.getSnapshot().queries).toEqual([]);
  });

  it('writes the list and reads it back', async () => {
    const { storage, recents } = store();
    await recents.hydrate();
    recents.remember('shirt');
    await recents.flush();

    const saved = storage.read(RECENT_SEARCHES_STORAGE_KEY);
    expect(saved).toContain('shirt');

    const reopened = createRecentSearchStore({ storage });
    await reopened.hydrate();
    expect(reopened.getSnapshot().queries).toEqual(['shirt']);
  });

  it('clears the list', async () => {
    const { recents } = store();
    await recents.hydrate();
    recents.remember('shirt');

    recents.clear();

    expect(recents.getSnapshot().queries).toEqual([]);
  });

  it('forgets an unusable saved list instead of failing', async () => {
    const { storage, recents } = store({ [RECENT_SEARCHES_STORAGE_KEY]: '{oops' });
    await recents.hydrate();

    expect(recents.getSnapshot()).toEqual({ queries: [], hydrated: true });
    expect(storage.removeItem).toHaveBeenCalledWith(RECENT_SEARCHES_STORAGE_KEY);
  });

  it('keeps a term remembered before the device had been read', async () => {
    const { recents } = store();

    recents.remember('shirt');
    await recents.hydrate();

    expect(recents.getSnapshot().queries).toEqual(['shirt']);
  });

  it('never rejects when the device storage fails', async () => {
    const storage = createMemoryCartStorage();
    storage.getItem.mockRejectedValueOnce(new Error('disk unavailable'));
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    const recents = createRecentSearchStore({ storage });

    await recents.hydrate();
    recents.remember('shirt');
    await recents.flush();

    expect(recents.getSnapshot().queries).toEqual(['shirt']);
  });
});
