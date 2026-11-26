import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { cartCookieValueFits } from '@nilzora/web-session';
import { describe, expect, it } from 'vitest';
import {
  addToCart,
  cartUnitCount,
  parseCart,
  removeFromCart,
  serializeCart,
  setCartQuantity,
} from './cart';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const MUG = '0d000000-0000-4000-8000-000000000002';

const idAt = (index: number) => `fa000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('parseCart / serializeCart', () => {
  it('round-trips a cart', () => {
    const entries = [
      { productId: LAMP, quantity: 2 },
      { productId: MUG, quantity: 1 },
    ];
    expect(parseCart(serializeCart(entries))).toStrictEqual(entries);
  });

  it('reads nothing from a missing or empty cookie', () => {
    expect(parseCart(undefined)).toStrictEqual([]);
    expect(parseCart('')).toStrictEqual([]);
  });

  it('drops malformed, repeated and out-of-range entries', () => {
    const value = [
      `${LAMP}:2`,
      `${LAMP.toUpperCase()}:5`, // repeated (case-insensitive)
      `${MUG}:0`,
      `${MUG}:101`,
      `${MUG}:1.5`,
      `${MUG}:-1`,
      `not-a-uuid:1`,
      `${MUG}:1:extra`,
      `${MUG}`,
      ':1',
    ].join(',');
    expect(parseCart(value)).toStrictEqual([{ productId: LAMP, quantity: 2 }]);
  });

  it('always fits the cart cookie, even for the largest cart the contract allows', () => {
    const largest = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: idAt(index),
      quantity: MAX_LINE_QUANTITY,
    }));
    expect(cartCookieValueFits(serializeCart(largest))).toBe(true);
  });

  it('keeps at most the maximum number of lines', () => {
    const value = Array.from({ length: MAX_CART_LINES + 5 }, (_, index) => `${idAt(index)}:1`).join(
      ',',
    );
    expect(parseCart(value)).toHaveLength(MAX_CART_LINES);
  });
});

describe('cart changes', () => {
  it('adds a new line and merges repeats up to the limit', () => {
    let { entries } = addToCart([], LAMP, 2, 3);
    expect(entries).toStrictEqual([{ productId: LAMP, quantity: 2 }]);
    ({ entries } = addToCart(entries, LAMP.toUpperCase(), 2, 3));
    expect(entries).toStrictEqual([{ productId: LAMP, quantity: 3 }]);
  });

  it('reports a line that is already at its limit without changing it', () => {
    const entries = [{ productId: LAMP, quantity: 3 }];
    expect(addToCart(entries, LAMP, 1, 3)).toStrictEqual({ entries, outcome: 'at_limit' });
  });

  it('never exceeds the absolute line quantity', () => {
    const { entries } = addToCart(
      [{ productId: LAMP, quantity: MAX_LINE_QUANTITY }],
      LAMP,
      5,
      1_000,
    );
    expect(entries[0]?.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('refuses invalid products and quantities', () => {
    expect(addToCart([], 'lamp', 1).outcome).toBe('invalid');
    expect(addToCart([], LAMP, 0).outcome).toBe('invalid');
    expect(addToCart([], LAMP, 2.5).outcome).toBe('invalid');
  });

  it('refuses a new product when the cart is full, but still merges existing lines', () => {
    const full = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: idAt(index),
      quantity: 1,
    }));
    expect(addToCart(full, LAMP, 1).outcome).toBe('cart_full');
    expect(addToCart(full, idAt(0), 1)).toMatchObject({ outcome: 'added' });
  });

  it('sets, removes and counts lines', () => {
    const entries = [
      { productId: LAMP, quantity: 2 },
      { productId: MUG, quantity: 1 },
    ];
    expect(setCartQuantity(entries, MUG, 4)).toStrictEqual([
      { productId: LAMP, quantity: 2 },
      { productId: MUG, quantity: 4 },
    ]);
    expect(setCartQuantity(entries, MUG, 0)).toStrictEqual([{ productId: LAMP, quantity: 2 }]);
    expect(setCartQuantity(entries, MUG, 101)).toStrictEqual(entries);
    expect(removeFromCart(entries, LAMP)).toStrictEqual([{ productId: MUG, quantity: 1 }]);
    expect(cartUnitCount(entries)).toBe(3);
  });
});
