import { ApiError } from '@nilzora/api-client';
import type { AuthSession } from '@nilzora/contracts';
import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WebApp } from './config';
import { cookieNames, REFRESH_COOKIE_MAX_AGE } from './cookies';
import { syncSessionCookies } from './proxy';
import { resetRefreshFlights } from './refresh';
import { authSession, deferred, fakeAccessToken, stubApi, testConfig } from './testing/fixtures';

const NOW_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
const NOW_SECONDS = NOW_MS / 1000;
const now = () => NOW_MS;

const FRESH = fakeAccessToken({ sub: 'user-1', exp: NOW_SECONDS + 3600 });
const EXPIRED = fakeAccessToken({ sub: 'user-1', exp: NOW_SECONDS - 5 });
const NEAR_EXPIRY = fakeAccessToken({ sub: 'user-1', exp: NOW_SECONDS + 30 });

interface SetCookie {
  value: string;
  /** Lower-cased attribute names; flags map to true. */
  attributes: Map<string, string | true>;
}

function request(
  cookies: Record<string, string>,
  url = 'http://localhost:3000/account',
  method = 'GET',
  extraHeaders: Record<string, string> = {},
): NextRequest {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(url, {
    method,
    headers: header ? { ...extraHeaders, cookie: header } : extraHeaders,
  });
}

/** The Set-Cookie headers the browser receives, by cookie name. */
function setCookies(response: NextResponse): Map<string, SetCookie> {
  const result = new Map<string, SetCookie>();
  for (const line of response.headers.getSetCookie()) {
    const [pair = '', ...parts] = line.split('; ');
    const separator = pair.indexOf('=');
    const attributes = new Map<string, string | true>();
    for (const part of parts) {
      const [key = '', ...rest] = part.split('=');
      attributes.set(key.toLowerCase(), rest.length > 0 ? rest.join('=') : true);
    }
    result.set(pair.slice(0, separator), {
      value: decodeURIComponent(pair.slice(separator + 1)),
      attributes,
    });
  }
  return result;
}

/** The cookies the page and Server Actions see for this request (Next.js header override). */
function forwardedCookies(response: NextResponse): Map<string, string> {
  const overridden = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
  const raw = overridden.includes('cookie')
    ? (response.headers.get('x-middleware-request-cookie') ?? '')
    : '';
  const cookies = new Map<string, string>();
  for (const pair of raw.split('; ').filter(Boolean)) {
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
  }
  return cookies;
}

function setup(app: WebApp = 'storefront', production = false) {
  const config = testConfig(app, production);
  return { config, names: cookieNames(config), api: stubApi() };
}

function expectSessionCookieAttributes(cookie: SetCookie | undefined, production: boolean): void {
  expect(cookie).toBeDefined();
  expect(cookie?.attributes.get('httponly')).toBe(true);
  expect(cookie?.attributes.get('samesite')).toBe('lax');
  expect(cookie?.attributes.get('path')).toBe('/');
  expect(cookie?.attributes.get('secure')).toBe(production ? true : undefined);
  expect(cookie?.attributes.has('domain')).toBe(false);
}

beforeEach(() => {
  resetRefreshFlights();
});

