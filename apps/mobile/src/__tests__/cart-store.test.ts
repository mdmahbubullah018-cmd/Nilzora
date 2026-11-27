import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { addToItems, countUnits, sanitizeItems } from '../cart/cart-items';
import {
  CART_SELECTION_KEY,
  CART_STORAGE_KEY,
  createCartStore,
  MAX_STORED_CART_LENGTH,
  parseStoredCart,
  serializeCart,
} from '../cart/cart-store';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B, PRODUCT_C } from '../test-utils/cart-fakes';

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

/** A distinct valid product id per index. */
function productId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

async function hydratedStore(initial: Record<string, string> = {}) {
  const storage = createMemoryCartStorage(initial);
  const store = createCartStore({ storage });
  await store.hydrate();
  return { storage, store };
}

describe('hydration and persistence', () => {
  it('starts empty and not hydrated, then hydrates an empty cart when nothing is saved', async () => {
    const storage = createMemoryCartStorage();
    const store = createCartStore({ storage });
    expect(store.getSnapshot()).toEqual({
      items: [],
      count: 0,
      hydrated: false,
      selected: new Set(),
    });

    await store.hydrate();

    expect(store.getSnapshot()).toEqual({
      items: [],
      count: 0,
      hydrated: true,
      selected: new Set(),
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('saves every change and restores it in a new store (round trip)', async () => {
    const { storage, store } = await hydratedStore();
    store.add(PRODUCT_A, 2);
    store.add(PRODUCT_B);
    store.setQuantity(PRODUCT_B, 4);
    await store.flush();

    expect(JSON.parse(storage.read(CART_STORAGE_KEY) ?? 'null')).toEqual({
      v: 1,
      items: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 4 },
      ],
    });

    const reopened = createCartStore({ storage });
    await reopened.hydrate();
    expect(reopened.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 4 },
    ]);
    expect(reopened.getSnapshot().count).toBe(6);
  });

  it('stores only product ids and quantities', async () => {
    const { storage, store } = await hydratedStore();
    store.add(PRODUCT_A, 1);
    await store.flush();

    const saved = JSON.parse(storage.read(CART_STORAGE_KEY) ?? '{}') as { items: object[] };
    expect(Object.keys(saved.items[0] ?? {})).toEqual(['productId', 'quantity']);
  });

  it('shares one read between concurrent hydrate() calls', async () => {
    const storage = createMemoryCartStorage();
    const store = createCartStore({ storage });
    await Promise.all([store.hydrate(), store.hydrate()]);
    await store.hydrate();
    // Two keys on start — the cart and the selection it was saved with — read once each, however
    // many times hydration is asked for.
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(storage.getItem).toHaveBeenCalledWith(CART_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledWith(CART_SELECTION_KEY);
  });

  it('replays edits made before hydration on top of the saved cart, and saves the result', async () => {
    const storage = createMemoryCartStorage({
      [CART_STORAGE_KEY]: serializeCart([{ productId: PRODUCT_A, quantity: 2 }]),
    });
    const store = createCartStore({ storage });

    store.add(PRODUCT_A, 1);
    store.add(PRODUCT_B, 3);
    expect(store.getSnapshot().hydrated).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled(); // never overwrite what was not read yet

    await store.hydrate();
    await store.flush();

    expect(store.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, quantity: 3 },
      { productId: PRODUCT_B, quantity: 3 },
    ]);
    expect(parseStoredCart(storage.read(CART_STORAGE_KEY) ?? '')).toEqual(
      store.getSnapshot().items,
    );
  });

  it('honours a clear() made before hydration', async () => {
    const storage = createMemoryCartStorage({
      [CART_STORAGE_KEY]: serializeCart([{ productId: PRODUCT_A, quantity: 2 }]),
    });
    const store = createCartStore({ storage });

    store.add(PRODUCT_B);
    store.clear();
    await store.hydrate();
    await store.flush();

    expect(store.getSnapshot().items).toEqual([]);
    expect(parseStoredCart(storage.read(CART_STORAGE_KEY) ?? '')).toEqual([]);
  });

  it('coalesces rapid changes, ending with the latest cart on disk', async () => {
    const { storage, store } = await hydratedStore();
    for (let quantity = 1; quantity <= 5; quantity += 1) store.add(PRODUCT_A);
    await store.flush();

    expect(parseStoredCart(storage.read(CART_STORAGE_KEY) ?? '')).toEqual([
      { productId: PRODUCT_A, quantity: 5 },
    ]);
    expect(storage.setItem.mock.calls.length).toBeLessThan(5);
  });
});

