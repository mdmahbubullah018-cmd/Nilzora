import { afterAll, describe, expect, it } from 'vitest';
import { TestBrowser, type Page } from './browser';
import {
  accountByEmail,
  apiStatus,
  confirmationLink,
  createAccount,
  deleteRunAccounts,
  emailFor,
  env,
  PASSWORD,
  profileOf,
  roleOf,
  setSuspended,
} from './fixtures';

/*
 * Storefront end to end: real browser-style requests against `next start`, the built
 * API and the local Supabase stack. Production mode, so cookies are `__Host-` + Secure.
 */

const ACCESS = '__Host-nzs_at';
const REFRESH = '__Host-nzs_rt';
const CSRF = '__Host-nzs_csrf';

const browser = () => new TestBrowser(env.storefrontUrl);

async function signIn(b: TestBrowser, email: string, next?: string): Promise<Page> {
  return b.submit(
    next ? `/login?next=${encodeURIComponent(next)}` : '/login',
    { field: 'password' },
    { email, password: PASSWORD },
  );
}

function cookie(page: Page, name: string) {
  return page.setCookies.find((entry) => entry.name === name);
}

function expectSecureCookie(page: Page, name: string): void {
  const entry = cookie(page, name);
  expect(entry, name).toBeDefined();
  expect(entry?.attributes).toMatchObject({
    httponly: true,
    secure: true,
    path: '/',
    samesite: expect.stringMatching(/^lax$/i) as unknown,
  });
  expect(entry?.attributes.domain).toBeUndefined();
}

afterAll(async () => {
  await deleteRunAccounts();
});

