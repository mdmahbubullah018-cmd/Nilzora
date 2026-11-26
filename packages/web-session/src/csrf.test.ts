import { describe, expect, it } from 'vitest';
import { cookieNames, cookieOptions } from './cookies';
import {
  csrfTokenFor,
  isSameOriginRequest,
  newCsrfSecret,
  rotateCsrfCookie,
  verifyCsrfToken,
} from './csrf';
import { fakeJar, testConfig } from './testing/fixtures';

const config = testConfig('storefront');
const cookieValue = newCsrfSecret();
const token = csrfTokenFor(config, cookieValue);

describe('newCsrfSecret', () => {
  it('returns 32 random bytes as base64url', () => {
    const value = newCsrfSecret();
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCsrfSecret()).not.toBe(value);
  });
});

describe('verifyCsrfToken', () => {
  it('accepts the token derived from the same cookie, app and secret', () => {
    expect(verifyCsrfToken(config, cookieValue, token)).toBe(true);
    expect(verifyCsrfToken(testConfig('storefront'), cookieValue, token)).toBe(true);
  });

  it('does not reveal the cookie value in the token', () => {
    expect(token).not.toContain(cookieValue);
  });

  it('rejects a token made for another cookie value', () => {
    expect(verifyCsrfToken(config, newCsrfSecret(), token)).toBe(false);
  });

  it('rejects a token made for the other app', () => {
    const adminToken = csrfTokenFor({ ...config, app: 'admin' }, cookieValue);
    expect(adminToken).not.toBe(token);
    expect(verifyCsrfToken(config, cookieValue, adminToken)).toBe(false);
  });

  it('rejects a token made with another secret', () => {
    const otherSecret = { ...config, sessionSecret: Buffer.alloc(32, 7) };
    expect(verifyCsrfToken(otherSecret, cookieValue, token)).toBe(false);
    expect(verifyCsrfToken(config, cookieValue, csrfTokenFor(otherSecret, cookieValue))).toBe(
      false,
    );
  });

  it.each([undefined, ''])('rejects any token when the cookie is %j', (missing) => {
    expect(verifyCsrfToken(config, missing, token)).toBe(false);
    expect(verifyCsrfToken(config, missing, csrfTokenFor(config, ''))).toBe(false);
  });

  it.each([
    ['missing', null],
    ['undefined', undefined],
    ['empty', ''],
    ['a number', 12345],
    ['an array', [token]],
    ['a file', new File([token], 'csrf.txt')],
    ['truncated', token.slice(0, -1)],
    ['extended', `${token}A`],
    ['oversized', `${token}${'A'.repeat(200)}`],
    ['the cookie value itself', cookieValue],
  ])('rejects a token that is %s', (_, submitted) => {
    expect(verifyCsrfToken(config, cookieValue, submitted)).toBe(false);
  });

  it('rejects, without throwing, a token of equal length but different byte length', () => {
    // Same number of characters, one more byte: the length check must run on bytes.
    const multiByte = `${token.slice(0, -1)}é`;
    expect(multiByte).toHaveLength(token.length);
    expect(() => verifyCsrfToken(config, cookieValue, multiByte)).not.toThrow();
    expect(verifyCsrfToken(config, cookieValue, multiByte)).toBe(false);
  });

  it('rejects a token that differs in its last character', () => {
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyCsrfToken(config, cookieValue, `${token.slice(0, -1)}${last}`)).toBe(false);
  });
});

describe('isSameOriginRequest', () => {
  const origin = config.appOrigin;

  it('accepts the exact app origin', () => {
    expect(isSameOriginRequest(new Headers({ origin }), config)).toBe(true);
    expect(
      isSameOriginRequest(new Headers({ origin, 'sec-fetch-site': 'same-origin' }), config),
    ).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['the string "null"', 'null'],
    ['another port', 'http://localhost:3001'],
    ['another scheme', 'https://localhost:3000'],
    ['another host', 'http://127.0.0.1:3000'],
    ['a subdomain', 'http://evil.localhost:3000'],
    ['a trailing slash', 'http://localhost:3000/'],
    ['a prefix match', 'http://localhost:30000'],
    ['empty', ''],
  ])('rejects an Origin that is %s', (_, value) => {
    const headers = new Headers({ 'sec-fetch-site': 'same-origin' });
    if (value !== undefined) headers.set('origin', value);
    expect(isSameOriginRequest(headers, config)).toBe(false);
  });

  it.each(['same-site', 'cross-site', 'none', ''])(
    'rejects Sec-Fetch-Site %j even with the right Origin',
    (fetchSite) => {
      expect(
        isSameOriginRequest(new Headers({ origin, 'sec-fetch-site': fetchSite }), config),
      ).toBe(false);
    },
  );

  it('compares against the production origin in production', () => {
    const production = testConfig('admin', true);
    expect(isSameOriginRequest(new Headers({ origin: production.appOrigin }), production)).toBe(
      true,
    );
    expect(
      isSameOriginRequest(new Headers({ origin: 'http://admin.nilzora.test' }), production),
    ).toBe(false);
  });
});

describe('rotateCsrfCookie', () => {
  it.each([false, true])('writes a fresh value each time (production: %s)', (production) => {
    const rotating = testConfig('admin', production);
    const name = cookieNames(rotating).csrf;
    const jar = fakeJar({ [name]: cookieValue });

    const first = rotateCsrfCookie(jar, rotating);
    const second = rotateCsrfCookie(jar, rotating);

    expect(first).not.toBe(cookieValue);
    expect(second).not.toBe(first);
    expect(jar.get(name)).toBe(second);
    expect(jar.writes).toStrictEqual([
      { name, value: first, options: cookieOptions(rotating) },
      { name, value: second, options: cookieOptions(rotating) },
    ]);
    // Tokens rendered for the old cookie stop working.
    expect(verifyCsrfToken(rotating, second, csrfTokenFor(rotating, cookieValue))).toBe(false);
  });
});
