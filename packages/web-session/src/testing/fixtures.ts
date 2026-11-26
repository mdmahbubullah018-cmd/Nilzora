import type { ApiClient } from '@nilzora/api-client';
import type { AppRole, AuthSession, MeResponse, Permission } from '@nilzora/contracts';
import { vi, type Mock } from 'vitest';
import { loadWebSessionConfig, type WebApp, type WebSessionConfig } from '../config';
import type { CookieJar, CookieOptions } from '../cookies';

/** Test-only key material; never used outside unit tests. */
export const TEST_SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';
export const TEST_API_CLIENT_SECRET = 'unit-test-api-client-secret-0123456789abcdef';

export const PRODUCTION_ORIGINS: Record<WebApp, string> = {
  storefront: 'https://shop.nilzora.test',
  admin: 'https://admin.nilzora.test',
};

/** A real, validated configuration (local development or production shape). */
export function testConfig(app: WebApp = 'storefront', production = false): WebSessionConfig {
  if (!production) return loadWebSessionConfig(app, { SESSION_SECRET: TEST_SESSION_SECRET }, false);
  return loadWebSessionConfig(
    app,
    {
      NILZORA_API_URL: 'https://api.nilzora.test',
      APP_ORIGIN: PRODUCTION_ORIGINS[app],
      SESSION_SECRET: TEST_SESSION_SECRET,
      API_CLIENT_SECRET: TEST_API_CLIENT_SECRET,
    },
    true,
  );
}

/** An unsigned, JWT-shaped token. Only the `exp` claim matters to the code under test. */
export function fakeAccessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.unsigned`;
}

let issued = 0;

/** A session as the API returns it. Every call gets a distinct access token. */
export function authSession(overrides: Partial<AuthSession> = {}): AuthSession {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  issued += 1;
  return {
    accessToken: fakeAccessToken({ sub: 'user-1', exp: expiresAt, jti: `token-${issued}` }),
    refreshToken: 'refresh-token-issued-by-api',
    tokenType: 'bearer',
    expiresIn: 3600,
    expiresAt,
    ...overrides,
  };
}

export function meResponse(role: AppRole = 'customer', permissions: Permission[] = []): MeResponse {
  return {
    user: {
      id: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60',
      email: 'rahima@example.com',
      role,
      permissions,
      profile: {
        fullName: 'Rahima Khatun',
        phone: '+8801712345678',
        status: 'active',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
        // The contract defaults a missing picture to null; the fixture says so explicitly.
        avatar: null,
        googleAvatar: null,
      },
    },
  };
}

export interface CookieWrite {
  name: string;
  /** null records a deletion. */
  value: string | null;
  options: CookieOptions;
}

/** A cookie jar that records every write, standing in for Next.js `cookies()`. */
export function fakeJar(initial: Record<string, string> = {}): CookieJar & {
  values: Map<string, string>;
  writes: CookieWrite[];
} {
  const values = new Map(Object.entries(initial));
  const writes: CookieWrite[] = [];
  return {
    values,
    writes,
    get: (name) => values.get(name),
    set: (name, value, options) => {
      values.set(name, value);
      writes.push({ name, value, options });
    },
    delete: (name, options) => {
      values.delete(name);
      writes.push({ name, value: null, options });
    },
  };
}

/** One vi.fn per ApiClient method. Mapped from the interface itself, so it can never fall out of date. */
export type StubApi = {
  [K in keyof ApiClient]: ApiClient[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : never;
};

/**
 * An ApiClient whose every method fails loudly unless a test configures it.
 *
 * Methods are created lazily on first access, so a method added to `ApiClient` later needs no
 * change here: a test that does not fake it gets a rejection naming it (`not faked: <name>`),
 * and a test that does (`api.getMe.mockResolvedValue(...)`) gets a typed `vi.fn`. Only methods
 * a test (or the code under test) actually touched appear in `Object.values(api)`, which is
 * what "no API call was made" assertions iterate.
 */
export function stubApi(): StubApi {
  const mocks = new Map<string, Mock>();
  // The single cast: the proxy is the only place a partial object is presented as the full
  // interface, and every property it serves is a vi.fn typed by `StubApi` for callers.
  return new Proxy({} as Record<string, Mock>, {
    get(_target, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      let mock = mocks.get(name);
      if (!mock) {
        mock = vi.fn(() => Promise.reject(new Error(`not faked: ${name}`)));
        mocks.set(name, mock);
      }
      return mock;
    },
    has: (_target, name) => typeof name === 'string' && mocks.has(name),
    ownKeys: () => [...mocks.keys()],
    getOwnPropertyDescriptor: (_target, name) =>
      typeof name === 'string' && mocks.has(name)
        ? { configurable: true, enumerable: true, writable: true, value: mocks.get(name) }
        : undefined,
  }) as unknown as StubApi;
}

/** A promise the test resolves or rejects by hand, for ordering concurrent calls. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