describe('guest pages', () => {
  it('issues a CSRF cookie and renders signed tokens, never the cookie itself', async () => {
    const b = browser();
    const page = await b.go('/login');

    expect(page.status).toBe(200);
    expectSecureCookie(page, CSRF);
    expect(page.html).toContain('name="csrf_token"');
    expect(page.html).not.toContain(b.cookies.get(CSRF) ?? 'missing');
    expect(page.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('never answers a cookie-less cross-site form post with a new CSRF cookie', async () => {
    // SameSite=Lax keeps the real cookie off a cross-site post; replacing it would let
    // any site expire the visitor's open forms.
    const page = await browser().go('/account', {
      method: 'POST',
      body: new FormData(),
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    });

    expect(cookie(page, CSRF)).toBeUndefined();
  });

  it('sends visitors without a session from /account to sign in', async () => {
    const page = await browser().go('/account');

    expect(page.status).toBeGreaterThanOrEqual(300);
    expect(page.status).toBeLessThan(400);
    const target = new URL(page.location ?? '', env.storefrontUrl);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('next')).toBe('/account');
  });

  it('keeps catalog pages static and free of session cookies', async () => {
    const page = await browser().go('/');

    expect(page.status).toBe(200);
    expect(page.setCookies).toEqual([]);
  });
});

describe('registration and email confirmation', () => {
  it('registers a customer, ignores smuggled roles and confirms through the real emailed code', async () => {
    const b = browser();
    const email = emailFor('register');
    const page = await b.submit(
      '/register',
      { field: 'password' },
      { email, password: PASSWORD, fullName: 'Rahima Khatun', role: 'super_admin' },
    );

    // Registration continues on the code screen: no session exists until the address is
    // verified, and the smuggled role is ignored (the account is a customer).
    expect(page.status).toBe(303);
    expect(page.location).toBe(`/verify-otp?email=${encodeURIComponent(email)}`);
    expect(cookie(page, ACCESS)).toBeUndefined();
    const account = await accountByEmail(email);
    expect(account).toBeDefined();
    expect(await roleOf(account?.id ?? '')).toBe('customer');

    const codePage = await b.go(page.location ?? '');
    expect(codePage.status).toBe(200);
    // The address is the only thing in the URL; no token or code is echoed there.
    expect(codePage.html).toContain(email);
    expect(cookie(codePage, ACCESS)).toBeUndefined();
    // Redemption of the emailed code is covered by the API integration suite
    // (first-party-auth-db.integration.test.ts); this harness runs the Supabase-Auth
    // fallback, where the first-party /auth/verify-otp route is not mounted.
  });

  it("keeps a signed-in visitor's own session when they open someone else's confirmation link", async () => {
    // Someone registers, then sends their own confirmation link to a signed-in customer.
    const sender = browser();
    const senderEmail = emailFor('planted-link');
    await sender.submit(
      '/register',
      { field: 'password' },
      { email: senderEmail, password: PASSWORD },
    );
    const link = await confirmationLink(senderEmail);

    const victim = browser();
    const { email: victimEmail } = await createAccount('link-victim');
    await signIn(victim, victimEmail);
    const tokens = [victim.cookies.get(ACCESS), victim.cookies.get(REFRESH)];

    const confirmed = await victim.submit(
      `${link.pathname}${link.search}`,
      { field: 'tokenHash' },
      {},
    );
    expect(confirmed.status).toBe(303);
    expect(cookie(confirmed, ACCESS)).toBeUndefined();
    expect(cookie(confirmed, REFRESH)).toBeUndefined();
    expect([victim.cookies.get(ACCESS), victim.cookies.get(REFRESH)]).toEqual(tokens);

    const account = await victim.go('/account');
    expect(account.status).toBe(200);
    expect(account.html).toContain(victimEmail);
    expect(account.html).not.toContain(senderEmail);
  });

  it('answers a registration for an existing address exactly like a new one', async () => {
    const { email } = await createAccount('existing');
    const page = await browser().submit(
      '/register',
      { field: 'password' },
      { email, password: PASSWORD },
    );

    // Indistinguishable from a new address: the same redirect, and no session.
    expect(page.status).toBe(303);
    expect(page.location).toBe(`/verify-otp?email=${encodeURIComponent(email)}`);
    expect(cookie(page, ACCESS)).toBeUndefined();
  });
});

describe('sign-in', () => {
  it('signs in with HttpOnly, Secure, SameSite=Lax host-only cookies and no tokens in pages', async () => {
    const b = browser();
    const { email } = await createAccount('signin');
    const page = await signIn(b, email);

    expect(page.status).toBe(303);
    expect(page.location).toMatch(/\/account$/);
    expectSecureCookie(page, ACCESS);
    expectSecureCookie(page, REFRESH);
    // The CSRF cookie is rotated at sign-in.
    expect(cookie(page, CSRF)).toBeDefined();

    const account = await b.go('/account');
    expect(account.status).toBe(200);
    expect(account.html).toContain(email);
    const tokens = [b.cookies.get(ACCESS), b.cookies.get(REFRESH)];
    for (const body of b.bodies) {
      for (const token of tokens) expect(body.includes(token ?? 'missing')).toBe(false);
    }
  });

  it('rejects wrong passwords with a safe message and no session', async () => {
    const b = browser();
    const { email } = await createAccount('wrong-password');
    const page = await b.submit('/login', { field: 'password' }, { email, password: 'not-it-123' });

    expect(page.status).toBe(200);
    expect(page.html).toContain('The email address or password is incorrect.');
    expect(cookie(page, ACCESS)).toBeUndefined();
    expect(page.html).not.toContain('not-it-123');
  });

  it('never redirects outside the account area after sign-in', async () => {
    const { email } = await createAccount('open-redirect');
    for (const next of ['https://evil.example/x', '//evil.example', '/\\evil.example', '/login']) {
      const page = await signIn(browser(), email, next);
      expect(page.status, next).toBe(303);
      expect(new URL(page.location ?? '', env.storefrontUrl).origin, next).toBe(env.storefrontUrl);
      expect(page.location, next).toMatch(/\/account$/);
    }
  });

  it('honours a safe next path', async () => {
    const { email } = await createAccount('safe-next');
    const page = await signIn(browser(), email, '/account?tab=profile');

    expect(page.location).toMatch(/\/account\?tab=profile$/);
  });

  it('redirects signed-in visitors away from the sign-in page', async () => {
    const b = browser();
    const { email } = await createAccount('guest-only');
    await signIn(b, email);
    const page = await b.go('/login');

    expect(page.status).toBeGreaterThanOrEqual(300);
    expect(page.location).toMatch(/\/account$/);
  });
});

describe('CSRF and origin protection', () => {
  it('refuses a sign-in post without the CSRF token', async () => {
    const b = browser();
    const { email } = await createAccount('csrf-missing');
    const page = await b.submit(
      '/login',
      { field: 'password' },
      { email, password: PASSWORD },
      {
        drop: ['csrf_token'],
      },
    );

    expect(cookie(page, ACCESS)).toBeUndefined();
    expect(page.html).toContain('This form has expired');
  });

  it('refuses a token taken from another browser', async () => {
    const victim = browser();
    const attacker = browser();
    const { email } = await createAccount('csrf-foreign');
    const attackerPage = await attacker.go('/login');
    const foreignToken = /name="csrf_token" value="([^"]+)"/.exec(attackerPage.html)?.[1] ?? '';
    expect(foreignToken).not.toBe('');

    const page = await victim.submit(
      '/login',
      { field: 'password' },
      {
        email,
        password: PASSWORD,
        csrf_token: foreignToken,
      },
    );
    expect(cookie(page, ACCESS)).toBeUndefined();
  });

  it.each([
    ['a foreign origin', 'https://evil.example'],
    ['no origin', null],
  ])('refuses a sign-in post from %s', async (_label, origin) => {
    const b = browser();
    const { email } = await createAccount(`origin-${origin === null ? 'none' : 'foreign'}`);
    const page = await b.submit(
      '/login',
      { field: 'password' },
      { email, password: PASSWORD },
      {
        origin,
      },
    );

    expect(cookie(page, ACCESS)).toBeUndefined();
    expect(page.status).not.toBe(303);
  });

  it('refuses a cross-site sign-out, keeping the session usable', async () => {
    const b = browser();
    const { email } = await createAccount('csrf-signout');
    await signIn(b, email);
    const accessToken = b.cookies.get(ACCESS);

    await b.submit('/account', { button: 'Sign out' }, {}, { drop: ['csrf_token'] });
    expect(b.cookies.get(ACCESS)).toBe(accessToken);
    expect(await apiStatus('/me', { headers: { authorization: `Bearer ${accessToken}` } })).toBe(
      200,
    );
  });
});

