import { ApiError } from '@nilzora/api-client';
import type { MeResponse } from '@nilzora/contracts';
import {
  createSessionManager,
  MESSAGES,
  REFRESH_MARGIN_SECONDS,
  SessionEndedError,
  type RegisterInput,
  type SessionManager,
} from '../auth/session-manager';
import { resetGoogleIdTokenProvider, registerGoogleIdTokenProvider } from '../auth/google-signin';
import { SessionReadError, type StoredSession } from '../auth/token-store';
import {
  apiErrors,
  createFakeApi,
  createMemoryStore,
  CUSTOMER,
  fakeAuthSession,
  fakeStoredSession,
  TOKEN_MARKER,
} from '../test-utils/session-fakes';

const START = Date.UTC(2026, 9, 23, 12, 0, 0);

let clock: number;
let log: string[];
let warn: jest.SpyInstance;

beforeEach(() => {
  clock = START;
  log = [];
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  // Whatever happened in the test, nothing logged may contain a token.
  expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN_MARKER);
  warn.mockRestore();
});

function setup(saved: StoredSession | null = null) {
  const api = createFakeApi();
  const memory = createMemoryStore(saved, log);
  const manager = createSessionManager({ api, store: memory.store, now: () => clock });
  // Record which access token each GET /me used, in order with the store writes.
  api.getMe.mockImplementation((accessToken: string) => {
    log.push(`getMe ${accessToken}`);
    return Promise.resolve(CUSTOMER);
  });
  return { api, manager, ...memory };
}

function expectNoTokens(manager: SessionManager, ...values: unknown[]) {
  expect(JSON.stringify([manager.getState(), ...values])).not.toContain(TOKEN_MARKER);
}

