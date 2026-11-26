import { ApiError } from '@nilzora/api-client';
import type { AuthSession, MeResponse } from '@nilzora/contracts';
import {
  SessionEndedError,
  type SessionApi,
  type SessionManager,
  type SessionState,
} from '@/auth/session-manager';
import type { StoredSession, TokenStore } from '@/auth/token-store';

/*
 * Test doubles for the session layer. Not imported by the app, so never bundled.
 * Every fake token contains TOKEN_MARKER, so a test can prove no token reached
 * state, messages, logs or the rendered tree.
 */

export const TOKEN_MARKER = 'opaque-token-7f3a9c';

/** A fresh API session numbered `n`, valid for `expiresIn` seconds from `nowMs`. */
export function fakeAuthSession(n: number, nowMs: number, expiresIn = 3600): AuthSession {
  return {
    accessToken: `access-${n}-${TOKEN_MARKER}`,
    refreshToken: `refresh-${n}-${TOKEN_MARKER}`,
    tokenType: 'bearer',
    expiresIn,
    expiresAt: Math.floor(nowMs / 1000) + expiresIn,
  };
}

/** Stored form of session `n`, expiring `expiresInSeconds` after `nowMs`. */
export function fakeStoredSession(
  n: number,
  nowMs: number,
  expiresInSeconds = 3600,
): StoredSession {
  return {
    accessToken: `access-${n}-${TOKEN_MARKER}`,
    refreshToken: `refresh-${n}-${TOKEN_MARKER}`,
    expiresAt: Math.floor(nowMs / 1000) + expiresInSeconds,
  };
}

export const CUSTOMER: MeResponse = {
  user: {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    email: 'customer@example.test',
    role: 'customer',
    permissions: [],
    profile: {
      fullName: 'Ayesha Rahman',
      phone: null,
      avatar: null,
      googleAvatar: null,
      status: 'active',
      createdAt: '2026-01-05T10:00:00.000Z',
      updatedAt: '2026-01-05T10:00:00.000Z',
    },
  },
};

export const apiErrors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Your session is invalid'),
  invalidRefresh: () => new ApiError(401, 'invalid_refresh_token', 'Your session has expired'),
  network: () => new ApiError(0, 'network_error', 'Could not reach the Nilzora API'),
  suspended: () => new ApiError(403, 'account_suspended', 'This account is suspended'),
};

type MockOf<F extends (...args: never[]) => unknown> = jest.Mock<ReturnType<F>, Parameters<F>>;

/**
 * API fake. Declared with function-valued properties rather than methods, so test
 * assertions such as `expect(api.getMe)` are not unbound method references.
 */
export interface FakeApi {
  login: MockOf<SessionApi['login']>;
  completeGoogleIdToken: MockOf<SessionApi['completeGoogleIdToken']>;
  register: MockOf<SessionApi['register']>;
  refresh: MockOf<SessionApi['refresh']>;
  logout: MockOf<SessionApi['logout']>;
  getMe: MockOf<SessionApi['getMe']>;
  updateMe: MockOf<SessionApi['updateMe']>;
  verifyOtp: MockOf<SessionApi['verifyOtp']>;
  resendOtp: MockOf<SessionApi['resendOtp']>;
  forgotPassword: MockOf<SessionApi['forgotPassword']>;
  resetPassword: MockOf<SessionApi['resetPassword']>;
}

function mockOf<F extends (...args: never[]) => unknown>(): MockOf<F> {
  return jest.fn<ReturnType<F>, Parameters<F>>();
}