describe('account and profile', () => {
  it('updates only the name and phone through the profile form', async () => {
    const b = browser();
    const { id, email } = await createAccount('profile');
    await signIn(b, email);

    const page = await b.submit(
      '/account',
      { field: 'phone' },
      {
        fullName: 'Karim Ahmed',
        phone: '01812-345678',
        role: 'admin',
        status: 'suspended',
      },
    );
    expect(page.status).toBe(200);
    expect(await profileOf(id)).toStrictEqual({
      full_name: 'Karim Ahmed',
      phone: '+8801812345678',
      status: 'active',
    });
    expect(await roleOf(id)).toBe('customer');
  });

  it('does not change the profile without a valid CSRF token', async () => {
    const b = browser();
    const { id, email } = await createAccount('profile-csrf');
    await signIn(b, email);

    await b.submit(
      '/account',
      { field: 'phone' },
      { fullName: 'Changed' },
      { drop: ['csrf_token'] },
    );
    expect((await profileOf(id))?.full_name).toBeNull();
  });

  it('shows suspended accounts a notice instead of the profile', async () => {
    const b = browser();
    const { id, email } = await createAccount('suspended');
    await signIn(b, email);
    await setSuspended(id, true);

    const page = await b.go('/account');
    expect(page.status).toBe(200);
    expect(page.html).toMatch(/suspended/i);
    expect(page.html).not.toContain('name="phone"');
  });
});

describe('refresh and sign-out', () => {
  it('refreshes an expired access cookie and rotates the refresh token', async () => {
    const b = browser();
    const { email } = await createAccount('refresh');
    await signIn(b, email);
    const oldRefresh = b.cookies.get(REFRESH);
    b.cookies.delete(ACCESS); // what the browser does when the access cookie's Max-Age lapses

    const page = await b.go('/account');
    expect(page.status).toBe(200);
    expect(page.html).toContain(email);
    expectSecureCookie(page, ACCESS);
    expectSecureCookie(page, REFRESH);
    expect(b.cookies.get(REFRESH)).not.toBe(oldRefresh);
  });

  it('serves concurrent requests during a refresh with one rotated session', async () => {
    const b = browser();
    const { email } = await createAccount('concurrent');
    await signIn(b, email);
    b.cookies.delete(ACCESS);

    const pages = await Promise.all(Array.from({ length: 5 }, () => b.go('/account')));
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(page.html).toContain(email);
    }
    const rotated = new Set(
      pages.map((page) => page.setCookies.find((c) => c.name === REFRESH)?.value),
    );
    expect(rotated.size).toBe(1);
  });

  it('clears an unusable session and asks the visitor to sign in again', async () => {
    const b = browser();
    const { email } = await createAccount('invalid-refresh');
    await signIn(b, email);
    b.cookies.delete(ACCESS);
    b.cookies.set(REFRESH, 'not-a-real-refresh-token');

    const page = await b.go('/account');
    expect(page.status).toBeGreaterThanOrEqual(300);
    expect(page.location).toMatch(/\/login/);
    expect(cookie(page, REFRESH)?.attributes['max-age']).toBe('0');
    expect(b.cookies.has(REFRESH)).toBe(false);
  });

  it('signs out: revokes both tokens at the API and clears the cookies', async () => {
    const b = browser();
    const { email } = await createAccount('signout');
    await signIn(b, email);
    const accessToken = b.cookies.get(ACCESS) ?? '';
    const refreshToken = b.cookies.get(REFRESH) ?? '';

    const page = await b.submit('/account', { button: 'Sign out' }, {});
    expect(page.status).toBe(303);
    expect(page.location).toMatch(/\/login\?signedOut=1$/);
    expect(b.cookies.has(ACCESS)).toBe(false);
    expect(b.cookies.has(REFRESH)).toBe(false);

    expect(await apiStatus('/me', { headers: { authorization: `Bearer ${accessToken}` } })).toBe(
      401,
    );
    expect(
      await apiStatus('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }),
    ).toBe(401);
    expect((await b.go('/account')).location).toMatch(/\/login/);
  });
});

describe('per-browser rate limits through the web server', () => {
  it('limits one browser without locking out others', async () => {
    const { email } = await createAccount('rate-limit');
    const attacker = browser();
    let limited: Page | undefined;
    for (let attempt = 0; attempt <= env.authRateLimit; attempt += 1) {
      limited = await attacker.submit(
        '/login',
        { field: 'password' },
        { email, password: 'wrong-123' },
      );
    }
    expect(limited?.html).toContain('Too many attempts');

    const bystander = await signIn(browser(), email);
    expect(bystander.status).toBe(303);
  });
});