describe('restore', () => {
  it('starts signed out when nothing is saved, without calling the API', async () => {
    const { api, manager } = setup();
    expect(manager.getState()).toEqual({ status: 'restoring' });

    await manager.restore();

    expect(manager.getState()).toEqual({ status: 'signed_out' });
    expect(api.getMe).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('signs in with valid saved tokens after checking them with GET /me', async () => {
    const saved = fakeStoredSession(1, START);
    const { api, manager } = setup(saved);

    await manager.restore();

    expect(api.getMe).toHaveBeenCalledWith(saved.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
    expectNoTokens(manager);
  });

  it('shares one run between concurrent restore calls', async () => {
    const { api, manager } = setup(fakeStoredSession(1, START));

    await Promise.all([manager.restore(), manager.restore()]);

    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('refreshes an access token that expires within the margin, persisting the new pair before using it', async () => {
    const saved = fakeStoredSession(1, START, REFRESH_MARGIN_SECONDS - 1);
    const { api, manager, saved: current } = setup(saved);
    const rotated = fakeAuthSession(2, START);
    api.refresh.mockResolvedValue(rotated);

    await manager.restore();

    expect(api.refresh).toHaveBeenCalledWith(saved.refreshToken);
    expect(log).toEqual([`save ${rotated.accessToken}`, `getMe ${rotated.accessToken}`]);
    expect(current()).toEqual({
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresAt: Math.floor(START / 1000) + rotated.expiresIn,
    });
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
  });

  it('clears the store and signs out when the refresh token is refused', async () => {
    const { api, manager, store, saved } = setup(fakeStoredSession(1, START, 10));
    api.refresh.mockRejectedValue(apiErrors.invalidRefresh());

    await manager.restore();

    expect(store.clear).toHaveBeenCalled();
    expect(saved()).toBeNull();
    expect(api.getMe).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: 'signed_out', notice: MESSAGES.sessionEnded });
  });

  it('signs out when GET /me refuses the token and the refresh is refused too', async () => {
    const stored = fakeStoredSession(1, START);
    const { api, manager, saved } = setup(stored);
    api.getMe.mockRejectedValue(apiErrors.unauthenticated());
    api.refresh.mockRejectedValue(apiErrors.invalidRefresh());

    await manager.restore();

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(saved()).toBeNull();
    expect(manager.getState().status).toBe('signed_out');
  });

  it('goes offline and keeps the tokens when the API cannot be reached, then recovers on retry', async () => {
    const stored = fakeStoredSession(1, START);
    const { api, manager, store, saved } = setup(stored);
    api.getMe.mockRejectedValueOnce(apiErrors.network());

    await manager.restore();

    expect(manager.getState()).toEqual({ status: 'offline' });
    expect(store.clear).not.toHaveBeenCalled();
    expect(saved()).toEqual(stored);

    await manager.restore();
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
  });

  it('goes offline, keeping the saved session, when the store cannot be read, then signs in on retry', async () => {
    const stored = fakeStoredSession(1, START);
    const { api, manager, store, saved } = setup(stored);
    store.load.mockRejectedValueOnce(new SessionReadError());

    await manager.restore();

    expect(manager.getState()).toEqual({ status: 'offline' });
    expect(store.clear).not.toHaveBeenCalled();
    expect(saved()).toEqual(stored);
    expect(api.getMe).not.toHaveBeenCalled();

    await manager.restore();
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(api.getMe).toHaveBeenCalledWith(stored.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
  });

  it('goes offline, keeping the tokens, when a needed refresh cannot reach the API', async () => {
    const stored = fakeStoredSession(1, START, 5);
    const { api, manager, store, saved } = setup(stored);
    api.refresh.mockRejectedValue(new ApiError(0, 'timeout', 'Request timed out'));

    await manager.restore();

    expect(manager.getState()).toEqual({ status: 'offline' });
    expect(store.clear).not.toHaveBeenCalled();
    expect(saved()).toEqual(stored);
  });

  it('shows a suspended account, keeping the tokens so signing out can revoke them', async () => {
    const stored = fakeStoredSession(1, START);
    const { api, manager, saved } = setup(stored);
    api.getMe.mockRejectedValue(apiErrors.suspended());

    await manager.restore();
    expect(manager.getState()).toEqual({ status: 'suspended' });
    expect(saved()).toEqual(stored);

    await manager.signOut();
    expect(api.logout).toHaveBeenCalledWith(stored.accessToken);
    expect(saved()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('forgets a suspended session whose refresh the API refused', async () => {
    const { api, manager, saved } = setup(fakeStoredSession(1, START, 5));
    api.refresh.mockRejectedValue(apiErrors.suspended());

    await manager.restore();

    expect(saved()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'suspended' });
  });
});

describe('authorized', () => {
  async function signedIn(expiresInSeconds = 3600) {
    const context = setup(fakeStoredSession(1, START, expiresInSeconds));
    await context.manager.restore();
    log.length = 0;
    return context;
  }

  it('refreshes once and retries once after a 401', async () => {
    const { api, manager } = await signedIn();
    const rotated = fakeAuthSession(2, START);
    api.refresh.mockResolvedValue(rotated);
    const call = jest.fn((token: string) => {
      log.push(`call ${token}`);
      return token === rotated.accessToken
        ? Promise.resolve('ok')
        : Promise.reject(apiErrors.unauthenticated());
    });

    await expect(manager.authorized(call)).resolves.toBe('ok');

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
    // The rotated pair was on disk before the retry used it.
    expect(log).toEqual([
      'call access-1-' + TOKEN_MARKER,
      `save ${rotated.accessToken}`,
      `call ${rotated.accessToken}`,
    ]);
  });

  it('refreshes exactly once for concurrent calls that all get a 401', async () => {
    const { api, manager } = await signedIn();
    const rotated = fakeAuthSession(2, START);
    let release!: () => void;
    api.refresh.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(rotated))),
    );
    const call = jest.fn((token: string) =>
      token === rotated.accessToken
        ? Promise.resolve(token.length)
        : Promise.reject(apiErrors.unauthenticated()),
    );

    const results = Promise.all([
      manager.authorized(call),
      manager.authorized(call),
      manager.authorized(call),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await expect(results).resolves.toHaveLength(3);

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(6);
  });

  it('does not refresh again for a call that failed after another caller already rotated', async () => {
    const { api, manager } = await signedIn();
    const rotated = fakeAuthSession(2, START);
    api.refresh.mockResolvedValue(rotated);
    const fail = () => Promise.reject(apiErrors.unauthenticated());
    let rejectLate!: (error: unknown) => void;
    const late = jest.fn((token: string) =>
      token === rotated.accessToken
        ? Promise.resolve('late ok')
        : new Promise<string>((_, reject) => (rejectLate = reject)),
    );

    const slow = manager.authorized(late);
    await manager.authorized((token) =>
      token === rotated.accessToken ? Promise.resolve('fast ok') : fail(),
    );
    rejectLate(apiErrors.unauthenticated());

    await expect(slow).resolves.toBe('late ok');
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('signs out instead of looping when the retried call is refused again', async () => {
    const { api, manager, saved } = await signedIn();
    api.refresh.mockResolvedValue(fakeAuthSession(2, START));
    const call = jest.fn(() => Promise.reject(apiErrors.unauthenticated()));

    await expect(manager.authorized(call)).rejects.toBeInstanceOf(SessionEndedError);

    expect(call).toHaveBeenCalledTimes(2);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(saved()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signed_out', notice: MESSAGES.sessionEnded });
  });

  it('signs out when the refresh is refused', async () => {
    const { api, manager, saved } = await signedIn();
    api.refresh.mockRejectedValue(apiErrors.invalidRefresh());
    const call = jest.fn(() => Promise.reject(apiErrors.unauthenticated()));

    await expect(manager.authorized(call)).rejects.toBeInstanceOf(SessionEndedError);

    expect(call).toHaveBeenCalledTimes(1);
    expect(saved()).toBeNull();
    expect(manager.getState().status).toBe('signed_out');
  });

  it('keeps the session and surfaces the error when the refresh cannot reach the API', async () => {
    const { api, manager, saved } = await signedIn();
    const stored = saved();
    api.refresh.mockRejectedValue(apiErrors.network());
    const call = jest.fn(() => Promise.reject(apiErrors.unauthenticated()));

    await expect(manager.authorized(call)).rejects.toMatchObject({ code: 'network_error' });

    expect(saved()).toEqual(stored);
    expect(manager.getState().status).toBe('signed_in');
  });

  it('refreshes ahead of expiry instead of sending a token about to lapse', async () => {
    const { api, manager } = await signedIn(600);
    const rotated = fakeAuthSession(2, START);
    api.refresh.mockResolvedValue(rotated);
    clock = START + (600 - REFRESH_MARGIN_SECONDS + 1) * 1000;
    const call = jest.fn(() => Promise.resolve('ok'));

    await manager.authorized(call);

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(rotated.accessToken);
  });

  it('never repeats a call from an ended session with the next account’s token', async () => {
    const { api, manager, saved } = await signedIn();
    const first = fakeStoredSession(1, START);
    let refuse!: () => void;
    const call = jest.fn((token: string) =>
      token === first.accessToken
        ? new Promise<string>((_, reject) => (refuse = () => reject(apiErrors.unauthenticated())))
        : Promise.resolve('sent'),
    );

    const pending = manager.authorized(call);
    // Signed out and another account signed in while the call was in flight; the old
    // token is then refused because the sign-out revoked it.
    await manager.signOut();
    const next = fakeAuthSession(2, START);
    api.login.mockResolvedValue(next);
    await expect(manager.signIn('other@example.test', 'password2')).resolves.toEqual({ ok: true });
    refuse();

    await expect(pending).rejects.toBeInstanceOf(SessionEndedError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalledWith(next.accessToken);
    expect(api.refresh).not.toHaveBeenCalled();
    // The new session is untouched.
    expect(saved()?.accessToken).toBe(next.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
  });

  it('does not use a refresh that finished after its session was replaced', async () => {
    const { api, manager } = await signedIn(600);
    expect(manager.getState().status).toBe('signed_in');
    // The token is now about to lapse, so the call refreshes it first.
    clock = START + (600 - REFRESH_MARGIN_SECONDS + 1) * 1000;
    let rotate!: () => void;
    const rotated = fakeAuthSession(2, START);
    api.refresh.mockImplementation(
      () => new Promise((resolve) => (rotate = () => resolve(rotated))),
    );
    const call = jest.fn(() => Promise.resolve('sent'));

    const pending = manager.authorized(call);
    await manager.signOut();
    const next = fakeAuthSession(3, START);
    api.login.mockResolvedValue(next);
    await manager.signIn('other@example.test', 'password2');
    rotate();

    await expect(pending).rejects.toBeInstanceOf(SessionEndedError);
    expect(call).not.toHaveBeenCalled();
    // The pair the old session's refresh produced is revoked, not kept.
    expect(api.logout).toHaveBeenCalledWith(rotated.accessToken);
  });

  it('refuses to run without a session', async () => {
    const { manager } = setup();
    await manager.restore();
    const call = jest.fn();

    await expect(manager.authorized(call)).rejects.toBeInstanceOf(SessionEndedError);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  it('saves the tokens before checking the account, then signs in', async () => {
    const { api, manager, saved } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.login.mockResolvedValue(session);

    const result = await manager.signIn('  Customer@Example.test ', 'correct horse 1');

    expect(api.login).toHaveBeenCalledWith({
      email: 'customer@example.test',
      password: 'correct horse 1',
    });
    expect(log).toEqual([`save ${session.accessToken}`, `getMe ${session.accessToken}`]);
    expect(saved()?.refreshToken).toBe(session.refreshToken);
    expect(result).toEqual({ ok: true });
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
    expectNoTokens(manager, result);
  });

  it('rejects invalid input without calling the API', async () => {
    const { api, manager } = setup();

    const result = await manager.signIn('not-an-email', '');

    expect(api.login).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: MESSAGES.checkFields,
      fieldErrors: { email: 'Enter a valid email address', password: 'Enter your password.' },
    });
  });

  it.each([
    [new ApiError(401, 'invalid_credentials', 'x'), MESSAGES.invalidCredentials],
    [new ApiError(403, 'email_not_confirmed', 'x'), MESSAGES.emailNotConfirmed],
    [new ApiError(403, 'account_suspended', 'x'), MESSAGES.suspended],
    [new ApiError(403, 'account_unavailable', 'x'), MESSAGES.accountUnavailable],
    [new ApiError(429, 'rate_limited', 'x'), MESSAGES.rateLimited],
    [new ApiError(400, 'validation_failed', 'x'), MESSAGES.signInInvalid],
    [new ApiError(0, 'network_error', 'x'), MESSAGES.unavailable],
    [new ApiError(0, 'timeout', 'x'), MESSAGES.unavailable],
    [new ApiError(503, 'auth_unavailable', 'x'), MESSAGES.unavailable],
    [new ApiError(500, 'internal_error', 'x'), MESSAGES.unavailable],
  ])('maps %s to a fixed message', async (error, message) => {
    const { api, manager, store } = setup();
    await manager.restore();
    api.login.mockRejectedValue(error);

    const result = await manager.signIn('customer@example.test', 'password1');

    expect(result).toEqual({ ok: false, message });
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('does not keep a session whose account check failed', async () => {
    const { api, manager, saved } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.login.mockResolvedValue(session);
    api.getMe.mockRejectedValue(apiErrors.network());

    const result = await manager.signIn('customer@example.test', 'password1');

    expect(result).toEqual({ ok: false, message: MESSAGES.unavailable });
    expect(saved()).toBeNull();
    expect(api.logout).toHaveBeenCalledWith(session.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('does not start a session it could not save on the device', async () => {
    const { api, manager, store } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.login.mockResolvedValue(session);
    store.save.mockRejectedValue(new Error('keystore unavailable'));

    const result = await manager.signIn('customer@example.test', 'password1');

    expect(result).toEqual({ ok: false, message: MESSAGES.notSaved });
    expect(api.getMe).not.toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalledWith(session.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });
});

describe('register', () => {
  const input: RegisterInput = {
    email: 'new@example.test',
    password: 'letters123',
    fullName: '  Ayesha Rahman ',
    phone: '01712-345678',
  };

  it('sends only the registration fields and answers with the generic message', async () => {
    const { api, manager } = setup();
    api.register.mockResolvedValue({ status: 'accepted', message: 'from the API' });

    const result = await manager.register({ ...input, role: 'admin' } as RegisterInput);

    expect(api.register).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'letters123',
      fullName: 'Ayesha Rahman',
      phone: '+8801712345678',
    });
    expect(result).toEqual({ ok: true, message: MESSAGES.registered });
    expect(manager.getState()).toEqual({ status: 'restoring' });
  });

  it('gives the same answer for an address that already has an account', async () => {
    const { api, manager } = setup();
    api.register.mockResolvedValue({ status: 'accepted', message: 'from the API' });

    const first = await manager.register(input);
    const second = await manager.register({ ...input, email: 'existing@example.test' });

    expect(second).toEqual(first);
  });

  it('reports a weak password on the password field', async () => {
    const { api, manager } = setup();
    api.register.mockRejectedValue(new ApiError(400, 'weak_password', 'x'));

    const result = await manager.register(input);

    expect(result).toEqual({
      ok: false,
      message: MESSAGES.checkFields,
      fieldErrors: { password: MESSAGES.weakPassword },
    });
  });

  it('validates fields before calling the API', async () => {
    const { api, manager } = setup();

    const result = await manager.register({
      email: 'bad',
      password: 'short',
      phone: '12345',
    });

    expect(api.register).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors).toEqual({
      email: 'Enter a valid email address',
      password: 'Use at least 8 characters',
      phone: 'Enter a valid Bangladeshi mobile number',
    });
  });
});

describe('signOut', () => {
  async function signedIn() {
    const context = setup(fakeStoredSession(1, START));
    await context.manager.restore();
    return context;
  }

  it('revokes the session and clears the store', async () => {
    const { api, manager, saved } = await signedIn();

    await manager.signOut();

    expect(api.logout).toHaveBeenCalledWith('access-1-' + TOKEN_MARKER);
    expect(saved()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('forgets the session on the device before contacting the API', async () => {
    const { api, manager, saved } = await signedIn();
    const atRevoke: unknown[] = [];
    api.logout.mockImplementation(() => {
      atRevoke.push(saved(), manager.getState());
      return Promise.resolve();
    });

    await manager.signOut();

    expect(atRevoke).toEqual([null, { status: 'signed_out' }]);
  });

  it('clears the store and signs out even when the API is unreachable', async () => {
    const { api, manager, saved, store } = await signedIn();
    api.logout.mockRejectedValue(apiErrors.network());

    await manager.signOut();

    expect(store.clear).toHaveBeenCalled();
    expect(saved()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('refreshes once to revoke a session whose access token has lapsed', async () => {
    const { api, manager, saved } = await signedIn();
    const rotated = fakeAuthSession(2, START);
    api.logout.mockRejectedValueOnce(apiErrors.unauthenticated());
    api.refresh.mockResolvedValue(rotated);

    await manager.signOut();

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(api.logout).toHaveBeenLastCalledWith(rotated.accessToken);
    expect(saved()).toBeNull();
  });

  it('still signs out when the store cannot be cleared', async () => {
    const { manager, store } = await signedIn();
    store.clear.mockRejectedValue(new Error('keystore unavailable'));

    await manager.signOut();

    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('also forgets the Google session on the device', async () => {
    const googleSignOutSpy = jest.fn(() => Promise.resolve());
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
      signOut: googleSignOutSpy,
    });
    const { manager } = await signedIn();

    await manager.signOut();

    expect(googleSignOutSpy).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: 'signed_out' });

    resetGoogleIdTokenProvider();
  });

  it('signs out even when the Google module refuses to forget its session', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
      signOut: () => Promise.reject(new Error('native module missing')),
    });
    const { manager, api } = await signedIn();

    await manager.signOut();

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: 'signed_out' });

    resetGoogleIdTokenProvider();
  });
});

describe('updateProfile', () => {
  async function signedIn() {
    const context = setup(fakeStoredSession(1, START));
    await context.manager.restore();
    return context;
  }

  it('sends empty fields as null and shows the saved profile', async () => {
    const { api, manager } = await signedIn();
    const updated: MeResponse = {
      user: {
        ...CUSTOMER.user,
        profile: { ...CUSTOMER.user.profile, fullName: null, phone: null },
      },
    };
    api.updateMe.mockResolvedValue(updated);

    const result = await manager.updateProfile({ fullName: '  ', phone: '' });

    expect(api.updateMe).toHaveBeenCalledWith('access-1-' + TOKEN_MARKER, {
      fullName: null,
      phone: null,
    });
    expect(result).toEqual({ ok: true, message: MESSAGES.profileSaved });
    expect(manager.getState()).toEqual({ status: 'signed_in', user: updated.user });
  });

  it('rejects an invalid phone number without calling the API', async () => {
    const { api, manager } = await signedIn();

    const result = await manager.updateProfile({ fullName: 'Ayesha', phone: '999' });

    expect(api.updateMe).not.toHaveBeenCalled();
    expect(!result.ok && result.fieldErrors).toEqual({
      phone: 'Enter a valid Bangladeshi mobile number',
    });
  });

  it('reports an ended session when the API keeps refusing it', async () => {
    const { api, manager } = await signedIn();
    api.updateMe.mockRejectedValue(apiErrors.unauthenticated());
    api.refresh.mockRejectedValue(apiErrors.invalidRefresh());

    const result = await manager.updateProfile({ fullName: 'Ayesha', phone: '' });

    expect(result).toEqual({ ok: false, message: MESSAGES.sessionEnded });
    expect(manager.getState().status).toBe('signed_out');
    expectNoTokens(manager, result);
  });

  it('never saves one account’s profile edit to the account signed in after it', async () => {
    const { api, manager } = await signedIn();
    const first = fakeStoredSession(1, START);
    let refuse!: () => void;
    api.updateMe.mockImplementation((accessToken: string) =>
      accessToken === first.accessToken
        ? new Promise((_, reject) => (refuse = () => reject(apiErrors.unauthenticated())))
        : Promise.resolve(CUSTOMER),
    );

    const pending = manager.updateProfile({ fullName: 'Old Owner', phone: '01712-345678' });
    await manager.signOut();
    const next = fakeAuthSession(2, START);
    api.login.mockResolvedValue(next);
    await manager.signIn('other@example.test', 'password2');
    refuse();

    await expect(pending).resolves.toEqual({ ok: false, message: MESSAGES.sessionEnded });
    expect(api.updateMe).toHaveBeenCalledTimes(1);
    expect(api.updateMe).not.toHaveBeenCalledWith(next.accessToken, expect.anything());
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
  });

  it('moves to suspended when the API says the account is suspended', async () => {
    const { api, manager } = await signedIn();
    api.updateMe.mockRejectedValue(apiErrors.suspended());

    const result = await manager.updateProfile({ fullName: 'Ayesha', phone: '' });

    expect(result).toEqual({ ok: false, message: MESSAGES.profileSuspended });
    expect(manager.getState()).toEqual({ status: 'suspended' });
  });
});

describe('subscribe', () => {
  it('notifies listeners of every state change until unsubscribed', async () => {
    const { manager } = setup();
    const listener = jest.fn();
    const unsubscribe = manager.subscribe(listener);

    await manager.restore();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await manager.signOut();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('verifyEmailCode', () => {
  it('signs the account in once the code is accepted, saving the session first', async () => {
    const { api, manager, saved } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.verifyOtp.mockResolvedValue(session);

    const result = await manager.verifyEmailCode(' Customer@Example.test ', ' 123 456 ');

    expect(api.verifyOtp).toHaveBeenCalledWith({
      email: 'customer@example.test',
      code: '123456',
    });
    expect(log).toEqual([`save ${session.accessToken}`, `getMe ${session.accessToken}`]);
    expect(saved()?.refreshToken).toBe(session.refreshToken);
    expect(result).toEqual({ ok: true });
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
    expectNoTokens(manager, result);
  });

  it('rejects a code that is not six digits without calling the API', async () => {
    const { api, manager } = setup();

    const result = await manager.verifyEmailCode('customer@example.test', '12ab56');

    expect(api.verifyOtp).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, message: MESSAGES.checkFields });
  });

  it.each([
    [new ApiError(400, 'invalid_code', 'x'), MESSAGES.codeInvalid],
    [new ApiError(503, 'email_unavailable', 'x'), MESSAGES.emailUnavailable],
    [new ApiError(429, 'rate_limited', 'x'), MESSAGES.rateLimited],
    [new ApiError(503, 'auth_unavailable', 'x'), MESSAGES.unavailable],
  ])('maps %s to a fixed message and keeps the visitor signed out', async (error, message) => {
    const { api, manager, store } = setup();
    await manager.restore();
    api.verifyOtp.mockRejectedValue(error);

    const result = await manager.verifyEmailCode('customer@example.test', '123456');

    expect(result).toMatchObject({ ok: false, message });
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });
});

describe('resendEmailCode', () => {
  it('reports that a code was sent, without saying whether the address exists', async () => {
    const { api, manager } = setup();
    await manager.restore();
    api.resendOtp.mockResolvedValue({ status: 'accepted', message: 'sent' });

    const result = await manager.resendEmailCode('nobody@example.test');

    expect(api.resendOtp).toHaveBeenCalledWith({ email: 'nobody@example.test' });
    expect(result).toEqual({ ok: true, message: MESSAGES.codeSent });
    expectNoTokens(manager, result);
  });

  it('reports a refused resend with a fixed message', async () => {
    const { api, manager } = setup();
    await manager.restore();
    api.resendOtp.mockRejectedValue(new ApiError(429, 'rate_limited', 'x'));

    const result = await manager.resendEmailCode('nobody@example.test');

    expect(result).toEqual({ ok: false, message: MESSAGES.rateLimited });
  });
});

describe('resetPassword', () => {
  it('answers the same way for any address when requesting a code', async () => {
    const { api, manager } = setup();
    await manager.restore();
    api.forgotPassword.mockResolvedValue({ status: 'accepted', message: 'sent' });

    const result = await manager.requestPasswordReset('unknown@example.test');

    expect(result).toEqual({ ok: true, message: MESSAGES.resetRequested });
  });

  it('sets the password and signs this device out, since every session ended', async () => {
    const saved = fakeStoredSession(1, START);
    const { api, manager, store, saved: saveState } = setup(saved);
    await manager.restore();
    api.resetPassword.mockResolvedValue(undefined);

    const result = await manager.resetPassword(
      'customer@example.test',
      '654321',
      'A-new-password-42',
    );

    expect(api.resetPassword).toHaveBeenCalledWith({
      email: 'customer@example.test',
      code: '654321',
      password: 'A-new-password-42',
    });
    expect(result).toEqual({ ok: true, message: MESSAGES.resetDone });
    expect(store.clear).toHaveBeenCalled();
    expect(saveState()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('points at the code when it is refused', async () => {
    const { api, manager } = setup();
    await manager.restore();
    api.resetPassword.mockRejectedValue(new ApiError(400, 'invalid_code', 'x'));

    const result = await manager.resetPassword('customer@example.test', '000000', 'A-long-one-42');

    expect(result).toMatchObject({
      ok: false,
      message: MESSAGES.codeInvalid,
      fieldErrors: { code: 'That code is not right.' },
    });
  });

  it('points at the password when the API calls it weak', async () => {
    const { api, manager } = setup();
    await manager.restore();
    api.resetPassword.mockRejectedValue(new ApiError(400, 'weak_password', 'x'));

    const result = await manager.resetPassword('customer@example.test', '654321', 'A-long-one-42');

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { password: MESSAGES.weakPassword },
    });
  });

  it('rejects a short password before calling the API', async () => {
    const { api, manager } = setup();

    const result = await manager.resetPassword('customer@example.test', '654321', 'short');

    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, message: MESSAGES.checkFields });
  });
});

describe('signInWithGoogle', () => {
  afterEach(() => {
    resetGoogleIdTokenProvider();
  });

  it('exchanges the ID token for a session and stores it', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'header.claims.signature' }),
    });
    const { api, manager, saved } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.completeGoogleIdToken.mockResolvedValue(session);

    const result = await manager.signInWithGoogle();

    expect(api.completeGoogleIdToken).toHaveBeenCalledTimes(1);
    expect(api.completeGoogleIdToken).toHaveBeenCalledWith({
      idToken: 'header.claims.signature',
    });
    expect(log).toEqual([`save ${session.accessToken}`, `getMe ${session.accessToken}`]);
    expect(saved()?.refreshToken).toBe(session.refreshToken);
    expect(result).toEqual({ ok: true });
    expect(manager.getState()).toEqual({ status: 'signed_in', user: CUSTOMER.user });
    expectNoTokens(manager, result);
  });

  it('does not call the API when Google is cancelled', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
    });
    const { api, manager, store } = setup();
    await manager.restore();

    const result = await manager.signInWithGoogle();

    expect(result).toEqual({ ok: false, message: MESSAGES.googleCancelled });
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('says so when this build has no native Google module', async () => {
    const { api, manager } = setup();
    await manager.restore();

    const result = await manager.signInWithGoogle();

    expect(result).toEqual({ ok: false, message: MESSAGES.googleUnavailable });
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();
    expect(manager.googleSignInAvailable()).toBe(false);
  });

  it('reports a native failure as an outage', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'failed' }),
    });
    const { api, manager } = setup();
    await manager.restore();

    await expect(manager.signInWithGoogle()).resolves.toEqual({
      ok: false,
      message: MESSAGES.unavailable,
    });
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(401, 'invalid_credentials', 'x'), MESSAGES.googleRejected],
    [new ApiError(403, 'email_not_confirmed', 'x'), MESSAGES.googleEmailUnverified],
    [new ApiError(403, 'account_suspended', 'x'), MESSAGES.suspended],
    [new ApiError(503, 'oauth_unavailable', 'x'), MESSAGES.googleUnavailable],
    [new ApiError(429, 'rate_limited', 'x'), MESSAGES.rateLimited],
    [new ApiError(503, 'auth_unavailable', 'x'), MESSAGES.unavailable],
  ])('maps %s to a fixed message and keeps the visitor signed out', async (error, message) => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'a.b.c' }),
    });
    const { api, manager, store } = setup();
    await manager.restore();
    api.completeGoogleIdToken.mockRejectedValue(error);

    const result = await manager.signInWithGoogle();

    expect(result).toEqual({ ok: false, message });
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });

  it('signs out again when the API cannot verify the account it just signed in', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'a.b.c' }),
    });
    const { api, manager } = setup();
    await manager.restore();
    const session = fakeAuthSession(1, START);
    api.completeGoogleIdToken.mockResolvedValue(session);
    api.getMe.mockRejectedValue(new ApiError(403, 'account_suspended', 'x'));

    const result = await manager.signInWithGoogle();

    expect(result.ok).toBe(false);
    expect(api.logout).toHaveBeenCalledWith(session.accessToken);
    expect(manager.getState()).toEqual({ status: 'signed_out' });
  });
});