/** Every call is unanswered until a test says otherwise, except logout, which succeeds. */
export function createFakeApi(): FakeApi {
  const logout = mockOf<SessionApi['logout']>();
  logout.mockResolvedValue(undefined);
  return {
    login: mockOf<SessionApi['login']>(),
    completeGoogleIdToken: mockOf<SessionApi['completeGoogleIdToken']>(),
    register: mockOf<SessionApi['register']>(),
    refresh: mockOf<SessionApi['refresh']>(),
    logout,
    getMe: mockOf<SessionApi['getMe']>(),
    updateMe: mockOf<SessionApi['updateMe']>(),
    verifyOtp: mockOf<SessionApi['verifyOtp']>(),
    resendOtp: mockOf<SessionApi['resendOtp']>(),
    forgotPassword: mockOf<SessionApi['forgotPassword']>(),
    resetPassword: mockOf<SessionApi['resetPassword']>(),
  };
}

export interface MemoryStore {
  store: jest.Mocked<TokenStore>;
  /** What is saved right now. */
  saved: () => StoredSession | null;
}

/** In-memory TokenStore. `log` (shared with API fakes) records the order of writes. */
export function createMemoryStore(
  initial: StoredSession | null = null,
  log?: string[],
): MemoryStore {
  let value = initial;
  return {
    store: {
      load: jest.fn(() => Promise.resolve(value)),
      save: jest.fn((session: StoredSession) => {
        log?.push(`save ${session.accessToken}`);
        value = session;
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        log?.push('clear');
        value = null;
        return Promise.resolve();
      }),
    },
    saved: () => value,
  };
}

/** A manager frozen in `state`, for screen tests that only need to render it. */
export function createStaticManager(state: SessionState): jest.Mocked<SessionManager> {
  return {
    getState: jest.fn(() => state),
    subscribe: jest.fn((_listener: () => void) => () => undefined),
    restore: jest.fn(() => Promise.resolve()),
    signIn: jest.fn(),
    register: jest.fn(),
    verifyEmailCode: jest.fn(),
    resendEmailCode: jest.fn(),
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    googleSignInAvailable: jest.fn(() => false),
    signOut: jest.fn(() => Promise.resolve()),
    authorized: jest.fn(),
    updateProfile: jest.fn(),
    setAvatar: jest.fn(),
  };
}

/** The access token a controllable manager hands to `authorized()` callbacks. */
export const FAKE_ACCESS_TOKEN = `access-fake-${TOKEN_MARKER}`;

export interface ControllableManager extends jest.Mocked<SessionManager> {
  /** Moves the session to `next` and notifies subscribers, like the real manager does. */
  setState: (next: SessionState) => void;
}

/**
 * A session manager whose state a test can change. `authorized()` runs its callback with
 * FAKE_ACCESS_TOKEN while the state is signed_in and rejects with SessionEndedError
 * otherwise, which is what the real manager does when nobody can be served. Use it with
 * a fake API client to test authenticated screens, and `setState` to test sign-out and
 * account changes.
 */
export function createControllableManager(initial: SessionState): ControllableManager {
  let state = initial;
  const listeners = new Set<() => void>();
  const authorized = jest.fn();
  authorized.mockImplementation((call: (accessToken: string) => Promise<unknown>) => {
    if (state.status !== 'signed_in') return Promise.reject(new SessionEndedError());
    return call(FAKE_ACCESS_TOKEN);
  });
  const manager: ControllableManager = {
    getState: jest.fn(() => state),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    restore: jest.fn(() => Promise.resolve()),
    signIn: jest.fn(),
    register: jest.fn(),
    verifyEmailCode: jest.fn(),
    resendEmailCode: jest.fn(),
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    googleSignInAvailable: jest.fn(() => false),
    signOut: jest.fn(() => {
      manager.setState({ status: 'signed_out' });
      return Promise.resolve();
    }),
    authorized,
    updateProfile: jest.fn(),
    setAvatar: jest.fn((avatar) => {
      if (state.status !== 'signed_in') return;
      manager.setState({
        status: 'signed_in',
        user: { ...state.user, profile: { ...state.user.profile, avatar } },
      });
    }),
    setState(next) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
  return manager;
}

/** A signed-in state for the sample customer, or for another account when `id` is given. */
export function signedInState(id: string = CUSTOMER.user.id): SessionState {
  return { status: 'signed_in', user: { ...CUSTOMER.user, id } };
}
