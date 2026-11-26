import { ApiError, type ApiClient } from '@nilzora/api-client';
import type { AuthSession, Permission } from '@nilzora/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  actWithAccessToken,
  completeGoogleSignIn,
  confirmEmail,
  FORM_EXPIRED,
  googleStart,
  register,
  requestPasswordReset,
  resendOtp,
  resetPassword,
  signIn,
  signOut,
  updateProfile,
  verifyOtp,
  withAccessToken,
  type ActionContext,
  type FormState,
} from './actions';
import type { WebApp } from './config';
import { cookieNames, cookieOptions, REFRESH_COOKIE_MAX_AGE } from './cookies';
import { CSRF_FIELD, csrfTokenFor, newCsrfSecret } from './csrf';
import { resetRefreshFlights } from './refresh';
import {
  authSession,
  deferred,
  fakeAccessToken,
  fakeJar,
  meResponse,
  stubApi,
  testConfig,
} from './testing/fixtures';

const PASSWORD = 'Correct-horse-42';
const UNAVAILABLE = 'Nilzora could not be reached. Please try again in a moment.';
const RATE_LIMITED = 'Too many attempts. Wait a few minutes, then try again.';
/** What a sign-up says when the mail server would not take the code (nothing was created). */
const EMAIL_UNAVAILABLE =
  'We could not send your verification email just now, so no account was created. Please try again in a few minutes.';
const CHECK_FIELDS = 'Check the highlighted fields.';
const INVALID_LINK =
  'This confirmation link is invalid, expired or already used. Try signing in, or register again to get a new link.';
/** Raw API wording that must never reach the page. */
const RAW_API_MESSAGE = 'raw upstream detail: rahima@example.com / internal';
const TOKEN_HASH = 'pkce_0123456789abcdef0123456789';

function setup(
  options: {
    app?: WebApp;
    production?: boolean;
    cookies?: (names: ReturnType<typeof cookieNames>) => Record<string, string>;
  } = {},
) {
  const config = testConfig(options.app ?? 'storefront', options.production ?? false);
  const names = cookieNames(config);
  const csrfCookie = newCsrfSecret();
  const jar = fakeJar({ [names.csrf]: csrfCookie, ...options.cookies?.(names) });
  const api = stubApi();
  const headers = new Headers({ origin: config.appOrigin, 'sec-fetch-site': 'same-origin' });
  const ctx: ActionContext = { config, jar, headers, api };
  return {
    config,
    names,
    jar,
    api,
    headers,
    ctx,
    csrfCookie,
    csrfToken: csrfTokenFor(config, csrfCookie),
  };
}
type Setup = ReturnType<typeof setup>;

/** A signed-in browser: access, refresh and CSRF cookies. */
function signedIn(options: { app?: WebApp; production?: boolean } = {}) {
  const session = authSession({ refreshToken: 'refresh-token-1' });
  const s = setup({
    ...options,
    cookies: (names) => ({
      [names.access]: session.accessToken,
      [names.refresh]: session.refreshToken,
    }),
  });
  return { ...s, session };
}

function form(fields: Record<string, string | Blob>, csrfToken?: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  if (csrfToken !== undefined) data.append(CSRF_FIELD, csrfToken);
  return data;
}

function apiError(status: number, code: string): ApiError {
  return new ApiError(status, code, RAW_API_MESSAGE, 'req-test-1');
}

function expectNoApiCalls(api: Setup['api']): void {
  for (const method of Object.values(api)) expect(method).not.toHaveBeenCalled();
}

/** Every way a forged or stale form can arrive. Each returns the token to submit. */
const UNTRUSTED_FORMS: Array<[string, (s: Setup) => string | undefined]> = [
  ['the CSRF token is missing', () => undefined],
  ['the CSRF token is wrong', () => 'A'.repeat(43)],
  ['the CSRF token belongs to another cookie', (s) => csrfTokenFor(s.config, newCsrfSecret())],
  [
    'the CSRF token was made for the other app',
    (s) => csrfTokenFor({ ...s.config, app: 'admin' }, s.csrfCookie),
  ],
  [
    'the CSRF cookie is missing',
    (s) => {
      s.jar.values.delete(s.names.csrf);
      return s.csrfToken;
    },
  ],
  [
    'the Origin header is missing',
    (s) => {
      s.headers.delete('origin');
      return s.csrfToken;
    },
  ],
  [
    'the Origin is another site',
    (s) => {
      s.headers.set('origin', 'https://evil.test');
      return s.csrfToken;
    },
  ],
  [
    'the Origin is "null"',
    (s) => {
      s.headers.set('origin', 'null');
      return s.csrfToken;
    },
  ],
  [
    'the fetch is cross-site',
    (s) => {
      s.headers.set('sec-fetch-site', 'cross-site');
      return s.csrfToken;
    },
  ],
  [
    'the fetch is same-site but not same-origin',
    (s) => {
      s.headers.set('sec-fetch-site', 'same-site');
      return s.csrfToken;
    },
  ],
];

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  resetRefreshFlights();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // Operator logs may carry codes and request ids, never credentials.
  const logged = JSON.stringify(consoleError.mock.calls);
  expect(logged).not.toContain(PASSWORD);
  expect(logged).not.toContain('refresh-token');
  expect(logged).not.toContain(RAW_API_MESSAGE);
  consoleError.mockRestore();
});

function expectNoSecrets(result: FormState, secrets: readonly string[]): void {
  const serialized = JSON.stringify(result);
  for (const secret of [PASSWORD, RAW_API_MESSAGE, ...secrets]) {
    expect(serialized).not.toContain(secret);
  }
}