describe('tolerant loading', () => {
  const valid = { productId: PRODUCT_A, quantity: 2 };

  it.each([
    ['not JSON', '{oops'],
    ['an unknown format version', JSON.stringify({ v: 2, items: [valid] })],
    ['a missing version', JSON.stringify({ items: [valid] })],
    ['items that are not a list', JSON.stringify({ v: 1, items: 'nope' })],
    ['a bare array', JSON.stringify([valid])],
    ['null', 'null'],
    ['a number', '42'],
    [
      'oversized data',
      JSON.stringify({ v: 1, items: [valid], pad: 'x'.repeat(MAX_STORED_CART_LENGTH) }),
    ],
  ])('drops %s without crashing, and forgets it', async (_name, raw) => {
    const { storage, store } = await hydratedStore({ [CART_STORAGE_KEY]: raw });

    expect(store.getSnapshot()).toEqual({
      items: [],
      count: 0,
      hydrated: true,
      selected: new Set(),
    });
    await Promise.resolve();
    expect(storage.removeItem).toHaveBeenCalledWith(CART_STORAGE_KEY);
  });

  it('keeps the valid lines and drops the invalid ones', async () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        valid,
        { productId: 'not-a-uuid', quantity: 1 },
        { productId: PRODUCT_B, quantity: 0 },
        { productId: PRODUCT_B, quantity: MAX_LINE_QUANTITY + 1 },
        { productId: PRODUCT_B, quantity: 1.5 },
        { productId: PRODUCT_B, quantity: '3' },
        { productId: PRODUCT_A.toUpperCase(), quantity: 9 }, // repeat of the first line
        { productId: 7, quantity: 1 },
        null,
        'text',
        { productId: PRODUCT_C, quantity: 1 },
      ],
    });
    const { store } = await hydratedStore({ [CART_STORAGE_KEY]: raw });

    expect(store.getSnapshot().items).toEqual([valid, { productId: PRODUCT_C, quantity: 1 }]);
  });

  it(`never holds more than ${MAX_CART_LINES} lines`, () => {
    const items = Array.from({ length: MAX_CART_LINES + 10 }, (_, index) => ({
      productId: productId(index),
      quantity: 1,
    }));
    expect(parseStoredCart(JSON.stringify({ v: 1, items }))).toHaveLength(MAX_CART_LINES);
  });

  it('hydrates an empty cart when storage cannot be read', async () => {
    const storage = createMemoryCartStorage();
    storage.getItem.mockRejectedValue(new Error('disk unavailable'));
    const store = createCartStore({ storage });

    await expect(store.hydrate()).resolves.toBeUndefined();

    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.add(PRODUCT_A)).toBe('added');
  });

  it('does not crash when forgetting unusable data fails', async () => {
    const storage = createMemoryCartStorage({ [CART_STORAGE_KEY]: '{oops' });
    storage.removeItem.mockRejectedValue(new Error('disk unavailable'));
    const store = createCartStore({ storage });

    await expect(store.hydrate()).resolves.toBeUndefined();
    expect(store.getSnapshot().hydrated).toBe(true);
  });
});

describe('write failures', () => {
  it('keeps the in-memory cart working and tries again on the next change', async () => {
    const { storage, store } = await hydratedStore();
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));

    expect(store.add(PRODUCT_A, 2)).toBe('added');
    await store.flush();
    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cart could not be saved'));

    store.setQuantity(PRODUCT_A, 3);
    await store.flush();
    expect(parseStoredCart(storage.read(CART_STORAGE_KEY) ?? '')).toEqual([
      { productId: PRODUCT_A, quantity: 3 },
    ]);
  });

  it('does not log product ids when a save fails', async () => {
    const { storage, store } = await hydratedStore();
    storage.setItem.mockRejectedValue(new Error('disk full'));
    store.add(PRODUCT_A);
    await store.flush();

    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRODUCT_A);
  });
});

