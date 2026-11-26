import { authHref, parseReturnTo } from '../lib/return-to';

const ADDRESS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('parseReturnTo', () => {
  it.each([
    '/',
    '/shop',
    '/cart',
    '/orders',
    '/account',
    '/profile',
    '/payment',
    '/settings',
    '/returns',
    '/checkout',
    '/addresses',
    '/support',
    '/addresses/new',
    `/addresses/${ADDRESS_ID}`,
    `/addresses/${ADDRESS_ID.toUpperCase()}`,
    '/order/NZ100042',
    '/order/NZ123456789012',
    '/product/blue-cotton-shirt',
    '/product/mug',
  ])('accepts the app screen %s', (path) => {
    expect(parseReturnTo(path)).toBe(path);
  });

  describe('refuses open-redirect attempts', () => {
    it.each([
      ['an absolute https URL', 'https://evil.test/orders'],
      ['an absolute http URL', 'http://evil.test'],
      ['a protocol-relative URL', '//evil.test'],
      ['a protocol-relative URL behind a path', '/orders//evil.test'],
      ['a triple slash', '///evil.test'],
      ['a backslash host', '/\\evil.test'],
      ['a backslash path', '\\\\evil.test'],
      ['a slash then backslash', '/\\/evil.test'],
      ['the app scheme', 'nilzora://orders'],
      ['the app scheme with a host-like path', 'nilzora:///orders'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a data: URL', 'data:text/html,<script>1</script>'],
      ['an encoded double slash', '/%2F%2Fevil.test'],
      ['an encoded slash', '/orders%2F..%2Fadmin'],
      ['an encoded dot segment', '/%2e%2e/orders'],
      ['an encoded backslash', '/%5Cevil.test'],
      ['a userinfo host', '/@evil.test'],
      ['a colon after the slash', '/evil.test:80'],
      ['a path traversal', '/orders/../admin'],
      ['a traversal out of a product', '/product/../../sign-in'],
      ['a leading traversal', '../orders'],
      ['a dot segment', '/./orders'],
      ['a query string', '/orders?next=https://evil.test'],
      ['an empty query string', '/orders?'],
      ['a fragment', '/orders#https://evil.test'],
      ['a leading space', ' /orders'],
      ['a trailing space', '/orders '],
      ['an embedded space', '/or ders'],
      ['a newline', '/orders\n//evil.test'],
      ['a tab', '/orders\t'],
      ['a null byte', '/orders\u0000'],
      ['a DEL character', '/orders\u007f'],
      ['a Unicode space', '/orders '],
    ])('%s', (_name, value) => {
      expect(parseReturnTo(value)).toBeNull();
    });
  });

  describe('refuses anything that is not one of the app screens', () => {
    it.each([
      ['no leading slash', 'orders'],
      ['an empty string', ''],
      ['only a query', '?x=1'],
      ['sign-in, which would loop', '/sign-in'],
      ['registration, which would loop', '/register'],
      ['an unknown screen', '/admin'],
      ['a deeper unknown screen', '/orders/secret'],
      ['an unknown order number shape', '/order/1234'],
      ['a too short order number', '/order/NZ1'],
      ['a lower-case order number', '/order/nz100042'],
      ['a too long order number', '/order/NZ1234567890123'],
      ['an address id that is not a UUID', '/addresses/abc'],
      ['an upper-case product slug', '/product/Blue-Shirt'],
      ['a product slug with an underscore', '/product/blue_shirt'],
      ['a product slug with a trailing hyphen', '/product/blue-'],
      ['an upper-case route', '/ORDERS'],
      ['a trailing slash', '/orders/'],
      ['a route group name', '/(tabs)/orders'],
      ['a bare product path', '/product'],
      ['a very long path', `/product/${'a'.repeat(300)}`],
    ])('%s', (_name, value) => {
      expect(parseReturnTo(value)).toBeNull();
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { path: '/orders' }],
    ['an array (a repeated parameter)', ['/orders']],
    ['two values', ['/orders', '/cart']],
    ['a boolean', true],
  ])('refuses %s', (_name, value) => {
    expect(parseReturnTo(value)).toBeNull();
  });
});

describe('authHref', () => {
  it('carries a safe return path as a parameter', () => {
    expect(authHref('/sign-in', '/orders')).toEqual({
      pathname: '/sign-in',
      params: { returnTo: '/orders' },
    });
    expect(authHref('/register', `/addresses/${ADDRESS_ID}`)).toEqual({
      pathname: '/register',
      params: { returnTo: `/addresses/${ADDRESS_ID}` },
    });
  });

  it('is a plain route when there is no usable return path', () => {
    expect(authHref('/sign-in', undefined)).toBe('/sign-in');
    expect(authHref('/register', 'https://evil.test')).toBe('/register');
    expect(authHref('/sign-in', '/sign-in')).toBe('/sign-in');
  });
});
