import { describe, expect, it } from 'vitest';
import {
  CART_COOKIE_MAX_AGE,
  CART_COOKIE_MAX_LENGTH,
  cartCookieValueFits,
  clearCartCookie,
  readCartCookie,
  writeCartCookie,
} from './cart-cookie';
import type { WebApp } from './config';
import { cookieNames } from './cookies';
import { fakeJar } from './testing/fixtures';

const CART = '[{"productId":"3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60","quantity":2}]';
/** Characters URL-encoding leaves alone, so length as sent equals length. */
const UNRESERVED = 'Aa0-_.!~*()';

function unreserved(length: number): string {
  return UNRESERVED.repeat(Math.ceil(length / UNRESERVED.length)).slice(0, length);
}

const APPS: Array<[WebApp, boolean, string]> = [
  ['storefront', false, 'nzs_cart'],
  ['storefront', true, '__Host-nzs_cart'],
  ['admin', false, 'nza_cart'],
  ['admin', true, '__Host-nza_cart'],
];

describe('cart cookie', () => {
  it.each(APPS)(
    'is stored for the %s (production: %s) as %s, apart from the session cookies',
    (app, production, name) => {
      const config = { app, production };
      const names = cookieNames(config);
      expect(names.cart).toBe(name);
      expect([names.access, names.refresh, names.csrf]).not.toContain(name);
    },
  );

  it('keeps an untouched cart for 30 days', () => {
    expect(CART_COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });

  it('is HttpOnly, SameSite=Lax and host-wide, not Secure in development', () => {
    const jar = fakeJar();

    writeCartCookie(jar, { app: 'storefront', production: false }, CART);

    expect(jar.writes).toStrictEqual([
      {
        name: 'nzs_cart',
        value: CART,
        options: {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: CART_COOKIE_MAX_AGE,
        },
      },
    ]);
  });

  it('is a Secure __Host- cookie in production, with no Domain', () => {
    const jar = fakeJar();

    writeCartCookie(jar, { app: 'storefront', production: true }, CART);

    expect(jar.writes).toStrictEqual([
      {
        name: '__Host-nzs_cart',
        value: CART,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: CART_COOKIE_MAX_AGE,
        },
      },
    ]);
    expect(jar.writes[0]?.options).not.toHaveProperty('domain');
  });

  it('reads back what it stored', () => {
    const config = { app: 'storefront', production: false } as const;
    const jar = fakeJar();

    writeCartCookie(jar, config, CART);

    expect(readCartCookie(jar, config)).toBe(CART);
  });

  it('accepts a value of exactly the limit', () => {
    const jar = fakeJar();
    const value = unreserved(CART_COOKIE_MAX_LENGTH);

    writeCartCookie(jar, { app: 'storefront', production: false }, value);

    expect(jar.get('nzs_cart')).toBe(value);
  });

  it.each([
    ['one character over the limit', unreserved(CART_COOKIE_MAX_LENGTH + 1)],
    // 1,001 characters, but 3,003 once URL-encoded (each `{` becomes %7B).
    ['short but long once URL-encoded', '{'.repeat(1001)],
    // 334 Bangla letters encode to 9 characters each.
    ['short non-ASCII text that encodes long', 'ক'.repeat(334)],
    ['not encodable at all (an unpaired surrogate)', 'cart\ud800'],
  ])('refuses a value that is %s, writing nothing', (_, value) => {
    const config = { app: 'storefront', production: false } as const;
    const jar = fakeJar({ nzs_cart: CART });

    expect(() => writeCartCookie(jar, config, value)).toThrow(RangeError);
    expect(jar.writes).toStrictEqual([]);
    expect(readCartCookie(jar, config)).toBe(CART);
  });

  it('never puts the refused value in the error message', () => {
    const value = `private-cart-${'x'.repeat(CART_COOKIE_MAX_LENGTH)}`;
    let message = '';
    try {
      writeCartCookie(fakeJar(), { app: 'storefront', production: false }, value);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(`at most ${CART_COOKIE_MAX_LENGTH} characters`);
    expect(message).not.toContain('private-cart');
  });

  it.each([false, true])(
    'clears with the original attributes (production: %s), leaving the session alone',
    (production) => {
      const config = { app: 'storefront', production } as const;
      const names = cookieNames(config);
      const jar = fakeJar({ [names.cart]: CART, [names.access]: 'a', [names.refresh]: 'r' });

      clearCartCookie(jar, config);

      expect(jar.writes).toStrictEqual([
        {
          name: names.cart,
          value: null,
          options: { httpOnly: true, secure: production, sameSite: 'lax', path: '/' },
        },
      ]);
      expect(jar.get(names.access)).toBe('a');
      expect(jar.get(names.refresh)).toBe('r');
    },
  );

  it('clears the cookie when asked to store an empty value', () => {
    const config = { app: 'storefront', production: false } as const;
    const jar = fakeJar({ nzs_cart: CART });

    writeCartCookie(jar, config, '');

    expect(jar.writes).toStrictEqual([
      {
        name: 'nzs_cart',
        value: null,
        options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      },
    ]);
    expect(readCartCookie(jar, config)).toBeUndefined();
  });

  it.each([
    ['missing', {}],
    ['empty (cleared earlier in this request)', { nzs_cart: '' }],
    ['longer than this server ever writes', { nzs_cart: 'x'.repeat(CART_COOKIE_MAX_LENGTH + 1) }],
    ["the other app's", { nza_cart: CART }],
  ])('reads as absent when %s', (_, cookies) => {
    expect(
      readCartCookie(fakeJar(cookies), { app: 'storefront', production: false }),
    ).toBeUndefined();
  });

  it('never reads the development name in production', () => {
    expect(
      readCartCookie(fakeJar({ nzs_cart: CART }), { app: 'storefront', production: true }),
    ).toBeUndefined();
    expect(
      readCartCookie(fakeJar({ '__Host-nzs_cart': CART }), {
        app: 'storefront',
        production: true,
      }),
    ).toBe(CART);
  });
});

describe('cartCookieValueFits', () => {
  it.each([
    ['an empty value', '', true],
    ['a small cart', CART, true],
    ['exactly the limit', unreserved(CART_COOKIE_MAX_LENGTH), true],
    ['one over the limit', unreserved(CART_COOKIE_MAX_LENGTH + 1), false],
    ['a value that URL-encoding pushes over the limit', '"'.repeat(1001), false],
    ['an unpaired surrogate', '\udc00', false],
  ])('answers for %s', (_, value, fits) => {
    expect(cartCookieValueFits(value)).toBe(fits);
  });
});
