import {
  API_V1_PREFIX,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_CLIENT_SECRET_HEADER,
  type HealthResponse,
} from '@nilzora/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_COOKIE_MAX_AGE, CART_COOKIE_MAX_LENGTH } from './cart-cookie';
import type * as ConfigModule from './config';
import {
  getApiUrl,
  getWebSessionConfig,
  loadWebSessionConfig,
  type WebApp,
  type WebSessionConfig,
} from './config';
import { cookieNames, cookieOptions, REFRESH_COOKIE_MAX_AGE, type CookieNames } from './cookies';
import { csrfTokenFor, newCsrfSecret } from './csrf';
import { ApiError, createWebSession, type ApiClient, type PublicApiClient } from './index';
import { resetRefreshFlights } from './refresh';
import {
  authSession,
  meResponse,
  TEST_API_CLIENT_SECRET,
  TEST_SESSION_SECRET,
  testConfig,
} from './testing/fixtures';

/** `next/headers` for one simulated request; each test decides what it returns. */
const next = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  cookies: vi.fn<() => Promise<FakeCookieStore>>(),
}));

vi.mock('next/headers', () => ({ headers: next.headers, cookies: next.cookies }));

/** The configuration getWebSessionConfig hands out, so tests can switch to production. */
const current = vi.hoisted(() => ({ config: undefined as WebSessionConfig | undefined }));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    getWebSessionConfig: vi.fn(() => {
      if (current.config === undefined) throw new Error('no test configuration');
      return current.config;
    }),
    getApiUrl: vi.fn(() => {
      if (current.config === undefined) throw new Error('no test configuration');
      return current.config.apiUrl;
    }),
  };
});

const BROWSER_ADDRESS = '203.0.113.9';
/** Raw API wording that must never matter to the caller's decisions. */
const RAW_API_MESSAGE = 'raw upstream detail';
const HEALTH: HealthResponse = {
  status: 'ok',
  service: 'nilzora-api',
  uptimeSeconds: 5,
  timestamp: '2026-10-24T10:00:00.000Z',
  database: { target: 'hosted', connection: 'pooler', projectRef: 'abcdefghijklmnopqrst' },
};

interface StoreWrite {
  name: string;
  value: string;
  options: unknown;
}

/**
 * Stands in for the Next.js `cookies()` store. As in Next.js, only Server Actions and
 * Route Handlers may write; while a page renders, `set` throws.
 */
interface FakeCookieStore {
  writes: StoreWrite[];
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options: unknown): void;
}

function cookieStore(initial: Record<string, string>, writable: boolean): FakeCookieStore {
  const values = new Map(Object.entries(initial));
  const writes: StoreWrite[] = [];
  return {
    writes,
    get: (name) => {
      const value = values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name, value, options) => {
      if (!writable) {
        throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      }
      values.set(name, value);
      writes.push({ name, value, options });
    },
  };
}

/** Both environments with the API client secret configured, so its absence is meaningful. */
function configFor(app: WebApp, production: boolean): WebSessionConfig {
  if (production) return testConfig(app, true);
  return loadWebSessionConfig(
    app,
    { SESSION_SECRET: TEST_SESSION_SECRET, API_CLIENT_SECRET: TEST_API_CLIENT_SECRET },
    false,
  );
}

interface Visit {
  app?: WebApp;
  production?: boolean;
  /** A Server Component render, whose cookie store refuses writes. Default: a Server Action. */
  page?: boolean;
  cookies?: (names: CookieNames) => Record<string, string>;
  headers?: Record<string, string>;
}

/** One browser request reaching the web server, with everything a browser could send. */
function visit(options: Visit = {}) {
  const config = configFor(options.app ?? 'storefront', options.production ?? false);
  current.config = config;
  const names = cookieNames(config);
  const csrfCookie = newCsrfSecret();
  const store = cookieStore(
    { [names.csrf]: csrfCookie, ...options.cookies?.(names) },
    options.page !== true,
  );
  const headers = new Headers({
    origin: config.appOrigin,
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': BROWSER_ADDRESS,
    cookie: `${names.access}=cookie-header-token`,
    authorization: 'Bearer token-chosen-by-the-browser',
    ...options.headers,
  });
  next.headers.mockResolvedValue(headers);
  next.cookies.mockResolvedValue(store);
  return {
    config,
    names,
    store,
    headers,
    csrfToken: csrfTokenFor(config, csrfCookie),
    session: createWebSession(config.app),
  };
}

