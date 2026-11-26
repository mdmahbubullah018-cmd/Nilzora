import { describe, expect, it } from 'vitest';
import {
  clearSessionCookies,
  cookieNames,
  cookieOptions,
  REFRESH_COOKIE_MAX_AGE,
  sessionTokens,
  writeSessionCookies,
} from './cookies';
import { authSession, fakeJar } from './testing/fixtures';

function allNames(config: Parameters<typeof cookieNames>[0]): string[] {
  const names = cookieNames(config);
  return [names.access, names.refresh, names.csrf, names.expiresAt, names.cart];
}

describe('cookieNames', () => {
  it('gives each app its own names, since browsers share cookies across ports', () => {
    const all = [
      ...allNames({ app: 'storefront', production: false }),
      ...allNames({ app: 'admin', production: false }),
    ];
    expect(new Set(all).size).toBe(10);
  });

  it('names the cart apart from the session cookies', () => {
    expect(cookieNames({ app: 'storefront', production: false })).toStrictEqual({
      access: 'nzs_at',
      refresh: 'nzs_rt',
      csrf: 'nzs_csrf',
      expiresAt: 'nzs_exp',
      cart: 'nzs_cart',
    });
    expect(cookieNames({ app: 'storefront', production: true }).cart).toBe('__Host-nzs_cart');
  });

  it('uses the __Host- prefix only in production', () => {
    for (const app of ['storefront', 'admin'] as const) {
      for (const name of allNames({ app, production: true })) {
        expect(name.startsWith('__Host-')).toBe(true);
      }
      for (const name of allNames({ app, production: false })) {
        expect(name.startsWith('__Host-')).toBe(false);
      }
    }
  });
});

describe('cookieOptions', () => {
  it('is HttpOnly, SameSite=Lax and host-wide, Secure only in production', () => {
    expect(cookieOptions({ production: false })).toStrictEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(cookieOptions({ production: true }, 60)).toStrictEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60,
    });
  });

  it('never sets a Domain, which __Host- cookies forbid', () => {
    expect(cookieOptions({ production: true }, 60)).not.toHaveProperty('domain');
  });
});

describe('sessionTokens', () => {
  const config = { app: 'storefront', production: false } as const;
  const names = cookieNames(config);

  it('reads both tokens', () => {
    const jar = fakeJar({ [names.access]: 'a', [names.refresh]: 'r', [names.cart]: 'c' });
    expect(sessionTokens(jar, config)).toStrictEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('reads the access expiry the API reported, since opaque tokens carry no claims', () => {
    const jar = fakeJar({ [names.access]: 'a', [names.expiresAt]: '1767225600' });
    expect(sessionTokens(jar, config)).toStrictEqual({
      accessToken: 'a',
      refreshToken: undefined,
      accessExpiresAt: 1767225600,
    });
  });

  it('ignores an expiry that is not a positive number', () => {
    const jar = fakeJar({ [names.access]: 'a', [names.expiresAt]: 'not-a-time' });
    expect(sessionTokens(jar, config)).toStrictEqual({
      accessToken: 'a',
      refreshToken: undefined,
    });
  });

  it('treats missing and empty (cleared) cookies as absent', () => {
    expect(sessionTokens(fakeJar(), config)).toStrictEqual({
      accessToken: undefined,
      refreshToken: undefined,
    });
    expect(
      sessionTokens(fakeJar({ [names.access]: '', [names.refresh]: '' }), config),
    ).toStrictEqual({ accessToken: undefined, refreshToken: undefined });
  });

  it("never reads the other app's cookies", () => {
    const admin = cookieNames({ app: 'admin', production: false });
    const jar = fakeJar({ [admin.access]: 'a', [admin.refresh]: 'r' });
    expect(sessionTokens(jar, config)).toStrictEqual({
      accessToken: undefined,
      refreshToken: undefined,
    });
  });
});

describe('writeSessionCookies', () => {
  it.each([
    ['storefront', false],
    ['admin', true],
  ] as const)('stores both tokens for the %s (production: %s)', (app, production) => {
    const jar = fakeJar();
    const session = authSession({ expiresIn: 900 });

    writeSessionCookies(jar, { app, production }, session);

    const names = cookieNames({ app, production });
    expect(jar.writes).toStrictEqual([
      {
        name: names.access,
        value: session.accessToken,
        options: cookieOptions({ production }, 900),
      },
      {
        name: names.expiresAt,
        value: String(session.expiresAt),
        options: cookieOptions({ production }, 900),
      },
      {
        name: names.refresh,
        value: session.refreshToken,
        options: cookieOptions({ production }, REFRESH_COOKIE_MAX_AGE[app]),
      },
    ]);
  });

  it('ends staff sessions sooner than customer sessions', () => {
    expect(REFRESH_COOKIE_MAX_AGE.admin).toBeLessThan(REFRESH_COOKIE_MAX_AGE.storefront);
    expect(REFRESH_COOKIE_MAX_AGE.admin).toBe(12 * 60 * 60);
    expect(REFRESH_COOKIE_MAX_AGE.storefront).toBe(30 * 24 * 60 * 60);
  });
});

describe('clearSessionCookies', () => {
  it.each([false, true])(
    'deletes both session cookies with their original attributes (production: %s)',
    (production) => {
      const config = { app: 'storefront', production } as const;
      const names = cookieNames(config);
      const jar = fakeJar({ [names.access]: 'a', [names.refresh]: 'r', [names.csrf]: 'c' });

      clearSessionCookies(jar, config);

      expect(jar.writes).toStrictEqual([
        { name: names.access, value: null, options: cookieOptions(config) },
        { name: names.expiresAt, value: null, options: cookieOptions(config) },
        { name: names.refresh, value: null, options: cookieOptions(config) },
      ]);
      // The CSRF cookie is not part of the session.
      expect(jar.get(names.csrf)).toBe('c');
    },
  );
});