describe('syncSessionCookies', () => {
  it('issues a CSRF cookie when missing, visible to the page rendered for this request', async () => {
    const { config, names, api } = setup();

    const response = await syncSessionCookies(request({}), config, api, now);

    const csrf = setCookies(response).get(names.csrf);
    expect(csrf?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expectSessionCookieAttributes(csrf, false);
    // A browser-session cookie: no Max-Age.
    expect(csrf?.attributes.has('max-age')).toBe(false);
    expect(forwardedCookies(response).get(names.csrf)).toBe(csrf?.value);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('issues a missing CSRF cookie on HEAD page loads too', async () => {
    const { config, names, api } = setup();

    const response = await syncSessionCookies(request({}, undefined, 'HEAD'), config, api, now);

    expect(setCookies(response).get(names.csrf)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each<[string, Record<string, string>]>([
    ['POST', { 'sec-fetch-site': 'cross-site' }],
    ['POST', { 'sec-fetch-site': 'same-site' }],
    ['POST', {}],
    ['PUT', {}],
    ['DELETE', {}],
  ])('never answers a cookie-less %s (%j) with a new CSRF cookie', async (method, headers) => {
    // SameSite=Lax keeps the real cookie off cross-site posts; replacing it would
    // let any site expire the visitor's open forms.
    const { config, api } = setup();

    const response = await syncSessionCookies(
      request({}, undefined, method, headers),
      config,
      api,
      now,
    );

    expect(response.headers.getSetCookie()).toStrictEqual([]);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('issues a missing CSRF cookie on a post the browser marks same-origin', async () => {
    // A no-JavaScript form whose cookie was lost recovers after one failed submit.
    const { config, names, api } = setup();

    const response = await syncSessionCookies(
      request({}, undefined, 'POST', { 'sec-fetch-site': 'same-origin' }),
      config,
      api,
      now,
    );

    expect(setCookies(response).get(names.csrf)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refreshes an expired session on a same-origin post without replacing its CSRF cookie', async () => {
    const { config, names, api } = setup();
    const renewed = authSession({ refreshToken: 'refresh-2' });
    api.refresh.mockResolvedValue(renewed);

    const response = await syncSessionCookies(
      request(
        { [names.csrf]: 'existing', [names.access]: EXPIRED, [names.refresh]: 'refresh-1' },
        undefined,
        'POST',
        { 'sec-fetch-site': 'same-origin' },
      ),
      config,
      api,
      now,
    );

    expect(api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-1');
    const set = setCookies(response);
    expect([...set.keys()].sort()).toStrictEqual(
      [names.access, names.expiresAt, names.refresh].sort(),
    );
    expect(forwardedCookies(response).get(names.csrf)).toBe('existing');
  });

  it('ignores session cookies cleared to empty values', async () => {
    const { config, names, api } = setup();

    const response = await syncSessionCookies(
      request({ [names.csrf]: 'existing', [names.access]: '', [names.refresh]: '' }),
      config,
      api,
      now,
    );

    expect(api.refresh).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toStrictEqual([]);
  });

  it('keeps an existing CSRF cookie and sets nothing for a signed-out visitor', async () => {
    const { config, names, api } = setup();

    const response = await syncSessionCookies(
      request({ [names.csrf]: 'existing' }),
      config,
      api,
      now,
    );

    expect(response.headers.getSetCookie()).toStrictEqual([]);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(forwardedCookies(response).get(names.csrf)).toBe('existing');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('leaves a fresh session alone', async () => {
    const { config, names, api } = setup();
    const cookies = { [names.csrf]: 'c', [names.access]: FRESH, [names.refresh]: 'refresh-1' };

    const response = await syncSessionCookies(request(cookies), config, api, now);

    expect(api.refresh).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toStrictEqual([]);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(Object.fromEntries(forwardedCookies(response))).toStrictEqual(cookies);
  });

  it.each([
    ['expired', EXPIRED],
    ['about to expire', NEAR_EXPIRY],
    ['unreadable', 'garbage'],
    ['missing', undefined],
  ])('refreshes an access token that is %s and rotates both cookies', async (_, accessToken) => {
    const { config, names, api } = setup();
    const renewed = authSession({
      accessToken: fakeAccessToken({ sub: 'user-1', exp: NOW_SECONDS + 900 }),
      refreshToken: 'refresh-2',
      expiresIn: 900,
    });
    api.refresh.mockResolvedValue(renewed);
    const cookies: Record<string, string> = { [names.csrf]: 'c', [names.refresh]: 'refresh-1' };
    if (accessToken !== undefined) cookies[names.access] = accessToken;

    const response = await syncSessionCookies(request(cookies), config, api, now);

    expect(api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-1');
    const set = setCookies(response);
    expect([...set.keys()].sort()).toStrictEqual(
      [names.access, names.expiresAt, names.refresh].sort(),
    );
    expect(set.get(names.access)?.value).toBe(renewed.accessToken);
    expect(set.get(names.access)?.attributes.get('max-age')).toBe('900');
    expect(set.get(names.expiresAt)?.value).toBe(String(renewed.expiresAt));
    expect(set.get(names.refresh)?.value).toBe('refresh-2');
    expect(set.get(names.refresh)?.attributes.get('max-age')).toBe(
      String(REFRESH_COOKIE_MAX_AGE.storefront),
    );
    expectSessionCookieAttributes(set.get(names.access), false);
    expectSessionCookieAttributes(set.get(names.refresh), false);

    const forwarded = forwardedCookies(response);
    expect(forwarded.get(names.access)).toBe(renewed.accessToken);
    expect(forwarded.get(names.refresh)).toBe('refresh-2');
    expect(forwarded.get(names.csrf)).toBe('c');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('uses Secure __Host- cookies in production', async () => {
    const { config, names, api } = setup('admin', true);
    api.refresh.mockResolvedValue(authSession({ refreshToken: 'refresh-2' }));

    const response = await syncSessionCookies(
      request({ [names.refresh]: 'refresh-1' }, 'https://admin.nilzora.test/'),
      config,
      api,
      now,
    );

    const set = setCookies(response);
    expect([...set.keys()].sort()).toStrictEqual(
      ['__Host-nza_at', '__Host-nza_csrf', '__Host-nza_exp', '__Host-nza_rt'].sort(),
    );
    for (const cookie of set.values()) expectSessionCookieAttributes(cookie, true);
    expect(set.get('__Host-nza_rt')?.attributes.get('max-age')).toBe(
      String(REFRESH_COOKIE_MAX_AGE.admin),
    );
  });

  it.each([
    ['development', false],
    ['production', true],
  ])('clears both session cookies when the refresh is refused (%s)', async (_, production) => {
    const { config, names, api } = setup('storefront', production);
    api.refresh.mockRejectedValue(new ApiError(401, 'invalid_refresh_token', 'Spent'));

    const response = await syncSessionCookies(
      request({ [names.csrf]: 'c', [names.access]: EXPIRED, [names.refresh]: 'refresh-1' }),
      config,
      api,
      now,
    );

    const set = setCookies(response);
    for (const name of [names.access, names.refresh]) {
      expect(set.get(name)?.value).toBe('');
      expect(set.get(name)?.attributes.get('max-age')).toBe('0');
      expectSessionCookieAttributes(set.get(name), production);
    }
    expect(set.has(names.csrf)).toBe(false);
    const forwarded = forwardedCookies(response);
    expect(forwarded.has(names.access)).toBe(false);
    expect(forwarded.has(names.refresh)).toBe(false);
    expect(forwarded.get(names.csrf)).toBe('c');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    ['an outage', new ApiError(503, 'auth_unavailable', 'Down')],
    ['rate limiting', new ApiError(429, 'rate_limited', 'Slow down')],
    ['a network failure', new ApiError(0, 'network_error', 'Offline')],
  ])('leaves the cookies untouched after %s', async (_, error) => {
    const { config, names, api } = setup();
    api.refresh.mockRejectedValue(error);
    const cookies = { [names.csrf]: 'c', [names.access]: EXPIRED, [names.refresh]: 'refresh-1' };

    const response = await syncSessionCookies(request(cookies), config, api, now);

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(response.headers.getSetCookie()).toStrictEqual([]);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(Object.fromEntries(forwardedCookies(response))).toStrictEqual(cookies);
  });

  it('clears an expired access token when there is no refresh cookie', async () => {
    const { config, names, api } = setup();

    const response = await syncSessionCookies(
      request({ [names.csrf]: 'c', [names.access]: EXPIRED }),
      config,
      api,
      now,
    );

    expect(api.refresh).not.toHaveBeenCalled();
    const access = setCookies(response).get(names.access);
    expect(access?.value).toBe('');
    expect(access?.attributes.get('max-age')).toBe('0');
    expectSessionCookieAttributes(access, false);
    expect(forwardedCookies(response).has(names.access)).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps cookies of the other app out of its decisions', async () => {
    const { config, api } = setup('admin');
    const storefront = cookieNames({ app: 'storefront', production: false });
    const adminNames = cookieNames(config);

    const response = await syncSessionCookies(
      request(
        { [adminNames.csrf]: 'c', [storefront.access]: EXPIRED, [storefront.refresh]: 'refresh-1' },
        'http://localhost:3001/',
      ),
      config,
      api,
      now,
    );

    expect(api.refresh).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toStrictEqual([]);
  });

  it('makes one refresh call for concurrent requests with the same refresh token', async () => {
    const { config, names, api } = setup();
    const renewed = authSession({ refreshToken: 'refresh-2' });
    const pending = deferred<AuthSession>();
    api.refresh.mockReturnValue(pending.promise);
    const cookies = { [names.csrf]: 'c', [names.access]: EXPIRED, [names.refresh]: 'refresh-1' };

    const both = Promise.all([
      syncSessionCookies(request(cookies), config, api, now),
      syncSessionCookies(
        request(cookies, 'http://localhost:3000/account/orders'),
        config,
        api,
        now,
      ),
    ]);
    pending.resolve(renewed);
    const responses = await both;

    expect(api.refresh).toHaveBeenCalledTimes(1);
    for (const response of responses) {
      expect(setCookies(response).get(names.refresh)?.value).toBe('refresh-2');
      expect(forwardedCookies(response).get(names.access)).toBe(renewed.accessToken);
    }
  });
});