const ACCESS_TOKEN = 'access-token-1';

function signedIn(options: Omit<Visit, 'cookies'> = {}) {
  return visit({
    ...options,
    cookies: (names) => ({ [names.access]: ACCESS_TOKEN, [names.refresh]: 'refresh-token-1' }),
  });
}

function form(csrfToken?: string): FormData {
  const data = new FormData();
  if (csrfToken !== undefined) data.append('csrf_token', csrfToken);
  return data;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failure(status: number, code: string): Response {
  return json(status, { error: { code, message: RAW_API_MESSAGE, requestId: 'req-test-1' } });
}

type Route = (headers: Headers) => Response;

function urlOf(input: Parameters<typeof fetch>[0] | undefined): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : (input ?? '');
}

/** The API behind global fetch, answering `METHOD /path` routes; anything else fails. */
function fakeApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(urlOf(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname.slice(API_V1_PREFIX.length)}`;
    const route = routes[key];
    if (!route) return Promise.reject(new Error(`unexpected API call: ${key}`));
    return Promise.resolve(route(new Headers(init?.headers)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof fakeApi>, call = 0) {
  const [input, init] = fetchMock.mock.calls[call] ?? [];
  return { url: urlOf(input), headers: new Headers(init?.headers) };
}

const getMe = (api: ApiClient, token: string) => api.getMe(token);

beforeEach(() => {
  resetRefreshFlights();
  next.headers.mockReset();
  next.cookies.mockReset();
  vi.mocked(getWebSessionConfig).mockClear();
  // Nothing reaches the network unless a test sets up the API.
  fakeApi({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  current.config = undefined;
});

describe('api()', () => {
  it.each([
    [false, 'http://localhost:4000'],
    [true, 'https://api.nilzora.test'],
  ])(
    'names the browser for rate limits, forwarding none of its headers (production: %s)',
    async (production, apiUrl) => {
      const s = visit({ production });
      const me = meResponse();
      const fetchMock = fakeApi({ 'GET /me': () => json(200, me) });

      const api = await s.session.api();
      await expect(api.getMe('token-from-cookie')).resolves.toStrictEqual(me);

      const request = sent(fetchMock);
      expect(request.url).toBe(`${apiUrl}/api/v1/me`);
      expect(request.headers.get(TRUSTED_CLIENT_SECRET_HEADER)).toBe(TEST_API_CLIENT_SECRET);
      expect(request.headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe(BROWSER_ADDRESS);
      expect(request.headers.get('authorization')).toBe('Bearer token-from-cookie');
      expect(request.headers.has('cookie')).toBe(false);
      expect(request.headers.has('x-forwarded-for')).toBe(false);
      expect(request.headers.has('origin')).toBe(false);
      expect(next.headers).toHaveBeenCalled();
      expect(next.cookies).not.toHaveBeenCalled();
      expect(getWebSessionConfig).toHaveBeenCalledWith('storefront');
    },
  );
});

describe('publicApi()', () => {
  it.each([false, true])(
    'carries nothing about the visitor and reads no request data (production: %s)',
    async (production) => {
      const s = visit({ production });
      next.headers.mockRejectedValue(new Error('headers() read outside a request'));
      next.cookies.mockRejectedValue(new Error('cookies() read outside a request'));
      const fetchMock = fakeApi({ 'GET /health': () => json(200, HEALTH) });

      const api = s.session.publicApi();
      await expect(api.getHealth()).resolves.toStrictEqual(HEALTH);

      const request = sent(fetchMock);
      expect(request.url).toBe(`${s.config.apiUrl}/api/v1/health`);
      for (const name of [
        TRUSTED_CLIENT_SECRET_HEADER,
        TRUSTED_CLIENT_IP_HEADER,
        'authorization',
        'cookie',
        'x-forwarded-for',
        'origin',
      ]) {
        expect(request.headers.has(name)).toBe(false);
      }
      expect(next.headers).not.toHaveBeenCalled();
      expect(next.cookies).not.toHaveBeenCalled();
    },
  );

  it('needs only the API URL, never the session configuration and its secrets', () => {
    const s = visit({ production: true });
    vi.mocked(getWebSessionConfig).mockClear();

    s.session.publicApi();

    expect(getApiUrl).toHaveBeenCalledWith('storefront');
    expect(getWebSessionConfig).not.toHaveBeenCalled();
  });

  it('offers only the public catalog reads', () => {
    const s = visit();

    expect(Object.keys(s.session.publicApi()).sort()).toEqual(
      expect.arrayContaining(['getHealth', 'getProduct', 'listCategories', 'listProducts']),
    );
    // Type-level: cart quotes, search for one visitor and personal calls are not offered.
    const api: PublicApiClient = s.session.publicApi();
    // @ts-expect-error quoteCart is not a public catalog read
    void api.quoteCart;
    // @ts-expect-error placeOrder is not a public catalog read
    void api.placeOrder;
  });

  it('sends every call through the fetch it is given, e.g. one that adds revalidation', async () => {
    const s = visit();
    const globalFetch = fakeApi({});
    const given = vi.fn<typeof fetch>(() => Promise.resolve(json(200, HEALTH)));

    await s.session.publicApi({ fetch: given }).getHealth();

    expect(given).toHaveBeenCalledTimes(1);
    expect(urlOf(given.mock.calls[0]?.[0])).toBe('http://localhost:4000/api/v1/health');
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe('read()', () => {
  it("passes the request's client and the access token, and writes no cookie", async () => {
    const s = signedIn({ page: true });
    const me = meResponse();
    const fetchMock = fakeApi({
      'GET /me': (headers) =>
        headers.get('authorization') === `Bearer ${ACCESS_TOKEN}`
          ? json(200, me)
          : failure(401, 'invalid_token'),
    });

    await expect(s.session.read(getMe)).resolves.toStrictEqual({ kind: 'ok', value: me });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The per-request client, so the API limits this browser rather than the server.
    expect(sent(fetchMock).headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe(BROWSER_ADDRESS);
    expect(s.store.writes).toStrictEqual([]);
  });

  it.each([
    ['there are no session cookies', () => ({})],
    [
      'the proxy cleared the session cookies (empty values)',
      (names: CookieNames) => ({ [names.access]: '', [names.refresh]: '' }),
    ],
  ])('is signed out without calling the API when %s', async (_, cookies) => {
    const s = visit({ page: true, cookies });
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(s.session.read(call)).resolves.toStrictEqual({ kind: 'signed_out' });
    expect(call).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is unavailable when only the refresh cookie is left, and never refreshes', async () => {
    const s = visit({ page: true, cookies: (names) => ({ [names.refresh]: 'refresh-token-1' }) });
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(s.session.read(call)).resolves.toStrictEqual({ kind: 'unavailable' });
    expect(call).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(s.store.writes).toStrictEqual([]);
  });

  it('is signed out on 401, without refreshing or clearing cookies', async () => {
    const s = signedIn({ page: true });
    const fetchMock = fakeApi({ 'GET /me': () => failure(401, 'invalid_token') });

    await expect(s.session.read(getMe)).resolves.toStrictEqual({ kind: 'signed_out' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.store.writes).toStrictEqual([]);
  });

  it.each([
    ['a server error', () => failure(500, 'internal_error')],
    ['an outage', () => failure(503, 'service_unavailable')],
    ['a gateway error without a body', () => new Response('Bad gateway', { status: 502 })],
  ])('is unavailable after %s', async (_, respond) => {
    const s = signedIn({ page: true });
    fakeApi({ 'GET /me': respond });

    await expect(s.session.read(getMe)).resolves.toStrictEqual({ kind: 'unavailable' });
    expect(s.store.writes).toStrictEqual([]);
  });

  it('is unavailable when the API cannot be reached', async () => {
    const s = signedIn({ page: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );

    await expect(s.session.read(getMe)).resolves.toStrictEqual({ kind: 'unavailable' });
  });

  it.each([
    [404, 'not_found'],
    [403, 'account_suspended'],
    [409, 'order_not_cancellable'],
    [429, 'rate_limited'],
  ])('rethrows a %i %s for the page to map', async (status, code) => {
    const s = signedIn({ page: true });
    fakeApi({ 'GET /me': () => failure(status, code) });

    const outcome = s.session.read(getMe);

    await expect(outcome).rejects.toBeInstanceOf(ApiError);
    await expect(outcome).rejects.toMatchObject({ status, code });
    expect(s.store.writes).toStrictEqual([]);
  });

  it("rethrows the call's own errors", async () => {
    const s = signedIn({ page: true });
    const problem = new Error('page bug');

    await expect(s.session.read(() => Promise.reject(problem))).rejects.toBe(problem);
  });
});

describe('act()', () => {
  const me = meResponse();

  it.each([
    ['the CSRF token is missing', (_: ReturnType<typeof signedIn>) => form()],
    ['the CSRF token is wrong', () => form('A'.repeat(43))],
    [
      'the CSRF token belongs to another cookie',
      (s: ReturnType<typeof signedIn>) => form(csrfTokenFor(s.config, newCsrfSecret())),
    ],
    [
      'the Origin is another site',
      (s: ReturnType<typeof signedIn>) => {
        s.headers.set('origin', 'https://evil.test');
        return form(s.csrfToken);
      },
    ],
    [
      'the Origin header is missing',
      (s: ReturnType<typeof signedIn>) => {
        s.headers.delete('origin');
        return form(s.csrfToken);
      },
    ],
    [
      'the fetch is cross-site',
      (s: ReturnType<typeof signedIn>) => {
        s.headers.set('sec-fetch-site', 'cross-site');
        return form(s.csrfToken);
      },
    ],
  ])('is untrusted when %s, without calling the API', async (_, tamper) => {
    const s = signedIn();
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(s.session.act(tamper(s), call)).resolves.toStrictEqual({ kind: 'untrusted' });
    expect(call).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(s.store.writes).toStrictEqual([]);
  });

  it("passes the request's client and the access token for a trusted form", async () => {
    const s = signedIn();
    const fetchMock = fakeApi({ 'GET /me': () => json(200, me) });

    await expect(s.session.act(form(s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'ok',
      value: me,
    });
    expect(sent(fetchMock).headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(sent(fetchMock).headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe(BROWSER_ADDRESS);
    expect(s.store.writes).toStrictEqual([]);
  });

  it.each([false, true])(
    'refreshes once on 401, writes the rotated cookies and retries once (production: %s)',
    async (production) => {
      const s = signedIn({ production });
      const renewed = authSession({ refreshToken: 'refresh-token-2', expiresIn: 900 });
      const fetchMock = fakeApi({
        'GET /me': (headers) =>
          headers.get('authorization') === `Bearer ${renewed.accessToken}`
            ? json(200, me)
            : failure(401, 'invalid_token'),
        'POST /auth/refresh': () => json(200, renewed),
      });

      await expect(s.session.act(form(s.csrfToken), getMe)).resolves.toStrictEqual({
        kind: 'ok',
        value: me,
      });
      expect(fetchMock.mock.calls.map((_, call) => sent(fetchMock, call).url)).toStrictEqual([
        `${s.config.apiUrl}/api/v1/me`,
        `${s.config.apiUrl}/api/v1/auth/refresh`,
        `${s.config.apiUrl}/api/v1/me`,
      ]);
      expect(s.names.access.startsWith('__Host-')).toBe(production);
      expect(s.store.writes).toStrictEqual([
        {
          name: s.names.access,
          value: renewed.accessToken,
          options: {
            httpOnly: true,
            secure: production,
            sameSite: 'lax',
            path: '/',
            maxAge: 900,
          },
        },
        {
          name: s.names.expiresAt,
          value: String(renewed.expiresAt),
          options: {
            httpOnly: true,
            secure: production,
            sameSite: 'lax',
            path: '/',
            maxAge: 900,
          },
        },
        {
          name: s.names.refresh,
          value: 'refresh-token-2',
          options: cookieOptions(s.config, REFRESH_COOKIE_MAX_AGE.storefront),
        },
      ]);
    },
  );

  it('clears the session when the refresh is refused', async () => {
    const s = signedIn();
    fakeApi({
      'GET /me': () => failure(401, 'invalid_token'),
      'POST /auth/refresh': () => failure(401, 'invalid_refresh_token'),
    });

    await expect(s.session.act(form(s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    // Deleted with their original attributes, as `__Host-` cookies require.
    expect(s.store.writes).toStrictEqual([
      { name: s.names.access, value: '', options: { ...cookieOptions(s.config), maxAge: 0 } },
      { name: s.names.expiresAt, value: '', options: { ...cookieOptions(s.config), maxAge: 0 } },
      { name: s.names.refresh, value: '', options: { ...cookieOptions(s.config), maxAge: 0 } },
    ]);
  });

  it('is unavailable and keeps the cookies when the refresh could not be decided', async () => {
    const s = signedIn();
    fakeApi({
      'GET /me': () => failure(401, 'invalid_token'),
      'POST /auth/refresh': () => failure(503, 'auth_unavailable'),
    });

    await expect(s.session.act(form(s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'unavailable',
    });
    expect(s.store.writes).toStrictEqual([]);
  });

  it.each([
    [409, 'insufficient_stock'],
    [409, 'price_changed'],
    [404, 'not_found'],
    [503, 'service_unavailable'],
  ])('lets a %i %s through for the action to map', async (status, code) => {
    const s = signedIn();
    const fetchMock = fakeApi({ 'GET /me': () => failure(status, code) });

    await expect(s.session.act(form(s.csrfToken), getMe)).rejects.toMatchObject({
      status,
      code,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.store.writes).toStrictEqual([]);
  });
});

describe('isSameOrigin()', () => {
  it('accepts a same-origin post without a CSRF token or cookie', async () => {
    const s = visit({ production: true });

    await expect(s.session.isSameOrigin()).resolves.toBe(true);
    expect(next.cookies).not.toHaveBeenCalled();
  });

  it('accepts the exact Origin from a browser that sends no Sec-Fetch-Site', async () => {
    const s = visit();
    s.headers.delete('sec-fetch-site');

    await expect(s.session.isSameOrigin()).resolves.toBe(true);
  });

  it.each([
    ['another site', { origin: 'https://evil.test' }],
    ['the "null" origin', { origin: 'null' }],
    ['the other Nilzora app', { origin: 'http://localhost:3001' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site but not same-origin fetch', { 'sec-fetch-site': 'same-site' }],
  ])('refuses %s', async (_, headers) => {
    const s = visit({ headers });

    await expect(s.session.isSameOrigin()).resolves.toBe(false);
  });

  it('refuses a post without an Origin', async () => {
    const s = visit();
    s.headers.delete('origin');

    await expect(s.session.isSameOrigin()).resolves.toBe(false);
  });

  it('refuses the development origin in production', async () => {
    const s = visit({ production: true, headers: { origin: 'http://localhost:3000' } });

    await expect(s.session.isSameOrigin()).resolves.toBe(false);
  });
});

describe('cartCookie', () => {
  const CART = '[{"productId":"3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60","quantity":1}]';

  it.each([
    [false, 'nzs_cart'],
    [true, '__Host-nzs_cart'],
  ])('stores the cart in its own cookie (production: %s)', async (production, name) => {
    const s = visit({ production });

    await s.session.cartCookie.set(CART);

    expect(s.store.writes).toStrictEqual([
      {
        name,
        value: CART,
        options: {
          httpOnly: true,
          secure: production,
          sameSite: 'lax',
          path: '/',
          maxAge: CART_COOKIE_MAX_AGE,
        },
      },
    ]);
    await expect(s.session.cartCookie.get()).resolves.toBe(CART);
    expect(next.headers).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', () => ({})],
    ['empty (cleared earlier in this request)', (names: CookieNames) => ({ [names.cart]: '' })],
  ])('reads as absent when %s', async (_, cookies) => {
    const s = visit({ page: true, cookies });

    await expect(s.session.cartCookie.get()).resolves.toBeUndefined();
  });

  it('refuses a value over the limit, writing nothing', async () => {
    const s = visit();

    await expect(
      s.session.cartCookie.set('x'.repeat(CART_COOKIE_MAX_LENGTH + 1)),
    ).rejects.toBeInstanceOf(RangeError);
    expect(s.store.writes).toStrictEqual([]);
  });

  it('clears with its original attributes and leaves the session alone', async () => {
    const s = signedIn({ production: true });
    await s.session.cartCookie.set(CART);

    await s.session.cartCookie.clear();

    expect(s.store.writes.at(-1)).toStrictEqual({
      name: '__Host-nzs_cart',
      value: '',
      options: { ...cookieOptions(s.config), maxAge: 0 },
    });
    expect(s.store.writes.map((write) => write.name)).toStrictEqual([
      '__Host-nzs_cart',
      '__Host-nzs_cart',
    ]);
    await expect(s.session.cartCookie.get()).resolves.toBeUndefined();
  });

  it('cannot be written while a page renders (only Server Actions and Route Handlers)', async () => {
    const s = visit({ page: true });

    await expect(s.session.cartCookie.set(CART)).rejects.toThrow(/Server Action/);
    await expect(s.session.cartCookie.clear()).rejects.toThrow(/Server Action/);
  });
});
