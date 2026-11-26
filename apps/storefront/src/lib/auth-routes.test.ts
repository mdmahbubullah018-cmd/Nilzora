// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_PATH,
  ADDRESSES_PATH,
  addressReturnPathFrom,
  CHECKOUT_PATH,
  returnPathFrom,
} from './auth-routes';

describe('returnPathFrom', () => {
  it('keeps paths inside the account area, including their query', () => {
    expect(returnPathFrom('/account')).toBe('/account');
    expect(returnPathFrom('/account/orders?page=2')).toBe('/account/orders?page=2');
  });

  it('may return to checkout, including its query', () => {
    expect(returnPathFrom('/checkout')).toBe(CHECKOUT_PATH);
    expect(returnPathFrom('/checkout?address=0d000000-0000-4000-8000-000000000001')).toBe(
      '/checkout?address=0d000000-0000-4000-8000-000000000001',
    );
  });

  it('may return to the product page the customer signed in from', () => {
    expect(returnPathFrom('/products/clay-mug')).toBe('/products/clay-mug');
    expect(returnPathFrom('/products/clay-mug?reviews=2')).toBe('/products/clay-mug?reviews=2');
  });

  it.each([
    ['another site', 'https://evil.example/account'],
    ['another site naming checkout', 'https://evil.example/checkout'],
    ['another site naming a product', 'https://evil.example/products/clay-mug'],
    ['a protocol-relative URL to a product', '//evil.example/products/clay-mug'],
    ['a look-alike product prefix', '/products-evil'],
    ['a dot-segment escape from a product', '/products/../admin'],
    ['a protocol-relative URL', '//evil.example/account'],
    ['a protocol-relative URL to checkout', '//evil.example/checkout'],
    ['a backslash trick', '/\\evil.example/account'],
    ['a backslash inside the account area', '/account/..\\..\\admin'],
    ['a backslash inside checkout', '/checkout\\..\\admin'],
    ['a control character', '/account\n/admin'],
    ['another storefront section', '/cart'],
    ['a look-alike prefix', '/accounts-export'],
    ['a look-alike checkout prefix', '/checkout-evil'],
    ['a dot-segment escape', '/account/../admin'],
    ['a dot-segment escape from checkout', '/checkout/../admin'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a repeated parameter', ['/account', '/account']],
    ['nothing', undefined],
  ])('falls back to the account page for %s', (_, value) => {
    expect(returnPathFrom(value)).toBe(ACCOUNT_PATH);
  });
});

describe('addressReturnPathFrom', () => {
  it('returns to checkout or the address book', () => {
    expect(addressReturnPathFrom('/checkout')).toBe(CHECKOUT_PATH);
    expect(addressReturnPathFrom('/account/addresses')).toBe(ADDRESSES_PATH);
  });

  it.each([
    ['another site', 'https://evil.example/checkout'],
    ['a protocol-relative URL', '//evil.example'],
    ['a query on checkout', '/checkout?address=x'],
    ['a path below checkout', '/checkout/extra'],
    ['another account page', '/account'],
    ['a dot-segment escape', '/account/addresses/../../admin'],
    ['a trailing slash', '/checkout/'],
    ['a repeated parameter', ['/checkout', '/checkout']],
    ['nothing', undefined],
  ])('falls back to the address book for %s', (_, value) => {
    expect(addressReturnPathFrom(value)).toBe(ADDRESSES_PATH);
  });
});
