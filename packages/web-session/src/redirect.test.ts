import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

const PREFIXES = ['/account', '/orders'];
const FALLBACK = '/account';
const ORIGIN = 'https://shop.nilzora.test';

/** Where a browser on ORIGIN would go if it followed `Location: <path>`. */
function destination(path: string): URL {
  return new URL(path, `${ORIGIN}/sign-in?next=x`);
}

function hasBackslashOrControl(value: string): boolean {
  return [...value].some((char) => char === '\\' || char.charCodeAt(0) < 0x20 || char === '\u007f');
}

describe('safeRedirectPath', () => {
  it.each([
    ['/account', '/account'],
    ['/account/profile', '/account/profile'],
    ['/orders/123?tab=items', '/orders/123?tab=items'],
    ['/account?welcome=1#section', '/account?welcome=1'],
    ['/account/./profile', '/account/profile'],
    ['/account/%2e/profile', '/account/profile'],
  ])('allows %j as %j', (value, expected) => {
    expect(safeRedirectPath(value, PREFIXES, FALLBACK)).toBe(expected);
  });

  it.each([
    ['an absolute URL', 'https://evil.com/account'],
    ['an absolute URL on this origin', `${ORIGIN}/account`],
    ['a protocol-relative URL', '//evil.com/account'],
    ['a backslash host', '/\\evil.com'],
    ['a double backslash host', '\\\\evil.com'],
    ['a backslash later in the path', '/account\\..\\..\\evil.com'],
    ['a tab-separated host', '/\t/evil.com'],
    ['a newline-separated host', '/\n/evil.com'],
    ['a carriage-return-separated host', '/\r/evil.com'],
    ['a NUL character', '/account\u0000'],
    ['a DEL character', '/account\u007f'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a relative path', 'account'],
    ['a leading space', ' /account'],
    ['a path outside the prefixes', '/login'],
    ['a path sharing a prefix', '/accountx'],
    ['a path escaping the prefix with dot segments', '/account/../login'],
    ['an encoded dot-segment escape', '/account/%2e%2e/login'],
    ['a dot segment normalising to //host', '/.//evil.com'],
    ['a parent segment normalising to //host', '/account/..//evil.com'],
    ['an encoded dot segment normalising to //host', '/%2e%2e//evil.com'],
    ['the root', '/'],
    ['an empty string', ''],
    ['an overly long value', `/account/${'a'.repeat(600)}`],
  ])('falls back for %s', (_, value) => {
    expect(safeRedirectPath(value, PREFIXES, FALLBACK)).toBe(FALLBACK);
  });

  it.each([null, undefined, 42, ['/account'], { path: '/account' }, new File([], '/account')])(
    'falls back for the non-string %j',
    (value) => {
      expect(safeRedirectPath(value, PREFIXES, FALLBACK)).toBe(FALLBACK);
    },
  );

  it('keeps encoded characters encoded, so they stay part of the path', () => {
    expect(safeRedirectPath('/account/%5Cevil.com', PREFIXES, FALLBACK)).toBe(
      '/account/%5Cevil.com',
    );
    expect(safeRedirectPath('/%5Cevil.com', PREFIXES, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath('/%2F%2Fevil.com', PREFIXES, FALLBACK)).toBe(FALLBACK);
  });

  it('never returns a path that leaves the origin, even with the widest prefix', () => {
    const attempts = [
      '//evil.com',
      '///evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '/ /evil.com',
      '/%5Cevil.com',
      '/%2F%2Fevil.com',
      '/%2f/evil.com',
      '/.//evil.com',
      '/./\\evil.com',
      '/%2e//evil.com',
      '/%2e%2e//evil.com',
      '/a/..//evil.com',
      '/a/%2e%2e//evil.com',
      '/a/../..//evil.com',
      '/.%2F/evil.com',
      '/　/evil.com',
      '/ /evil.com',
      '/@evil.com',
      '/evil.com',
      'https:evil.com',
      'https:/evil.com',
      '/javascript:alert(1)',
    ];
    for (const prefixes of [['/'], PREFIXES, ['/a', '/evil.com']]) {
      for (const attempt of attempts) {
        const result = safeRedirectPath(attempt, prefixes, FALLBACK);
        expect(result.startsWith('/'), attempt).toBe(true);
        expect(result.startsWith('//'), attempt).toBe(false);
        expect(hasBackslashOrControl(result), attempt).toBe(false);
        expect(destination(result).origin, attempt).toBe(ORIGIN);
      }
    }
  });
});