describe('limits and merging', () => {
  it('merges repeated adds of a product into one line, whatever the id case', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A, 2);
    store.add(PRODUCT_A.toUpperCase(), 3);

    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_A, quantity: 5 }]);
  });

  it('holds a line at the per-order limit given by the caller', async () => {
    const { store } = await hydratedStore();

    expect(store.add(PRODUCT_A, 2, 3)).toBe('added');
    expect(store.add(PRODUCT_A, 5, 3)).toBe('added'); // partly: capped at 3
    expect(store.getSnapshot().items[0]?.quantity).toBe(3);
    expect(store.add(PRODUCT_A, 1, 3)).toBe('at_limit');
  });

  it('never exceeds the contract line limit, and reports it', async () => {
    const { store } = await hydratedStore();

    expect(store.add(PRODUCT_A, MAX_LINE_QUANTITY)).toBe('added');
    expect(store.add(PRODUCT_A, 1)).toBe('at_limit');
    expect(store.getSnapshot().items[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(store.add(PRODUCT_B, MAX_LINE_QUANTITY, 1000)).toBe('added');
    expect(store.getSnapshot().items[1]?.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('refuses to add a product that cannot be ordered (limit below 1)', async () => {
    const { store } = await hydratedStore();
    expect(store.add(PRODUCT_A, 1, 0)).toBe('at_limit');
    expect(store.getSnapshot().items).toEqual([]);
  });

  it(`refuses a ${MAX_CART_LINES + 1}th distinct product`, async () => {
    const { store } = await hydratedStore();
    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      expect(store.add(productId(index))).toBe('added');
    }

    expect(store.add(productId(MAX_CART_LINES))).toBe('cart_full');
    expect(store.getSnapshot().items).toHaveLength(MAX_CART_LINES);
    // An existing line can still grow when the cart is full.
    expect(store.add(productId(0))).toBe('added');
  });

  it.each([
    ['an id that is not a UUID', 'abc', 1],
    ['a zero quantity', PRODUCT_A, 0],
    ['a negative quantity', PRODUCT_A, -1],
    ['a fractional quantity', PRODUCT_A, 1.5],
    ['NaN', PRODUCT_A, Number.NaN],
    ['too many units at once', PRODUCT_A, MAX_LINE_QUANTITY + 1],
  ])('rejects %s', async (_name, id, quantity) => {
    const { store } = await hydratedStore();
    expect(store.add(id, quantity)).toBe('invalid');
    expect(store.getSnapshot().items).toEqual([]);
  });

  it('sets, clamps and removes quantities', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A, 2);
    store.add(PRODUCT_B, 2);

    store.setQuantity(PRODUCT_A, 7);
    expect(store.getSnapshot().items[0]?.quantity).toBe(7);
    store.setQuantity(PRODUCT_A, MAX_LINE_QUANTITY + 50);
    expect(store.getSnapshot().items[0]?.quantity).toBe(MAX_LINE_QUANTITY);

    // Ignored: not a whole number, negative, or not in the cart.
    store.setQuantity(PRODUCT_A, 2.5);
    store.setQuantity(PRODUCT_A, -1);
    store.setQuantity(PRODUCT_A, Number.NaN);
    store.setQuantity(PRODUCT_C, 3);
    expect(store.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, quantity: MAX_LINE_QUANTITY },
      { productId: PRODUCT_B, quantity: 2 },
    ]);

    store.setQuantity(PRODUCT_A, 0);
    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 2 }]);
  });

  it('removes a line and clears the cart', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A);
    store.add(PRODUCT_B);

    store.remove(PRODUCT_A.toUpperCase());
    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
    store.clear();
    expect(store.getSnapshot()).toEqual({
      items: [],
      count: 0,
      hydrated: true,
      selected: new Set(),
    });
  });

  it('re-validates the result of update()', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A, 2);

    store.update(() => [
      { productId: PRODUCT_B, quantity: 1 },
      { productId: PRODUCT_B, quantity: 5 },
      { productId: 'bad', quantity: 1 },
      { productId: PRODUCT_C, quantity: MAX_LINE_QUANTITY + 1 },
    ]);

    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
  });
});

describe('subscriptions', () => {
  it('keeps one snapshot object until something changes, and does not notify no-ops', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A, 2);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();

    store.setQuantity(PRODUCT_A, 2); // same value
    store.remove(PRODUCT_B); // not in the cart
    store.setQuantity(PRODUCT_C, 4); // not in the cart
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);

    store.setQuantity(PRODUCT_A, 3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);

    unsubscribe();
    store.setQuantity(PRODUCT_A, 4);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('counts units, not lines', async () => {
    const { store } = await hydratedStore();
    store.add(PRODUCT_A, 3);
    store.add(PRODUCT_B, 2);
    expect(store.getSnapshot().count).toBe(5);
    expect(countUnits(store.getSnapshot().items)).toBe(5);
  });
});

describe('pure helpers', () => {
  it('addToItems leaves the input untouched', () => {
    const items = Object.freeze([{ productId: PRODUCT_A, quantity: 1 }]);
    const { items: next } = addToItems(items, PRODUCT_A, 1);
    expect(next).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    expect(items).toEqual([{ productId: PRODUCT_A, quantity: 1 }]);
  });

  it('sanitizeItems accepts only plain objects', () => {
    expect(sanitizeItems([[], 'x', 3, undefined])).toEqual([]);
  });
});
