import {
  addToItems,
  lineKey,
  removeItem,
  sameItems,
  sanitizeItems,
  setItemQuantity,
  type CartItem,
} from '../cart/cart-items';
import { createCartStore, parseStoredCart, serializeCart } from '../cart/cart-store';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';

const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('cart line identity', () => {
  it('tells two variants of one product apart, and a simple line from both', () => {
    expect(lineKey({ productId: PRODUCT_A, variantId: RED })).toBe(`${PRODUCT_A}:${RED}`);
    expect(lineKey({ productId: PRODUCT_A, variantId: BLUE })).not.toBe(`${PRODUCT_A}:${RED}`);
    expect(lineKey({ productId: PRODUCT_A })).toBe(`${PRODUCT_A}:`);
  });

  it('compares carts by variant, not only by product', () => {
    const red: CartItem = { productId: PRODUCT_A, variantId: RED, quantity: 1 };
    const blue: CartItem = { productId: PRODUCT_A, variantId: BLUE, quantity: 1 };
    expect(sameItems([red], [blue])).toBe(false);
    expect(sameItems([red], [{ ...red }])).toBe(true);
  });
});

describe('adding and editing variant lines', () => {
  it('keeps two variants of one product as separate lines', () => {
    const first = addToItems([], PRODUCT_A, 1, 5, RED);
    expect(first.items).toEqual([{ productId: PRODUCT_A, variantId: RED, quantity: 1 }]);

    const second = addToItems(first.items, PRODUCT_A, 2, 5, BLUE);
    expect(second.items).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 2 },
    ]);
  });

  it('merges only into the line of the same variant', () => {
    const items: CartItem[] = [
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 1 },
    ];
    expect(addToItems(items, PRODUCT_A, 2, 5, BLUE).items).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 3 },
    ]);
  });

  it('keeps simple lines keyed by the product alone', () => {
    const items: CartItem[] = [
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_B, quantity: 2 },
    ];
    expect(setItemQuantity(items, PRODUCT_B, 4)).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_B, quantity: 4 },
    ]);
    expect(removeItem(items, PRODUCT_B)).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
    ]);
  });

  it('updates and removes only the named variant', () => {
    const items: CartItem[] = [
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 2 },
    ];
    expect(setItemQuantity(items, PRODUCT_A, 4, BLUE)).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 4 },
    ]);
    expect(removeItem(items, PRODUCT_A, RED)).toEqual([
      { productId: PRODUCT_A, variantId: BLUE, quantity: 2 },
    ]);
  });

  it('refuses a variant id that is not a uuid', () => {
    expect(addToItems([], PRODUCT_A, 1, 5, 'nope').outcome).toBe('invalid');
  });
});

describe('saved carts', () => {
  it('writes the variant only when there is one', () => {
    const saved = JSON.parse(
      serializeCart([
        { productId: PRODUCT_A, variantId: RED, quantity: 2 },
        { productId: PRODUCT_B, quantity: 1 },
      ]),
    ) as { items: Record<string, unknown>[] };
    expect(saved.items).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 2 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);
  });

  it('restores a cart saved before variants existed', () => {
    const raw = JSON.stringify({ v: 1, items: [{ productId: PRODUCT_B, quantity: 2 }] });
    expect(parseStoredCart(raw)).toEqual([{ productId: PRODUCT_B, quantity: 2 }]);
  });

  it('drops a repeated variant line but keeps the other variant', () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        { productId: PRODUCT_A, variantId: RED, quantity: 1 },
        { productId: PRODUCT_A, variantId: RED, quantity: 3 },
        { productId: PRODUCT_A, variantId: BLUE, quantity: 1 },
      ],
    });
    expect(parseStoredCart(raw)).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 1 },
    ]);
  });

  it('keeps a variant through sanitizing', () => {
    expect(sanitizeItems([{ productId: PRODUCT_A, variantId: RED.toUpperCase(), quantity: 2 }])) //
      .toEqual([{ productId: PRODUCT_A, variantId: RED, quantity: 2 }]);
  });

  it('stores and restores a variant line through the store', async () => {
    const storage = createMemoryCartStorage();
    const store = createCartStore({ storage });
    await store.hydrate();

    expect(store.add(PRODUCT_A, 1, 5, RED)).toBe('added');
    expect(store.add(PRODUCT_A, 2, 5, BLUE)).toBe('added');
    await store.flush();

    const restored = createCartStore({ storage });
    await restored.hydrate();
    expect(restored.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, variantId: RED, quantity: 1 },
      { productId: PRODUCT_A, variantId: BLUE, quantity: 2 },
    ]);
  });
});