describe('signIn', () => {
  const credentials = { email: ' Rahima@Example.com ', password: PASSWORD };

  it.each(UNTRUSTED_FORMS)(
    'refuses the form when %s, without calling the API',
    async (_, tamper) => {
      const s = setup();
      const token = tamper(s);

      const result = await signIn(s.ctx, form(credentials, token));

      expect(result).toStrictEqual({ ...FORM_EXPIRED, values: { email: 'Rahima@Example.com' } });
      expectNoApiCalls(s.api);
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it('refuses a CSRF field submitted as a file', async () => {
    const s = setup();
    const result = await signIn(
      s.ctx,
      form({ ...credentials, [CSRF_FIELD]: new Blob([s.csrfToken]) }),
    );

    expect(result.message).toBe(FORM_EXPIRED.message);
    expectNoApiCalls(s.api);
  });

  it.each([
    ['an invalid email', { email: 'not-an-email', password: PASSWORD }, 'email'],
    ['a missing email', { password: PASSWORD }, 'email'],
    ['a missing password', { email: 'rahima@example.com' }, 'password'],
  ])('reports %s without calling the API', async (_, fields, field) => {
    const s = setup();

    const result = await signIn(s.ctx, form(fields, s.csrfToken));

    expect(result.status).toBe('error');
    expect(result.message).toBe(CHECK_FIELDS);
    expect(result.fieldErrors?.[field]).toBeTruthy();
    expectNoApiCalls(s.api);
    expectNoSecrets(result, []);
  });

  it('asks for the password with a fixed message', async () => {
    const s = setup();
    const result = await signIn(s.ctx, form({ email: 'rahima@example.com' }, s.csrfToken));
    expect(result.fieldErrors).toStrictEqual({ password: 'Enter your password.' });
  });

  it('signs in, stores the tokens in secure cookies and rotates the CSRF cookie', async () => {
    const s = setup();
    const session = authSession({ expiresIn: 900 });
    const me = meResponse();
    s.api.login.mockResolvedValue(session);
    s.api.getMe.mockResolvedValue(me);

    const result = await signIn(s.ctx, form(credentials, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success', user: me.user });
    expect(s.api.login).toHaveBeenCalledExactlyOnceWith({
      email: 'rahima@example.com',
      password: PASSWORD,
    });
    expect(s.api.getMe).toHaveBeenCalledExactlyOnceWith(session.accessToken);
    expect(s.api.logout).not.toHaveBeenCalled();

    const base = { httpOnly: true, secure: false, sameSite: 'lax', path: '/' };
    expect(s.jar.writes).toStrictEqual([
      { name: 'nzs_at', value: session.accessToken, options: { ...base, maxAge: 900 } },
      {
        name: 'nzs_exp',
        value: String(session.expiresAt),
        options: { ...base, maxAge: 900 },
      },
      {
        name: 'nzs_rt',
        value: session.refreshToken,
        options: { ...base, maxAge: REFRESH_COOKIE_MAX_AGE.storefront },
      },
      { name: 'nzs_csrf', value: expect.any(String) as string, options: base },
    ]);
    expect(s.jar.get('nzs_csrf')).not.toBe(s.csrfCookie);
    expectNoSecrets(result, [session.accessToken, session.refreshToken]);
  });

  it('uses Secure __Host- cookies in production', async () => {
    const s = setup({ app: 'admin', production: true });
    const session = authSession();
    s.api.login.mockResolvedValue(session);
    s.api.getMe.mockResolvedValue(meResponse('staff', ['admin_workspace.access']));

    const result = await signIn(s.ctx, form(credentials, s.csrfToken), {
      requireAnyPermission: ['admin_workspace.access'],
    });

    expect(result.status).toBe('success');
    expect(s.jar.writes.map((write) => write.name)).toStrictEqual([
      '__Host-nza_at',
      '__Host-nza_exp',
      '__Host-nza_rt',
      '__Host-nza_csrf',
    ]);
    for (const write of s.jar.writes) {
      expect(write.options).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
    }
    expect(s.jar.writes[2]?.options.maxAge).toBe(REFRESH_COOKIE_MAX_AGE.admin);
  });

  it.each([
    [401, 'invalid_credentials', 'The email address or password is incorrect.'],
    [
      403,
      'email_not_confirmed',
      'Confirm your email address first. We sent a confirmation link when you registered.',
    ],
    [403, 'account_suspended', 'This account is suspended. Contact Nilzora support for help.'],
    [403, 'account_unavailable', 'This account cannot be used right now. Contact Nilzora support.'],
    [429, 'rate_limited', RATE_LIMITED],
    [400, 'validation_failed', 'Enter a valid email address and password.'],
    [503, 'auth_unavailable', UNAVAILABLE],
    [500, 'internal_error', UNAVAILABLE],
    [0, 'network_error', UNAVAILABLE],
    [0, 'timeout', UNAVAILABLE],
    [200, 'invalid_response', UNAVAILABLE],
  ])('maps a %i %s failure to a fixed message', async (status, code, message) => {
    const s = setup();
    s.api.login.mockRejectedValue(apiError(status, code));

    const result = await signIn(s.ctx, form(credentials, s.csrfToken));

    expect(result).toStrictEqual({
      status: 'error',
      message,
      values: { email: 'Rahima@Example.com' },
    });
    expect(s.jar.writes).toStrictEqual([]);
    expect(s.api.getMe).not.toHaveBeenCalled();
  });

  it('treats an unexpected error as unavailable', async () => {
    const s = setup();
    s.api.login.mockRejectedValue(new TypeError(`fetch failed for ${PASSWORD}`));

    const result = await signIn(s.ctx, form(credentials, s.csrfToken));

    expect(result.message).toBe(UNAVAILABLE);
    expect(consoleError).toHaveBeenCalledWith('[nilzora] sign-in failed unexpectedly');
  });

  it('signs the new session out again when the profile cannot be loaded', async () => {
    const s = setup();
    const session = authSession();
    s.api.login.mockResolvedValue(session);
    s.api.getMe.mockRejectedValue(apiError(503, 'service_unavailable'));
    s.api.logout.mockRejectedValue(apiError(0, 'network_error'));

    const result = await signIn(s.ctx, form(credentials, s.csrfToken));

    expect(result).toStrictEqual({
      status: 'error',
      message: UNAVAILABLE,
      values: { email: 'Rahima@Example.com' },
    });
    expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(session.accessToken);
    expect(s.jar.writes).toStrictEqual([]);
  });

  describe('with requireAnyPermission', () => {
    const workspaces: Permission[] = ['admin_workspace.access', 'moderator_workspace.access'];

    it('signs a customer straight out and stores nothing', async () => {
      const s = setup({ app: 'admin' });
      const session = authSession();
      s.api.login.mockResolvedValue(session);
      s.api.getMe.mockResolvedValue(meResponse('customer', []));
      s.api.logout.mockResolvedValue(undefined);

      const result = await signIn(s.ctx, form(credentials, s.csrfToken), {
        requireAnyPermission: workspaces,
        deniedMessage: 'This account cannot use the Nilzora workspace.',
      });

      expect(result).toStrictEqual({
        status: 'error',
        message: 'This account cannot use the Nilzora workspace.',
        values: { email: 'Rahima@Example.com' },
      });
      expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(session.accessToken);
      expect(s.jar.writes).toStrictEqual([]);
      expectNoSecrets(result, [session.accessToken, session.refreshToken]);
    });

    it('uses a neutral message by default and survives a failed logout', async () => {
      const s = setup({ app: 'admin' });
      s.api.login.mockResolvedValue(authSession());
      s.api.getMe.mockResolvedValue(meResponse('moderator', ['moderator_workspace.access']));
      s.api.logout.mockRejectedValue(apiError(503, 'auth_unavailable'));

      const result = await signIn(s.ctx, form(credentials, s.csrfToken), {
        requireAnyPermission: ['admin_workspace.access'],
      });

      expect(result.message).toBe('This account cannot sign in here.');
      expect(s.jar.writes).toStrictEqual([]);
    });

    it.each([
      ['staff', ['admin_workspace.access', 'orders.read']],
      ['moderator', ['moderator_workspace.access', 'reviews.moderate']],
    ] as const)('lets a %s with a workspace permission in', async (role, permissions) => {
      const s = setup({ app: 'admin' });
      const me = meResponse(role, [...permissions]);
      s.api.login.mockResolvedValue(authSession());
      s.api.getMe.mockResolvedValue(me);

      const result = await signIn(s.ctx, form(credentials, s.csrfToken), {
        requireAnyPermission: workspaces,
      });

      expect(result).toStrictEqual({ status: 'success', user: me.user });
      expect(s.api.logout).not.toHaveBeenCalled();
      expect(s.jar.writes).toHaveLength(4);
    });
  });
});

describe('register', () => {
  const fields = {
    email: 'New.Customer@Example.com',
    password: PASSWORD,
    fullName: '  Rahima Khatun ',
    phone: '01712345678',
  };

  it.each(UNTRUSTED_FORMS)(
    'refuses the form when %s, without calling the API',
    async (_, tamper) => {
      const s = setup();
      const token = tamper(s);

      const result = await register(s.ctx, form(fields, token));

      expect(result).toStrictEqual({
        ...FORM_EXPIRED,
        values: {
          email: 'New.Customer@Example.com',
          fullName: 'Rahima Khatun',
          phone: '01712345678',
        },
      });
      expectNoApiCalls(s.api);
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it('sends only email, password, name and phone, ignoring submitted roles and permissions', async () => {
    const s = setup();
    s.api.register.mockResolvedValue({ status: 'accepted', message: 'Accepted' });

    await register(
      s.ctx,
      form(
        {
          ...fields,
          role: 'super_admin',
          permissions: 'settings.manage',
          status: 'active',
          id: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60',
        },
        s.csrfToken,
      ),
    );

    expect(s.api.register).toHaveBeenCalledTimes(1);
    const [body] = s.api.register.mock.calls[0] ?? [];
    expect(body).toStrictEqual({
      email: 'new.customer@example.com',
      password: PASSWORD,
      fullName: 'Rahima Khatun',
      phone: '+8801712345678',
    });
  });

  it('leaves out empty optional fields', async () => {
    const s = setup();
    s.api.register.mockResolvedValue({ status: 'accepted', message: 'Accepted' });

    await register(
      s.ctx,
      form({ email: 'new@example.com', password: PASSWORD, fullName: ' ', phone: '' }, s.csrfToken),
    );

    const [body] = s.api.register.mock.calls[0] ?? [];
    expect(JSON.parse(JSON.stringify(body))).toStrictEqual({
      email: 'new@example.com',
      password: PASSWORD,
    });
  });

  it('answers new and existing addresses identically, and signs nobody in', async () => {
    const s = setup();
    // The API always answers 202; even differing wording must not reach the page.
    s.api.register
      .mockResolvedValueOnce({ status: 'accepted', message: 'Created' })
      .mockResolvedValueOnce({ status: 'accepted', message: 'Already registered' });

    const fresh = await register(s.ctx, form(fields, s.csrfToken));
    const existing = await register(s.ctx, form(fields, s.csrfToken));

    expect(fresh).toStrictEqual(existing);
    expect(fresh).toStrictEqual({
      status: 'success',
      message:
        'Check your inbox. If this address can be used for a new account, we have sent it a confirmation link.',
      values: { email: 'new.customer@example.com' },
    });
    expect(s.jar.writes).toStrictEqual([]);
    expectNoSecrets(fresh, []);
  });

  it.each([
    ['a weak password', { password: 'short' }, 'password'],
    ['an invalid email', { email: 'nope' }, 'email'],
    ['an invalid phone', { phone: '12345' }, 'phone'],
  ])('reports %s without calling the API', async (_, override, field) => {
    const s = setup();

    const result = await register(s.ctx, form({ ...fields, ...override }, s.csrfToken));

    expect(result.status).toBe('error');
    expect(result.message).toBe(CHECK_FIELDS);
    expect(Object.keys(result.fieldErrors ?? {})).toStrictEqual([field]);
    expectNoApiCalls(s.api);
    expectNoSecrets(result, []);
  });

  it('limits names with a fixed message', async () => {
    const s = setup();
    const result = await register(
      s.ctx,
      form({ ...fields, fullName: 'x'.repeat(121) }, s.csrfToken),
    );
    expect(result.fieldErrors).toStrictEqual({
      fullName: 'Enter your name in 120 characters or fewer.',
    });
  });

  it('turns weak_password into a password field error', async () => {
    const s = setup();
    s.api.register.mockRejectedValue(apiError(422, 'weak_password'));

    const result = await register(s.ctx, form(fields, s.csrfToken));

    expect(result).toMatchObject({
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: { password: 'Choose a stronger password.' },
    });
    expectNoSecrets(result, []);
  });

  it.each([
    [429, 'rate_limited', RATE_LIMITED],
    [400, 'bad_request', 'An account could not be created with these details.'],
    [400, 'validation_failed', 'An account could not be created with these details.'],
    [503, 'email_unavailable', EMAIL_UNAVAILABLE],
    [503, 'auth_unavailable', UNAVAILABLE],
    [0, 'network_error', UNAVAILABLE],
    [0, 'timeout', UNAVAILABLE],
  ])('maps a %i %s failure to a fixed message', async (status, code, message) => {
    const s = setup();
    s.api.register.mockRejectedValue(apiError(status, code));

    const result = await register(s.ctx, form(fields, s.csrfToken));

    expect(result.status).toBe('error');
    expect(result.message).toBe(message);
    expectNoSecrets(result, []);
  });
});

describe('confirmEmail', () => {
  it.each(UNTRUSTED_FORMS)(
    'refuses the form when %s, without calling the API',
    async (_, tamper) => {
      const s = setup();
      const token = tamper(s);

      await expect(
        confirmEmail(s.ctx, form({ tokenHash: TOKEN_HASH }, token)),
      ).resolves.toStrictEqual(FORM_EXPIRED);
      expectNoApiCalls(s.api);
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it.each([
    ['missing', undefined],
    ['too short', 'abc123'],
    ['too long', 'a'.repeat(257)],
    ['containing a slash', 'pkce_0123456789/abcdef01234'],
    ['containing a space', 'pkce_0123456789 abcdef01234'],
    ['a URL', 'https://evil.test/0123456789abcdef'],
  ])('rejects a token hash that is %s without calling the API', async (_, tokenHash) => {
    const s = setup();

    const result = await confirmEmail(
      s.ctx,
      form(tokenHash === undefined ? {} : { tokenHash }, s.csrfToken),
    );

    expect(result).toStrictEqual({ status: 'error', message: INVALID_LINK });
    expectNoApiCalls(s.api);
  });

  it('confirms the address without signing anyone in', async () => {
    const s = setup();
    s.api.confirmEmail.mockResolvedValue(undefined);

    const result = await confirmEmail(s.ctx, form({ tokenHash: TOKEN_HASH }, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success' });
    expect(s.api.confirmEmail).toHaveBeenCalledExactlyOnceWith(TOKEN_HASH);
    expect(s.jar.writes).toStrictEqual([]);
  });

  it("leaves a signed-in visitor's own session untouched by someone else's link", async () => {
    const s = signedIn();
    const before = { access: s.jar.get(s.names.access), refresh: s.jar.get(s.names.refresh) };
    s.api.confirmEmail.mockResolvedValue(undefined);

    const result = await confirmEmail(s.ctx, form({ tokenHash: TOKEN_HASH }, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success' });
    expect(s.jar.writes).toStrictEqual([]);
    expect(s.jar.get(s.names.access)).toBe(before.access);
    expect(s.jar.get(s.names.refresh)).toBe(before.refresh);
  });

  it.each([
    [400, 'invalid_confirmation_link', INVALID_LINK],
    [400, 'validation_failed', INVALID_LINK],
    [429, 'rate_limited', RATE_LIMITED],
    [503, 'auth_unavailable', UNAVAILABLE],
    [0, 'network_error', UNAVAILABLE],
  ])(
    'maps a %i %s failure to a fixed message and stores nothing',
    async (status, code, message) => {
      const s = setup();
      s.api.confirmEmail.mockRejectedValue(apiError(status, code));

      const result = await confirmEmail(s.ctx, form({ tokenHash: TOKEN_HASH }, s.csrfToken));

      expect(result).toStrictEqual({ status: 'error', message });
      expect(s.jar.writes).toStrictEqual([]);
    },
  );
});

describe('signOut', () => {
  it.each(UNTRUSTED_FORMS)('does not sign out when %s', async (_, tamper) => {
    const s = signedIn();
    const token = tamper(s);

    await expect(signOut(s.ctx, form({}, token))).resolves.toStrictEqual(FORM_EXPIRED);
    expectNoApiCalls(s.api);
    expect(s.jar.writes).toStrictEqual([]);
    expect(s.jar.get(s.names.access)).toBe(s.session.accessToken);
  });

  function expectSignedOut(s: ReturnType<typeof signedIn>): void {
    const options = cookieOptions(s.config);
    expect(s.jar.writes).toStrictEqual([
      { name: s.names.access, value: null, options },
      { name: s.names.expiresAt, value: null, options },
      { name: s.names.refresh, value: null, options },
      { name: s.names.csrf, value: expect.any(String) as string, options },
    ]);
    expect(s.jar.get(s.names.access)).toBeUndefined();
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
    expect(s.jar.get(s.names.csrf)).not.toBe(s.csrfCookie);
  }

  it('revokes the session with the access token and clears the cookies', async () => {
    const s = signedIn();
    s.api.logout.mockResolvedValue(undefined);

    const result = await signOut(s.ctx, form({}, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success' });
    expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(s.session.accessToken);
    expect(s.api.refresh).not.toHaveBeenCalled();
    expectSignedOut(s);
  });

  it('refreshes once when the access token has lapsed and revokes the new session', async () => {
    const s = signedIn({ production: true });
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    s.api.logout
      .mockRejectedValueOnce(apiError(401, 'invalid_token'))
      .mockResolvedValueOnce(undefined);
    s.api.refresh.mockResolvedValue(renewed);

    const result = await signOut(s.ctx, form({}, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success' });
    expect(s.api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-token-1');
    expect(s.api.logout.mock.calls).toStrictEqual([[s.session.accessToken], [renewed.accessToken]]);
    // The renewed tokens are revoked, never stored.
    expect(s.jar.writes.some((write) => write.value === renewed.refreshToken)).toBe(false);
    expectSignedOut(s);
  });

  it('refreshes when only the refresh cookie is left', async () => {
    const s = setup({ cookies: (names) => ({ [names.refresh]: 'refresh-token-1' }) });
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    s.api.refresh.mockResolvedValue(renewed);
    s.api.logout.mockResolvedValue(undefined);

    await signOut(s.ctx, form({}, s.csrfToken));

    expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(renewed.accessToken);
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
  });

  it('clears the cookies even when the API cannot be reached', async () => {
    const s = signedIn();
    s.api.logout.mockRejectedValue(apiError(0, 'network_error'));
    s.api.refresh.mockRejectedValue(apiError(0, 'network_error'));

    const result = await signOut(s.ctx, form({}, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success' });
    expectSignedOut(s);
  });

  it('does not revoke again when the refresh is refused', async () => {
    const s = signedIn();
    s.api.logout.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockRejectedValue(apiError(401, 'invalid_refresh_token'));

    await signOut(s.ctx, form({}, s.csrfToken));

    expect(s.api.logout).toHaveBeenCalledTimes(1);
    expect(s.api.refresh).toHaveBeenCalledTimes(1);
    expectSignedOut(s);
  });

  it('clears cookies without calling the API when there is no session', async () => {
    const s = setup();

    await expect(signOut(s.ctx, form({}, s.csrfToken))).resolves.toStrictEqual({
      status: 'success',
    });
    expectNoApiCalls(s.api);
    expect(s.jar.get(s.names.csrf)).not.toBe(s.csrfCookie);
  });

  it('sends no empty tokens when the proxy has already cleared the session', async () => {
    const s = setup({ cookies: (names) => ({ [names.access]: '', [names.refresh]: '' }) });

    await expect(signOut(s.ctx, form({}, s.csrfToken))).resolves.toStrictEqual({
      status: 'success',
    });
    expectNoApiCalls(s.api);
  });
});

describe('withAccessToken', () => {
  it('passes the cookie token to the call', async () => {
    const s = signedIn();
    const call = vi.fn((token: string) => Promise.resolve(`ok:${token.length}`));

    await expect(withAccessToken(s.ctx, call)).resolves.toStrictEqual({
      kind: 'ok',
      value: `ok:${s.session.accessToken.length}`,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(s.session.accessToken);
    expect(s.api.refresh).not.toHaveBeenCalled();
    expect(s.jar.writes).toStrictEqual([]);
  });

  it('lets errors other than 401 through without refreshing', async () => {
    const s = signedIn();
    const failure = apiError(500, 'internal_error');

    await expect(withAccessToken(s.ctx, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(s.api.refresh).not.toHaveBeenCalled();
    expect(s.jar.writes).toStrictEqual([]);
  });

  it('is signed out without any call when there are no session cookies', async () => {
    const s = setup();
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(withAccessToken(s.ctx, call)).resolves.toStrictEqual({ kind: 'signed_out' });
    expect(call).not.toHaveBeenCalled();
    expectNoApiCalls(s.api);
  });

  it('treats session cookies the proxy cleared (empty values) as absent', async () => {
    const s = setup({ cookies: (names) => ({ [names.access]: '', [names.refresh]: '' }) });
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(withAccessToken(s.ctx, call)).resolves.toStrictEqual({ kind: 'signed_out' });
    expect(call).not.toHaveBeenCalled();
    expectNoApiCalls(s.api);
  });

  it('refreshes first when only the refresh cookie is left', async () => {
    const s = setup({ cookies: (names) => ({ [names.refresh]: 'refresh-token-1' }) });
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    s.api.refresh.mockResolvedValue(renewed);
    const call = vi.fn((token: string) => Promise.resolve(token === renewed.accessToken));

    await expect(withAccessToken(s.ctx, call)).resolves.toStrictEqual({ kind: 'ok', value: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(s.jar.get(s.names.refresh)).toBe('refresh-token-2');
  });

  it('shares one refresh between concurrent calls with the same expired session', async () => {
    const s = signedIn();
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    const pending = deferred<AuthSession>();
    s.api.refresh.mockReturnValue(pending.promise);
    const call = (token: string) =>
      token === renewed.accessToken
        ? Promise.resolve('ok')
        : Promise.reject(apiError(401, 'invalid_token'));

    const both = Promise.all([withAccessToken(s.ctx, call), withAccessToken(s.ctx, call)]);
    await vi.waitFor(() => expect(s.api.refresh).toHaveBeenCalled());
    pending.resolve(renewed);

    await expect(both).resolves.toStrictEqual([
      { kind: 'ok', value: 'ok' },
      { kind: 'ok', value: 'ok' },
    ]);
    expect(s.api.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('updateProfile', () => {
  const saved = meResponse();

  it.each(UNTRUSTED_FORMS)(
    'refuses the form when %s, without calling the API',
    async (_, tamper) => {
      const s = signedIn();
      const token = tamper(s);

      const result = await updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, token));

      expect(result).toStrictEqual({ ...FORM_EXPIRED, values: { fullName: 'A', phone: '' } });
      expectNoApiCalls(s.api);
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it('turns empty fields into null, which clears them', async () => {
    const s = signedIn();
    const cleared = meResponse();
    cleared.user.profile.fullName = null;
    cleared.user.profile.phone = null;
    s.api.updateMe.mockResolvedValue(cleared);

    const result = await updateProfile(s.ctx, form({ fullName: '  ', phone: '' }, s.csrfToken));

    expect(s.api.updateMe).toHaveBeenCalledExactlyOnceWith(s.session.accessToken, {
      fullName: null,
      phone: null,
    });
    expect(result).toStrictEqual({
      status: 'success',
      message: 'Your profile has been saved.',
      values: { fullName: '', phone: '' },
    });
  });

  it('sends only the name and phone, normalised', async () => {
    const s = signedIn();
    s.api.updateMe.mockResolvedValue(saved);

    const result = await updateProfile(
      s.ctx,
      form(
        {
          fullName: ' Rahima Khatun ',
          phone: '017-1234-5678',
          role: 'admin',
          email: 'x@evil.test',
        },
        s.csrfToken,
      ),
    );

    expect(s.api.updateMe).toHaveBeenCalledExactlyOnceWith(s.session.accessToken, {
      fullName: 'Rahima Khatun',
      phone: '+8801712345678',
    });
    expect(result.values).toStrictEqual({ fullName: 'Rahima Khatun', phone: '+8801712345678' });
    expectNoSecrets(result, [s.session.accessToken, s.session.refreshToken]);
  });

  it('reports invalid fields without calling the API', async () => {
    const s = signedIn();

    const result = await updateProfile(
      s.ctx,
      form({ fullName: 'x'.repeat(121), phone: '12345' }, s.csrfToken),
    );

    expect(result).toMatchObject({
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: { fullName: 'Enter your name in 120 characters or fewer.' },
    });
    expect(result.fieldErrors?.phone).toBeTruthy();
    expectNoApiCalls(s.api);
  });

  it('refreshes exactly once on 401 and retries once with the new token', async () => {
    const s = signedIn();
    const renewed = authSession({
      accessToken: fakeAccessToken({ sub: 'user-1', exp: 2_000_000_000 }),
      refreshToken: 'refresh-token-2',
    });
    s.api.updateMe
      .mockRejectedValueOnce(apiError(401, 'invalid_token'))
      .mockResolvedValueOnce(saved);
    s.api.refresh.mockResolvedValue(renewed);

    const result = await updateProfile(
      s.ctx,
      form({ fullName: 'Rahima Khatun', phone: '' }, s.csrfToken),
    );

    expect(result.status).toBe('success');
    expect(s.api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-token-1');
    expect(s.api.updateMe.mock.calls.map(([token]) => token)).toStrictEqual([
      s.session.accessToken,
      renewed.accessToken,
    ]);
    expect(s.jar.get(s.names.access)).toBe(renewed.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe('refresh-token-2');
    expectNoSecrets(result, [s.session.accessToken, renewed.accessToken, 'refresh-token']);
  });

  it('clears the session when the refresh is refused', async () => {
    const s = signedIn();
    s.api.updateMe.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockRejectedValue(apiError(401, 'invalid_refresh_token'));

    const result = await updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, s.csrfToken));

    expect(result).toStrictEqual({ status: 'signed_out' });
    expect(s.api.updateMe).toHaveBeenCalledTimes(1);
    expect(s.jar.get(s.names.access)).toBeUndefined();
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
    expect(s.jar.writes.every((write) => write.value === null)).toBe(true);
  });

  it('gives up after a second 401, without refreshing again', async () => {
    const s = signedIn();
    s.api.updateMe.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockResolvedValue(authSession({ refreshToken: 'refresh-token-2' }));

    const result = await updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, s.csrfToken));

    expect(result).toStrictEqual({ status: 'signed_out' });
    expect(s.api.refresh).toHaveBeenCalledTimes(1);
    expect(s.api.updateMe).toHaveBeenCalledTimes(2);
    expect(s.jar.get(s.names.access)).toBeUndefined();
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
  });

  it('keeps the cookies when the refresh could not be decided', async () => {
    const s = signedIn();
    s.api.updateMe.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockRejectedValue(apiError(503, 'auth_unavailable'));

    const result = await updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, s.csrfToken));

    expect(result).toStrictEqual({
      status: 'error',
      message: UNAVAILABLE,
      values: { fullName: 'A', phone: '' },
    });
    expect(s.jar.writes).toStrictEqual([]);
    expect(s.jar.get(s.names.access)).toBe(s.session.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe('refresh-token-1');
  });

  it('is signed out when no session cookies remain', async () => {
    const s = setup();

    await expect(
      updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, s.csrfToken)),
    ).resolves.toStrictEqual({ status: 'signed_out' });
    expectNoApiCalls(s.api);
  });

  it.each([
    [403, 'account_suspended', 'This account is suspended, so its profile cannot be changed.'],
    [400, 'validation_failed', 'Check your name and phone number, then try again.'],
    [429, 'rate_limited', RATE_LIMITED],
    [500, 'internal_error', UNAVAILABLE],
    [0, 'timeout', UNAVAILABLE],
  ])(
    'maps a %i %s failure to a fixed message and keeps the session',
    async (status, code, message) => {
      const s = signedIn();
      s.api.updateMe.mockRejectedValue(apiError(status, code));

      const result = await updateProfile(s.ctx, form({ fullName: 'A', phone: '' }, s.csrfToken));

      expect(result).toStrictEqual({
        status: 'error',
        message,
        values: { fullName: 'A', phone: '' },
      });
      expect(s.api.refresh).not.toHaveBeenCalled();
      expect(s.jar.writes).toStrictEqual([]);
    },
  );
});

describe('actWithAccessToken', () => {
  const me = meResponse();
  const getMe = (api: ApiClient, token: string) => api.getMe(token);

  it.each(UNTRUSTED_FORMS)(
    'is untrusted when %s, without calling the API or writing cookies',
    async (_, tamper) => {
      const s = signedIn();
      const token = tamper(s);
      const call = vi.fn(() => Promise.resolve('never'));

      await expect(actWithAccessToken(s.ctx, form({}, token), call)).resolves.toStrictEqual({
        kind: 'untrusted',
      });
      expect(call).not.toHaveBeenCalled();
      expectNoApiCalls(s.api);
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it('is untrusted when the CSRF field is a file', async () => {
    const s = signedIn();
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(
      actWithAccessToken(s.ctx, form({ [CSRF_FIELD]: new Blob([s.csrfToken]) }), call),
    ).resolves.toStrictEqual({ kind: 'untrusted' });
    expect(call).not.toHaveBeenCalled();
    expectNoApiCalls(s.api);
  });

  it('is untrusted without a session too, and clears nothing', async () => {
    const s = setup();

    await expect(
      actWithAccessToken(s.ctx, form({}), () => Promise.resolve('never')),
    ).resolves.toStrictEqual({ kind: 'untrusted' });
    expect(s.jar.writes).toStrictEqual([]);
  });

  it("passes the request's client and the cookie token to the call", async () => {
    const s = signedIn();
    s.api.getMe.mockResolvedValue(me);
    const call = vi.fn(getMe);

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), call)).resolves.toStrictEqual({
      kind: 'ok',
      value: me,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(s.api, s.session.accessToken);
    expect(s.api.refresh).not.toHaveBeenCalled();
    expect(s.jar.writes).toStrictEqual([]);
  });

  it('refreshes once on 401, stores the rotated cookies and retries once', async () => {
    const s = signedIn();
    const renewed = authSession({ refreshToken: 'refresh-token-2', expiresIn: 900 });
    s.api.getMe.mockRejectedValueOnce(apiError(401, 'invalid_token')).mockResolvedValueOnce(me);
    s.api.refresh.mockResolvedValue(renewed);

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'ok',
      value: me,
    });
    expect(s.api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-token-1');
    expect(s.api.getMe.mock.calls.map(([token]) => token)).toStrictEqual([
      s.session.accessToken,
      renewed.accessToken,
    ]);
    expect(s.jar.writes).toStrictEqual([
      { name: 'nzs_at', value: renewed.accessToken, options: cookieOptions(s.config, 900) },
      {
        name: 'nzs_exp',
        value: String(renewed.expiresAt),
        options: cookieOptions(s.config, 900),
      },
      {
        name: 'nzs_rt',
        value: 'refresh-token-2',
        options: cookieOptions(s.config, REFRESH_COOKIE_MAX_AGE.storefront),
      },
    ]);
  });

  it('refreshes first when only the refresh cookie is left', async () => {
    const s = setup({ cookies: (names) => ({ [names.refresh]: 'refresh-token-1' }) });
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    s.api.refresh.mockResolvedValue(renewed);
    s.api.getMe.mockResolvedValue(me);

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'ok',
      value: me,
    });
    expect(s.api.getMe).toHaveBeenCalledExactlyOnceWith(renewed.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe('refresh-token-2');
  });

  it('clears the session when the refresh is refused', async () => {
    const s = signedIn();
    s.api.getMe.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockRejectedValue(apiError(401, 'invalid_refresh_token'));

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    expect(s.api.getMe).toHaveBeenCalledTimes(1);
    expect(s.jar.writes).toStrictEqual([
      { name: 'nzs_at', value: null, options: cookieOptions(s.config) },
      { name: 'nzs_exp', value: null, options: cookieOptions(s.config) },
      { name: 'nzs_rt', value: null, options: cookieOptions(s.config) },
    ]);
    // The CSRF cookie belongs to the browser, not the session.
    expect(s.jar.get(s.names.csrf)).toBe(s.csrfCookie);
  });

  it('gives up after a second 401, without refreshing again', async () => {
    const s = signedIn();
    s.api.getMe.mockRejectedValue(apiError(401, 'invalid_token'));
    s.api.refresh.mockResolvedValue(authSession({ refreshToken: 'refresh-token-2' }));

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    expect(s.api.refresh).toHaveBeenCalledTimes(1);
    expect(s.api.getMe).toHaveBeenCalledTimes(2);
    expect(s.jar.get(s.names.access)).toBeUndefined();
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
  });

  it.each([
    ['network failure', new ApiError(0, 'network_error', 'Could not reach the API')],
    ['outage', apiError(503, 'auth_unavailable')],
    ['rate limit', apiError(429, 'rate_limited')],
  ])(
    'is unavailable and keeps the cookies when a %s leaves the refresh undecided',
    async (_, failure) => {
      const s = signedIn();
      s.api.getMe.mockRejectedValue(apiError(401, 'invalid_token'));
      s.api.refresh.mockRejectedValue(failure);

      await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).resolves.toStrictEqual({
        kind: 'unavailable',
      });
      expect(s.api.getMe).toHaveBeenCalledTimes(1);
      expect(s.jar.writes).toStrictEqual([]);
      expect(s.jar.get(s.names.access)).toBe(s.session.accessToken);
      expect(s.jar.get(s.names.refresh)).toBe('refresh-token-1');
    },
  );

  it.each([
    ['there are no session cookies', () => ({})],
    [
      'the proxy cleared the session cookies (empty values)',
      (names: ReturnType<typeof cookieNames>) => ({ [names.access]: '', [names.refresh]: '' }),
    ],
  ])('is signed out without any API call when %s', async (_, cookies) => {
    const s = setup({ cookies });
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), call)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    expect(call).not.toHaveBeenCalled();
    expectNoApiCalls(s.api);
  });

  it.each([
    [0, 'network_error'],
    [0, 'timeout'],
    [500, 'internal_error'],
    [503, 'service_unavailable'],
    [400, 'validation_failed'],
    [403, 'account_suspended'],
    [404, 'not_found'],
    [409, 'price_changed'],
    [409, 'insufficient_stock'],
    [429, 'rate_limited'],
  ])(
    'lets a %i %s failure through to the action, without refreshing or writing cookies',
    async (status, code) => {
      const s = signedIn();
      const failure = apiError(status, code);

      await expect(
        actWithAccessToken(s.ctx, form({}, s.csrfToken), () => Promise.reject(failure)),
      ).rejects.toBe(failure);
      expect(s.api.refresh).not.toHaveBeenCalled();
      expect(s.jar.writes).toStrictEqual([]);
    },
  );

  it('lets a failure of the retried call through, keeping the rotated session', async () => {
    const s = signedIn();
    const renewed = authSession({ refreshToken: 'refresh-token-2' });
    const failure = apiError(409, 'insufficient_stock');
    s.api.getMe
      .mockRejectedValueOnce(apiError(401, 'invalid_token'))
      .mockRejectedValueOnce(failure);
    s.api.refresh.mockResolvedValue(renewed);

    await expect(actWithAccessToken(s.ctx, form({}, s.csrfToken), getMe)).rejects.toBe(failure);
    expect(s.jar.get(s.names.access)).toBe(renewed.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe('refresh-token-2');
  });
});

describe('verifyOtp', () => {
  const EMAIL = 'rahima@example.com';

  it('signs the account in once the code is accepted, storing the session', async () => {
    const s = setup();
    const session = authSession();
    s.api.verifyOtp.mockResolvedValue(session);
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    const result = await verifyOtp(s.ctx, form({ email: EMAIL, code: '123456' }, s.csrfToken));

    expect(result).toStrictEqual({ status: 'success', user: meResponse('customer').user });
    expect(s.api.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: EMAIL,
      code: '123456',
    });
    expect(s.jar.get(s.names.access)).toBe(session.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe(session.refreshToken);
    expect(s.jar.get(s.names.expiresAt)).toBe(String(session.expiresAt));
    // The CSRF secret is rotated once a session exists.
    expect(s.jar.get(s.names.csrf)).not.toBe(s.csrfCookie);
  });

  it('accepts a code typed with spaces', async () => {
    const s = setup();
    s.api.verifyOtp.mockResolvedValue(authSession());
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    await verifyOtp(s.ctx, form({ email: EMAIL, code: ' 123 456 ' }, s.csrfToken));

    expect(s.api.verifyOtp).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, code: '123456' });
  });

  it('keeps the visitor signed out when the code is refused', async () => {
    const s = setup();
    s.api.verifyOtp.mockRejectedValue(apiError(400, 'invalid_code'));

    const result = await verifyOtp(s.ctx, form({ email: EMAIL, code: '000000' }, s.csrfToken));

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { code: 'That code is not right.' },
    });
    expect(result.message).not.toContain(RAW_API_MESSAGE);
    expect(s.jar.get(s.names.access)).toBeUndefined();
  });

  it('rejects a code that is not six digits before calling the API', async () => {
    const s = setup();

    const result = await verifyOtp(s.ctx, form({ email: EMAIL, code: '12ab56' }, s.csrfToken));

    expect(result.status).toBe('error');
    expect(s.api.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(UNTRUSTED_FORMS)('does not redeem a code when %s', async (_, tamper) => {
    const s = setup();

    await expect(
      verifyOtp(s.ctx, form({ email: EMAIL, code: '123456' }, tamper(s))),
    ).resolves.toMatchObject(FORM_EXPIRED);
    expect(s.api.verifyOtp).not.toHaveBeenCalled();
  });

  it('signs a staff account out again when it lacks the app permission', async () => {
    const s = setup({ app: 'admin', production: true });
    const session = authSession();
    s.api.verifyOtp.mockResolvedValue(session);
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    const result = await verifyOtp(s.ctx, form({ email: EMAIL, code: '123456' }, s.csrfToken), {
      requireAnyPermission: ['admin_workspace.access'],
    });

    expect(result.status).toBe('error');
    expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(session.accessToken);
    expect(s.jar.get(s.names.access)).toBeUndefined();
  });

  it('reports an outage without leaking the upstream message', async () => {
    const s = setup();
    s.api.verifyOtp.mockRejectedValue(apiError(503, 'auth_unavailable'));

    const result = await verifyOtp(s.ctx, form({ email: EMAIL, code: '123456' }, s.csrfToken));

    expect(result).toMatchObject({ status: 'error', message: UNAVAILABLE });
  });
});

describe('resendOtp', () => {
  it('asks for a new code and never says whether the address exists', async () => {
    const s = setup();
    s.api.resendOtp.mockResolvedValue({ status: 'accepted', message: 'sent' });

    const result = await resendOtp(s.ctx, form({ email: 'anyone@example.com' }, s.csrfToken));

    expect(s.api.resendOtp).toHaveBeenCalledExactlyOnceWith({ email: 'anyone@example.com' });
    expect(result.status).toBe('success');
    expect(result.message).toContain('If this address needs a code');
  });

  it('explains when email delivery is not configured', async () => {
    const s = setup();
    s.api.resendOtp.mockRejectedValue(apiError(503, 'email_unavailable'));

    const result = await resendOtp(s.ctx, form({ email: 'anyone@example.com' }, s.csrfToken));

    expect(result.message).toContain('We could not send the email right now');
  });

  it('rejects an untrusted form', async () => {
    const s = setup();

    await expect(resendOtp(s.ctx, form({ email: 'a@example.com' }))).resolves.toMatchObject(
      FORM_EXPIRED,
    );
    expect(s.api.resendOtp).not.toHaveBeenCalled();
  });
});

describe('requestPasswordReset', () => {
  it('answers the same way for any address', async () => {
    const s = setup();
    s.api.forgotPassword.mockResolvedValue({ status: 'accepted', message: 'sent' });

    const result = await requestPasswordReset(
      s.ctx,
      form({ email: 'unknown@example.com' }, s.csrfToken),
    );

    expect(result.status).toBe('success');
    expect(result.message).toContain('If this address belongs to an account');
  });

  it('rejects an untrusted form', async () => {
    const s = setup();

    await expect(
      requestPasswordReset(s.ctx, form({ email: 'a@example.com' }, 'A'.repeat(43))),
    ).resolves.toMatchObject(FORM_EXPIRED);
    expect(s.api.forgotPassword).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  const FIELDS = {
    email: 'rahima@example.com',
    code: '654321',
    password: 'A-new-password-42',
  };

  it('sets the password and signs this browser out, since every session was revoked', async () => {
    const s = signedIn();
    s.api.resetPassword.mockResolvedValue(undefined);

    const result = await resetPassword(s.ctx, form(FIELDS, s.csrfToken));

    expect(s.api.resetPassword).toHaveBeenCalledExactlyOnceWith(FIELDS);
    expect(result.status).toBe('success');
    expect(s.jar.get(s.names.access)).toBeUndefined();
    expect(s.jar.get(s.names.refresh)).toBeUndefined();
    expect(s.jar.get(s.names.expiresAt)).toBeUndefined();
  });

  it('points at the code when it is refused, without revealing the raw message', async () => {
    const s = setup();
    s.api.resetPassword.mockRejectedValue(apiError(400, 'invalid_code'));

    const result = await resetPassword(s.ctx, form(FIELDS, s.csrfToken));

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { code: 'That code is not right.' },
    });
    expect(result.message).not.toContain(RAW_API_MESSAGE);
  });

  it('points at the password when the API rejects it as weak', async () => {
    const s = setup();
    s.api.resetPassword.mockRejectedValue(apiError(400, 'weak_password'));

    const result = await resetPassword(s.ctx, form(FIELDS, s.csrfToken));

    expect(result.fieldErrors?.password).toBe('Choose a stronger password.');
  });

  it('rejects a short password before calling the API', async () => {
    const s = setup();

    const result = await resetPassword(s.ctx, form({ ...FIELDS, password: 'short' }, s.csrfToken));

    expect(result.status).toBe('error');
    expect(s.api.resetPassword).not.toHaveBeenCalled();
  });

  it('rejects an untrusted form', async () => {
    const s = setup();

    await expect(resetPassword(s.ctx, form(FIELDS))).resolves.toMatchObject(FORM_EXPIRED);
    expect(s.api.resetPassword).not.toHaveBeenCalled();
  });
});

describe('googleStart', () => {
  it('returns the API authorization URL for the browser to follow', async () => {
    const s = setup();
    s.api.googleStart.mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    });

    const result = await googleStart(s.ctx, form({ next: '/checkout' }, s.csrfToken));

    expect(result).toEqual({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    expect(s.api.googleStart).toHaveBeenCalledExactlyOnceWith('/checkout');
  });

  it('refuses an untrusted form, which would otherwise send the visitor to a third party', async () => {
    const s = setup();

    await expect(googleStart(s.ctx, form({ next: '/account' }))).resolves.toMatchObject({
      ok: false,
    });
    expect(s.api.googleStart).not.toHaveBeenCalled();
  });

  it('reports an unconfigured provider without leaking the upstream message', async () => {
    const s = setup();
    s.api.googleStart.mockRejectedValue(apiError(503, 'oauth_unavailable'));

    const result = await googleStart(s.ctx, form({}, s.csrfToken));

    expect(result).toEqual({ ok: false, message: 'Google sign-in is not available right now.' });
  });
});

describe('completeGoogleSignIn', () => {
  const INPUT = { code: 'auth-code', state: 'signed.state' };

  it('relays the callback and stores the session in cookies', async () => {
    const s = setup();
    const session = authSession();
    s.api.completeGoogle.mockResolvedValue({ ...session, returnTo: '/checkout' });
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    const result = await completeGoogleSignIn(s.ctx, INPUT);

    expect(result).toEqual({ ok: true, returnTo: '/checkout' });
    expect(s.api.completeGoogle).toHaveBeenCalledExactlyOnceWith(INPUT);
    expect(s.jar.get(s.names.access)).toBe(session.accessToken);
    expect(s.jar.get(s.names.refresh)).toBe(session.refreshToken);
    expect(s.jar.get(s.names.expiresAt)).toBe(String(session.expiresAt));
    // A session now exists, so the CSRF secret is rotated.
    expect(s.jar.get(s.names.csrf)).not.toBe(s.csrfCookie);
  });

  it('forwards the iss parameter, which the API checks (RFC 9207)', async () => {
    const s = setup();
    const session = authSession();
    s.api.completeGoogle.mockResolvedValue(session);
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    await completeGoogleSignIn(s.ctx, {
      code: 'auth-code',
      state: 'signed.state',
      iss: 'https://accounts.google.com',
    });

    expect(s.api.completeGoogle).toHaveBeenCalledExactlyOnceWith({
      code: 'auth-code',
      state: 'signed.state',
      iss: 'https://accounts.google.com',
    });
  });

  it('omits iss when the callback did not carry one', async () => {
    const s = setup();
    s.api.completeGoogle.mockResolvedValue(authSession());
    s.api.getMe.mockResolvedValue(meResponse('customer'));

    await completeGoogleSignIn(s.ctx, INPUT);

    expect(s.api.completeGoogle).toHaveBeenCalledExactlyOnceWith({
      code: 'auth-code',
      state: 'signed.state',
    });
  });

  it.each([
    [{ error: 'access_denied' }, 'denied'],
    [{ code: 'a' }, 'invalid'],
    [{ state: 'b' }, 'invalid'],
  ] as const)('refuses %j with reason %s, without calling the API', async (input, reason) => {
    const s = setup();

    await expect(completeGoogleSignIn(s.ctx, input)).resolves.toEqual({ ok: false, reason });
    expect(s.api.completeGoogle).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(401, 'invalid_credentials', 'x'), 'denied'],
    [new ApiError(400, 'invalid_code', 'x'), 'invalid'],
    [new ApiError(403, 'email_not_confirmed', 'x'), 'invalid'],
    [new ApiError(403, 'account_suspended', 'x'), 'suspended'],
    [new ApiError(503, 'auth_unavailable', 'x'), 'unavailable'],
    [new ApiError(0, 'network_error', 'x'), 'unavailable'],
  ])('maps %s to reason %s and leaves no session behind', async (error, reason) => {
    const s = setup();
    s.api.completeGoogle.mockRejectedValue(error);

    const result = await completeGoogleSignIn(s.ctx, INPUT);

    expect(result).toEqual({ ok: false, reason });
    expect(s.jar.get(s.names.access)).toBeUndefined();
  });

  it('signs out again when the API cannot verify the account it just signed in', async () => {
    const s = setup();
    const session = authSession();
    s.api.completeGoogle.mockResolvedValue(session);
    s.api.getMe.mockRejectedValue(apiError(503, 'auth_unavailable'));

    const result = await completeGoogleSignIn(s.ctx, INPUT);

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(s.api.logout).toHaveBeenCalledExactlyOnceWith(session.accessToken);
    expect(s.jar.get(s.names.access)).toBeUndefined();
  });

  it('never writes tokens to the response when the account is suspended', async () => {
    const s = setup();
    const session = authSession();
    s.api.completeGoogle.mockResolvedValue(session);
    s.api.getMe.mockRejectedValue(apiError(403, 'account_suspended'));

    const result = await completeGoogleSignIn(s.ctx, INPUT);

    expect(result.ok).toBe(false);
    expect(s.api.logout).toHaveBeenCalled();
    expect(s.jar.get(s.names.access)).toBeUndefined();
  });
});
