import { createMemoryCartStorage } from '../test-utils/cart-fakes';
import {
  createWishlistStore,
  MAX_STORED_WISHLIST_LENGTH,
  MAX_WISHLIST_ENTRIES,
  parseStoredWishlist,
  sanitizeEntries,
  serializeWishlist,
  WISHLIST_STORAGE_KEY,
} from '../wishlist/wishlist-store';

describe('wishlist storage format', () => {
  it('round-trips entries, newest first', () => {
    const entries = [
      { slug: 'cotton-shirt', savedAt: '2026-10-30T09:00:00.000Z' },
      { slug: 'leather-belt', savedAt: '2026-10-29T09:00:00.000Z' },
    ];

    expect(parseStoredWishlist(serializeWishlist(entries))).toEqual(entries);
  });

  it('refuses anything that is not a wishlist this app wrote', () => {
    expect(parseStoredWishlist('not json')).toBeNull();
    expect(parseStoredWishlist('[]')).toBeNull();
    expect(parseStoredWishlist(JSON.stringify({ v: 2, entries: [] }))).toBeNull();
    expect(parseStoredWishlist(JSON.stringify({ v: 1, entries: 'x' }))).toBeNull();
    expect(parseStoredWishlist('x'.repeat(MAX_STORED_WISHLIST_LENGTH + 1))).toBeNull();
  });

  it('drops repeated and malformed slugs instead of failing the whole list', () => {
    const entries = sanitizeEntries([
      { slug: 'cotton-shirt', savedAt: '2026-10-30T09:00:00.000Z' },
      { slug: 'cotton-shirt', savedAt: '2026-10-30T08:00:00.000Z' },
      { slug: 'Not A Slug' },
      { slug: '' },
      null,
      'cotton-shirt',
      { slug: 'leather-belt' },
    ]);

    expect(entries.map((entry) => entry.slug)).toEqual(['cotton-shirt', 'leather-belt']);
    // A missing timestamp sorts it last rather than discarding the product.
    expect(entries[1]?.savedAt).toBe(new Date(0).toISOString());
  });

  it('keeps at most the documented number of products', () => {
    const many = Array.from({ length: MAX_WISHLIST_ENTRIES + 20 }, (_, index) => ({
      slug: `product-${String(index)}`,
    }));

    expect(sanitizeEntries(many)).toHaveLength(MAX_WISHLIST_ENTRIES);
  });
});

describe('wishlist store', () => {
  const NOW = new Date('2026-10-30T09:00:00.000Z');

  function store(initial: Record<string, string> = {}) {
    const storage = createMemoryCartStorage(initial);
    return { storage, wishlist: createWishlistStore({ storage, now: () => NOW }) };
  }

  it('starts empty and becomes hydrated once the device has been read', async () => {
    const { wishlist } = store();

    expect(wishlist.getSnapshot()).toEqual({ entries: [], count: 0, hydrated: false });
    await wishlist.hydrate();

    expect(wishlist.getSnapshot()).toEqual({ entries: [], count: 0, hydrated: true });
  });

  it('saves a product, persists it, and removes it on the second toggle', async () => {
    const { storage, wishlist } = store();
    await wishlist.hydrate();

    expect(wishlist.toggle('cotton-shirt')).toBe(true);
    expect(wishlist.has('cotton-shirt')).toBe(true);
    await wishlist.flush();
    expect(storage.read(WISHLIST_STORAGE_KEY)).toContain('cotton-shirt');

    expect(wishlist.toggle('cotton-shirt')).toBe(false);
    expect(wishlist.has('cotton-shirt')).toBe(false);
    await wishlist.flush();
    expect(storage.read(WISHLIST_STORAGE_KEY)).not.toContain('cotton-shirt');
  });

  it('puts the newest product first', async () => {
    const { wishlist } = store();
    await wishlist.hydrate();

    wishlist.toggle('cotton-shirt');
    wishlist.toggle('leather-belt');

    expect(wishlist.getSnapshot().entries.map((entry) => entry.slug)).toEqual([
      'leather-belt',
      'cotton-shirt',
    ]);
  });

  it('ignores a slug the catalog could never use', async () => {
    const { wishlist } = store();
    await wishlist.hydrate();

    expect(wishlist.toggle('Not A Slug')).toBe(false);
    expect(wishlist.getSnapshot().count).toBe(0);
  });

  it('reads a saved list back from the device', async () => {
    const saved = serializeWishlist([
      { slug: 'cotton-shirt', savedAt: '2026-10-30T08:00:00.000Z' },
    ]);
    const { wishlist } = store({ [WISHLIST_STORAGE_KEY]: saved });
    await wishlist.hydrate();

    expect(wishlist.getSnapshot().entries).toEqual([
      { slug: 'cotton-shirt', savedAt: '2026-10-30T08:00:00.000Z' },
    ]);
  });

  it('forgets an unusable saved list instead of failing', async () => {
    const { storage, wishlist } = store({ [WISHLIST_STORAGE_KEY]: '{oops' });
    await wishlist.hydrate();

    expect(wishlist.getSnapshot()).toEqual({ entries: [], count: 0, hydrated: true });
    expect(storage.removeItem).toHaveBeenCalledWith(WISHLIST_STORAGE_KEY);
  });

  it('keeps a product saved before the device had been read', async () => {
    const { wishlist } = store();

    wishlist.toggle('cotton-shirt');
    await wishlist.hydrate();

    expect(wishlist.has('cotton-shirt')).toBe(true);
    expect(wishlist.getSnapshot().hydrated).toBe(true);
  });

  it('never rejects when the device storage fails', async () => {
    const storage = createMemoryCartStorage();
    storage.getItem.mockRejectedValueOnce(new Error('disk unavailable'));
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    const wishlist = createWishlistStore({ storage, now: () => NOW });

    await wishlist.hydrate();
    wishlist.toggle('cotton-shirt');
    await wishlist.flush();

    expect(wishlist.getSnapshot().count).toBe(1);
  });
});
