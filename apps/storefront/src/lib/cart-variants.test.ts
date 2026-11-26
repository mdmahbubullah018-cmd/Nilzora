import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { cartCookieValueFits } from '@nilzora/web-session';
import { describe, expect, it } from 'vitest';
import {
  addToCart,
  cartLineKey,
  cartUnitCount,
  parseCart,
  removeFromCart,
  serializeCart,
  setCartQuantity,
} from './cart';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const MUG = '0d000000-0000-4000-8000-000000000002';
const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';

describe('variant lines in the cart cookie', () => {
  it('keeps the old format for simple products and adds one for a variant', () => {
    expect(serializeCart([{ productId: LAMP, quantity: 2 }])).toBe(`${LAMP}:2`);
    expect(serializeCart([{ productId: LAMP, variantId: RED, quantity: 2 }])).toBe(
      `${LAMP}[${RED}]:2`,
    );
    expect(
      serializeCart([
        { productId: LAMP, variantId: RED, quantity: 2 },
        { productId: LAMP, variantId: BLUE, quantity: 1 },
        { productId: MUG, quantity: 3 },
      ]),
    ).toBe(`${LAMP}[${RED}]:2,${LAMP}[${BLUE}]:1,${MUG}:3`);
  });

  it('round-trips a mixed cart', () => {
    const entries = [
      { productId: LAMP, variantId: RED, quantity: 2 },
      { productId: LAMP, variantId: BLUE, quantity: 1 },
      { productId: MUG, quantity: 4 },
    ];
    expect(parseCart(serializeCart(entries))).toStrictEqual(entries);
  });

  it('reads a cart written before variants existed', () => {
    expect(parseCart(`${LAMP}:2,${MUG}:1`)).toStrictEqual([
      { productId: LAMP, quantity: 2 },
      { productId: MUG, quantity: 1 },
    ]);
  });

  it('drops a line whose variant id is not a uuid', () => {
    expect(parseCart(`${LAMP}[not-a-variant]:2,${MUG}:1`)).toStrictEqual([
      { productId: MUG, quantity: 1 },
    ]);
  });

  it('drops a repeated line but keeps two variants of the same product', () => {
    expect(parseCart(`${LAMP}[${RED}]:2,${LAMP}[${RED}]:3,${LAMP}[${BLUE}]:1`)).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 2 },
      { productId: LAMP, variantId: BLUE, quantity: 1 },
    ]);
  });

  it('still fits the cookie with every line holding a variant', () => {
    const largest = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: `0d000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      variantId: `ee000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      quantity: MAX_LINE_QUANTITY,
    }));
    expect(cartCookieValueFits(serializeCart(largest))).toBe(true);
  });
});

describe('addToCart with variants', () => {
  it('adds two variants of one product as separate lines', () => {
    const first = addToCart([], LAMP, 1, 10, RED);
    expect(first.outcome).toBe('added');
    const second = addToCart(first.entries, LAMP, 2, 10, BLUE);
    expect(second.outcome).toBe('added');
    expect(second.entries).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 2 },
    ]);
    expect(cartUnitCount(second.entries)).toBe(3);
  });

  it('merges only into the line of the same variant', () => {
    const entries = [
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 1 },
    ];
    const { entries: next } = addToCart(entries, LAMP, 1, 10, BLUE);
    expect(next).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 2 },
    ]);
  });

  it('holds the line at the variant limit', () => {
    const entries = [{ productId: LAMP, variantId: RED, quantity: 2 }];
    expect(addToCart(entries, LAMP, 1, 2, RED).outcome).toBe('at_limit');
  });

  it('refuses a variant id that is not a uuid', () => {
    expect(addToCart([], LAMP, 1, 10, 'nope').outcome).toBe('invalid');
  });
});

describe('updating and removing one variant line', () => {
  const entries = () => [
    { productId: LAMP, variantId: RED, quantity: 1 },
    { productId: LAMP, variantId: BLUE, quantity: 2 },
    { productId: MUG, quantity: 1 },
  ];

  it('sets the quantity of the named variant only', () => {
    expect(setCartQuantity(entries(), LAMP, 5, BLUE)).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 5 },
      { productId: MUG, quantity: 1 },
    ]);
  });

  it('removes only the named variant', () => {
    expect(removeFromCart(entries(), LAMP, RED)).toStrictEqual([
      { productId: LAMP, variantId: BLUE, quantity: 2 },
      { productId: MUG, quantity: 1 },
    ]);
  });

  it('leaves simple-product lines keyed by product alone', () => {
    expect(cartLineKey({ productId: MUG })).toBe(`${MUG}:`);
    expect(setCartQuantity(entries(), MUG, 3)).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 2 },
      { productId: MUG, quantity: 3 },
    ]);
    expect(removeFromCart(entries(), MUG)).toStrictEqual([
      { productId: LAMP, variantId: RED, quantity: 1 },
      { productId: LAMP, variantId: BLUE, quantity: 2 },
    ]);
  });
});
