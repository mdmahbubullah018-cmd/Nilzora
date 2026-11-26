import { ApiError, type ApiClient } from '@nilzora/api-client';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  verifyOtpRequestSchema,
  type AuthSession,
  type MeResponse,
} from '@nilzora/contracts';
import { googleSignInAvailable, googleSignOut, requestGoogleIdToken } from './google-signin';
import type { StoredSession, TokenStore } from './token-store';

/*
 * Mobile session
 * --------------
 * The app talks to the Nilzora API with bearer tokens kept in the device keychain
 * (TokenStore). This module owns them: screens see only `SessionState`, which never
 * contains a token, and call the actions below. Framework-free so every path can be
 * unit-tested with a fake API, store and clock.
 */

export type SessionUser = MeResponse['user'];

export type SessionState =
  /** Reading the saved session and checking it with the API. */
  | { status: 'restoring' }
  /** `notice` explains why a session ended, when it did not end by choice. */
  | { status: 'signed_out'; notice?: string }
  | { status: 'signed_in'; user: SessionUser }
  /** A saved session could not be read or checked; it is kept for a retry. */
  | { status: 'offline' }
  | { status: 'suspended' };

/** Outcome of a form action. Messages are fixed strings chosen here, never API text. */
export type ActionResult<Field extends string> =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<Field, string>> };

/** What an established session reports; callers widen it to their own field names. */
type Outcome = { ok: true } | { ok: false; message: string };

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
}

export interface ProfileInput {
  fullName: string;
  phone: string;
}

/**
 * Members are plain functions (closures, no `this`), declared property-style so they
 * can be passed around unbound, e.g. to `useSyncExternalStore` or an `onPress`.
 */
export interface SessionManager {
  getState: () => SessionState;
  /** The listener runs after every state change. */
  subscribe: (listener: () => void) => () => void;
  /** Loads and verifies the saved session. Concurrent calls share one run. */
  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<ActionResult<'email' | 'password'>>;
  register: (input: RegisterInput) => Promise<ActionResult<keyof RegisterInput>>;
  /**
   * Redeems the six-digit code emailed at sign-up. Verifying the address completes
   * registration, so a correct code signs the account in on this device.
   */
  verifyEmailCode: (email: string, code: string) => Promise<ActionResult<'email' | 'code'>>;
  /** Sends a fresh sign-up code; the answer never reveals whether the address exists. */
  resendEmailCode: (email: string) => Promise<ActionResult<'email'>>;
  /** Emails a password-reset code; the answer never reveals whether the address exists. */
  requestPasswordReset: (email: string) => Promise<ActionResult<'email'>>;
  /** Sets a new password from a reset code. Every session for the account ends. */
  resetPassword: (
    email: string,
    code: string,
    password: string,
  ) => Promise<ActionResult<'email' | 'code' | 'password'>>;
  /**
   * Signs in with Google: asks Google Identity Services for an ID token and exchanges it
   * for a Nilzora session. The API verifies the token, so a client cannot name an account.
   */
  signInWithGoogle: () => Promise<ActionResult<'google'>>;
  /** Whether this build can show Google's account picker at all. */
  googleSignInAvailable: () => boolean;
  /** Revokes the session when the API is reachable; always forgets it on this device. */
  signOut: () => Promise<void>;
  /**
   * Runs `call` with a valid access token. Refreshes ahead of expiry, and on a 401
   * refreshes once (shared by concurrent callers) and retries once. Throws
   * `SessionEndedError` when the session is over, otherwise the call's own error.
   */
  authorized: <T>(call: (accessToken: string) => Promise<T>) => Promise<T>;
  updateProfile: (input: ProfileInput) => Promise<ActionResult<keyof ProfileInput>>;
  /**
   * Shows a profile picture the server has just confirmed (or none after it was removed).
   * It changes nothing on the server; the upload itself is what saved the picture.
   */
  setAvatar: (avatar: SessionUser['profile']['avatar']) => void;
}

export type SessionApi = Pick<
  ApiClient,
  | 'login'
  | 'register'
  | 'refresh'
  | 'logout'
  | 'getMe'
  | 'updateMe'
  | 'verifyOtp'
  | 'resendOtp'
  | 'forgotPassword'
  | 'resetPassword'
  | 'completeGoogleIdToken'
>;

export interface SessionManagerOptions {
  api: SessionApi;
  store: TokenStore;
  /** Current time in milliseconds; injectable for tests. */
  now?: () => number;
}

/** Access tokens this close to expiry (seconds) are refreshed before use. */
export const REFRESH_MARGIN_SECONDS = 60;

export const MESSAGES = {
  checkFields: 'Check the highlighted fields.',
  unavailable: 'Nilzora could not be reached. Check your connection and try again.',
  rateLimited: 'Too many attempts. Wait a few minutes, then try again.',
  sessionEnded: 'Your session has ended. Please sign in again.',
  invalidCredentials: 'The email address or password is incorrect.',
  emailNotConfirmed:
    'Confirm your email address first. We sent a confirmation link when you registered.',
  suspended: 'This account is suspended. Contact Nilzora support for help.',
  accountUnavailable: 'This account cannot be used right now. Contact Nilzora support.',
  signInInvalid: 'Enter a valid email address and password.',
  notSaved: 'Your sign-in could not be saved on this device. Please try again.',
  registered:
    'Check your inbox. If this address can be used for a new account, we have sent it a six-digit code.',
  codeSent: 'If this address needs a code, we have sent one. It expires in 10 minutes.',
  codeInvalid: 'That code is invalid or has expired. Ask for a new one.',
  codeSentField: 'Enter the six-digit code from your email.',
  emailUnavailable:
    'We could not send the email right now. Nothing was created; please try again in a few minutes.',
  resetRequested: 'If this address belongs to an account, we have sent a six-digit reset code.',
  resetDone: 'Your password has been changed. Sign in with your new password.',
  resetInvalid: 'Use at least 8 characters, with letters and numbers.',
  googleCancelled: 'Google sign-in was cancelled. You can try again or use your password.',
  googleUnavailable: 'Google sign-in is not available in this build.',
  googleRejected: 'Google could not verify that account. Try again or use your password.',
  googleEmailUnverified:
    'That Google account has no verified email address, so it cannot be used here.',
  registerRejected: 'An account could not be created with these details.',
  weakPassword: 'Choose a stronger password.',
  profileSaved: 'Your profile has been saved.',
  profileInvalid: 'Check your name and phone number, then try again.',
  profileSuspended: 'This account is suspended, so its profile cannot be changed.',
} as const;

const SIGN_IN_MESSAGES: Partial<Record<string, string>> = {
  invalid_credentials: MESSAGES.invalidCredentials,
  email_not_confirmed: MESSAGES.emailNotConfirmed,
  account_suspended: MESSAGES.suspended,
  account_unavailable: MESSAGES.accountUnavailable,
  rate_limited: MESSAGES.rateLimited,
  validation_failed: MESSAGES.signInInvalid,
};

const REGISTER_MESSAGES: Partial<Record<string, string>> = {
  rate_limited: MESSAGES.rateLimited,
  bad_request: MESSAGES.registerRejected,
  validation_failed: MESSAGES.registerRejected,
  email_unavailable: MESSAGES.emailUnavailable,
};

const CODE_MESSAGES: Partial<Record<string, string>> = {
  invalid_code: MESSAGES.codeInvalid,
  email_unavailable: MESSAGES.emailUnavailable,
  rate_limited: MESSAGES.rateLimited,
  validation_failed: MESSAGES.codeSentField,
};

const GOOGLE_MESSAGES: Partial<Record<string, string>> = {
  invalid_credentials: MESSAGES.googleRejected,
  invalid_code: MESSAGES.googleRejected,
  email_not_confirmed: MESSAGES.googleEmailUnverified,
  account_suspended: MESSAGES.suspended,
  account_unavailable: MESSAGES.accountUnavailable,
  oauth_unavailable: MESSAGES.googleUnavailable,
  rate_limited: MESSAGES.rateLimited,
};

const PROFILE_MESSAGES: Partial<Record<string, string>> = {
  account_suspended: MESSAGES.profileSuspended,
  account_unavailable: MESSAGES.accountUnavailable,
  validation_failed: MESSAGES.profileInvalid,
  rate_limited: MESSAGES.rateLimited,
};

/** Failures that say nothing about the request: expected on mobile, not worth a log line. */
const TRANSIENT_CODES = new Set(['network_error', 'timeout', 'auth_unavailable', 'rate_limited']);

/** The session is over (refused refresh, or the API still refused a fresh token). */
export class SessionEndedError extends Error {
  override readonly name = 'SessionEndedError';

  constructor() {
    super(MESSAGES.sessionEnded);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Logs what helps a developer (code, status, request id) and nothing secret. */
function logFailure(action: string, error: unknown): void {
  if (error instanceof ApiError) {
    console.warn(`[nilzora] ${action} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.warn(`[nilzora] ${action} failed unexpectedly`);
  }
}

function messageFor(
  error: unknown,
  messages: Partial<Record<string, string>>,
  action: string,
): string {
  const code = error instanceof ApiError ? error.code : 'unexpected';
  const known = messages[code];
  if (known !== undefined) return known;
  if (!TRANSIENT_CODES.has(code)) logFailure(action, error);
  return MESSAGES.unavailable;
}

function fieldErrorsOf<Field extends string>(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  overrides: Partial<Record<Field, string>> = {},
): Partial<Record<Field, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || errors[field] !== undefined) continue;
    errors[field] = (overrides as Partial<Record<string, string>>)[field] ?? issue.message;
  }
  return errors;
}

type RefreshOutcome =
  | { kind: 'refreshed'; tokens: StoredSession }
  /** The session is over; the state has already been moved on. */
  | { kind: 'ended' }
  /** Nothing was decided (network, outage, rate limit): keep the tokens. */
  | { kind: 'unavailable'; error: unknown };

export function createSessionManager({
  api,
  store,
  now = Date.now,
}: SessionManagerOptions): SessionManager {
  let state: SessionState = { status: 'restoring' };
  const listeners = new Set<() => void>();

  /** The current session's tokens. Deliberately outside `state`, so they never reach React. */
  let tokens: StoredSession | null = null;
  /**
   * Bumped whenever the session is replaced or ended. Work that started under an older
   * generation must not write tokens or state when it finishes.
   */
  let generation = 0;
  let refreshFlight: Promise<RefreshOutcome> | null = null;
  let restoreRun: Promise<void> | null = null;
  /** Store writes run one at a time, in the order they were requested. */
  let storeQueue: Promise<unknown> = Promise.resolve();

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /**
   * Expiry by the device clock (now + lifetime) rather than the server's `expiresAt`,
   * so a phone whose clock is off neither refreshes on every call nor too late.
   */
  function toStored(session: AuthSession): StoredSession {
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: Math.floor(now() / 1000) + session.expiresIn,
    };
  }

  function expiresSoon(session: StoredSession): boolean {
    return session.expiresAt - REFRESH_MARGIN_SECONDS <= now() / 1000;
  }

  /** Saves tokens unless the session they belong to has been replaced or ended meanwhile. */
  function saveFor(forGeneration: number, session: StoredSession): Promise<boolean> {
    const run = storeQueue.then(async () => {
      if (forGeneration !== generation) return false;
      await store.save(session);
      return true;
    });
    storeQueue = run.catch(() => undefined);
    return run;
  }

  function clearStore(): Promise<void> {
    const run = storeQueue.then(() => store.clear());
    storeQueue = run.catch(() => undefined);
    return run.catch(() => {
      console.warn('[nilzora] the saved session could not be removed from this device');
    });
  }

  /** Forgets the session on this device and moves to `next`. */
  async function endSession(next: SessionState): Promise<void> {
    generation += 1;
    const ended = generation;
    tokens = null;
    refreshFlight = null;
    await clearStore();
    if (ended === generation) setState(next);
  }

  function revokeQuietly(accessToken: string): void {
    void api.logout(accessToken).catch(() => undefined);
  }

  /**
   * Reacts to account-level refusals the API can return for any authenticated call,
   * unless the session that made the call has since been replaced or ended.
   */
  async function handleAccountRefusal(
    error: unknown,
    used: StoredSession,
    callGeneration: number,
  ): Promise<void> {
    if (callGeneration !== generation || tokens === null) return;
    if (hasCode(error, 'account_suspended')) {
      // Keep the tokens: signing out can still revoke them at the API.
      setState({ status: 'suspended' });
    } else if (hasCode(error, 'account_unavailable')) {
      revokeQuietly(used.accessToken);
      await endSession({ status: 'signed_out', notice: MESSAGES.accountUnavailable });
    }
  }

  function startRefresh(current: StoredSession): Promise<RefreshOutcome> {
    const started = generation;
    return (async (): Promise<RefreshOutcome> => {
      let session: AuthSession;
      try {
        session = await api.refresh(current.refreshToken);
      } catch (error) {
        if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
          if (started === generation) {
            const suspended = error.code === 'account_suspended';
            // A suspended account's session was revoked by the API, so nothing is kept.
            await endSession(
              suspended
                ? { status: 'suspended' }
                : { status: 'signed_out', notice: MESSAGES.sessionEnded },
            );
          }
          return { kind: 'ended' };
        }
        return { kind: 'unavailable', error };
      }

      const next = toStored(session);
      let saved: boolean;
      try {
        // The rotated pair is on disk before anyone uses it: the old refresh token is spent.
        saved = await saveFor(started, next);
      } catch {
        // Keep the session for this run; the next launch will ask to sign in again.
        console.warn('[nilzora] the refreshed session could not be saved on this device');
        saved = started === generation;
      }
      if (!saved || started !== generation) {
        // Signed out or replaced meanwhile: do not resurrect it, and revoke the new pair.
        revokeQuietly(next.accessToken);
        return { kind: 'ended' };
      }
      tokens = next;
      return { kind: 'refreshed', tokens: next };
    })();
  }

  /**
   * Refreshes the session `used` belongs to, once, however many callers ask at the same time.
   * A caller from an older generation gets nothing: never the tokens of whoever signed in since.
   */
  function refreshFrom(used: StoredSession, forGeneration: number): Promise<RefreshOutcome> {
    if (forGeneration !== generation || tokens === null) return Promise.resolve({ kind: 'ended' });
    // Another caller already rotated this session: use the result instead of refreshing again.
    if (tokens.accessToken !== used.accessToken) {
      return Promise.resolve({ kind: 'refreshed', tokens });
    }
    if (refreshFlight === null) {
      const flight = startRefresh(tokens);
      refreshFlight = flight;
      const settle = () => {
        if (refreshFlight === flight) refreshFlight = null;
      };
      flight.then(settle, settle);
    }
    return refreshFlight;
  }

  async function freshTokens(used: StoredSession, forGeneration: number): Promise<StoredSession> {
    const outcome = await refreshFrom(used, forGeneration);
    if (forGeneration !== generation) throw new SessionEndedError();
    if (outcome.kind === 'refreshed') return outcome.tokens;
    if (outcome.kind === 'unavailable') throw outcome.error;
    throw new SessionEndedError();
  }

  /**
   * Stops work that started for a session that has since been ended or replaced. Its 401 is
   * likely the revoke taking effect, and it must never be repeated with another account's token.
   */
  function assertCurrent(started: number): void {
    if (started !== generation) throw new SessionEndedError();
  }

  async function authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
    const started = generation;
    let current = tokens;
    if (current === null) throw new SessionEndedError();
    if (expiresSoon(current)) {
      current = await freshTokens(current, started);
      assertCurrent(started);
    }

    try {
      return await call(current.accessToken);
    } catch (error) {
      if (!isUnauthenticated(error)) {
        await handleAccountRefusal(error, current, started);
        throw error;
      }
    }

    // The access token was refused: one refresh, one retry, never a loop.
    assertCurrent(started);
    const retry = await freshTokens(current, started);
    assertCurrent(started);
    try {
      return await call(retry.accessToken);
    } catch (error) {
      if (isUnauthenticated(error)) {
        if (tokens?.accessToken === retry.accessToken) {
          await endSession({ status: 'signed_out', notice: MESSAGES.sessionEnded });
        }
        throw new SessionEndedError();
      }
      await handleAccountRefusal(error, retry, started);
      throw error;
    }
  }

  async function runRestore(): Promise<void> {
    const started = generation;
    if (state.status !== 'restoring') setState({ status: 'restoring' });

    let saved = tokens;
    if (saved === null) {
      try {
        saved = await store.load();
      } catch {
        // Unreadable right now (see TokenStore.load): the entry is kept, so offer a retry.
        if (started === generation) {
          console.warn('[nilzora] the saved session could not be read on this device');
          setState({ status: 'offline' });
        }
        return;
      }
      if (started !== generation) return; // signed in or out meanwhile
      if (saved === null) {
        setState({ status: 'signed_out' });
        return;
      }
      tokens = saved;
    }

    try {
      const { user } = await authorized((accessToken) => api.getMe(accessToken));
      if (started === generation) setState({ status: 'signed_in', user });
    } catch (error) {
      // Ended sessions and unusable accounts have already moved the state on.
      if (started !== generation || error instanceof SessionEndedError) return;
      if (hasCode(error, 'account_suspended')) {
        setState({ status: 'suspended' });
        return;
      }
      if (!(error instanceof ApiError) || !TRANSIENT_CODES.has(error.code)) {
        logFailure('session check', error);
      }
      setState({ status: 'offline' });
    }
  }

  async function signIn(
    email: string,
    password: string,
  ): Promise<ActionResult<'email' | 'password'>> {
    const parsed = loginRequestSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.checkFields,
        fieldErrors: fieldErrorsOf<'email' | 'password'>(parsed.error.issues, {
          password: 'Enter your password.',
        }),
      };
    }

    let session: AuthSession;
    try {
      session = await api.login(parsed.data);
    } catch (error) {
      return { ok: false, message: messageFor(error, SIGN_IN_MESSAGES, 'sign-in') };
    }

    return establishSession(session, 'sign-in');
  }

  /**
   * Keeps a session the API just issued: stores the tokens, verifies the account with
   * GET /me and moves to signed_in. Shared by password sign-in and by redeeming an email
   * code, which signs the account in once the address is verified.
   */
  async function establishSession(session: AuthSession, action: string): Promise<Outcome> {
    generation += 1;
    const started = generation;
    const next = toStored(session);
    tokens = next;
    refreshFlight = null;

    let saved = false;
    try {
      saved = await saveFor(started, next);
    } catch {
      // fall through: a session that cannot be kept is not started
    }
    if (!saved) {
      revokeQuietly(next.accessToken);
      if (started !== generation) return { ok: false, message: MESSAGES.sessionEnded };
      await endSession({ status: 'signed_out' });
      return { ok: false, message: MESSAGES.notSaved };
    }

    let user: SessionUser;
    try {
      ({ user } = await api.getMe(next.accessToken));
    } catch (error) {
      // Never keep a session the app could not verify.
      revokeQuietly(next.accessToken);
      if (started === generation) await endSession({ status: 'signed_out' });
      return { ok: false, message: messageFor(error, SIGN_IN_MESSAGES, `${action} profile check`) };
    }
    if (started !== generation) return { ok: false, message: MESSAGES.sessionEnded };

    setState({ status: 'signed_in', user });
    return { ok: true };
  }

  async function verifyEmailCode(
    email: string,
    code: string,
  ): Promise<ActionResult<'email' | 'code'>> {
    const parsed = verifyOtpRequestSchema.safeParse({
      email: email.trim(),
      code: code.replace(/\s+/g, ''),
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.checkFields,
        fieldErrors: fieldErrorsOf<'email' | 'code'>(parsed.error.issues, {
          code: MESSAGES.codeSentField,
        }),
      };
    }

    let session: AuthSession;
    try {
      session = await api.verifyOtp(parsed.data);
    } catch (error) {
      const message = messageFor(error, CODE_MESSAGES, 'email code');
      return {
        ok: false,
        message,
        ...(hasCode(error, 'invalid_code')
          ? { fieldErrors: { code: 'That code is not right.' } }
          : {}),
      };
    }
    return establishSession(session, 'email code');
  }

  async function resendEmailCode(email: string): Promise<ActionResult<'email'>> {
    const parsed = forgotPasswordRequestSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.signInInvalid,
        fieldErrors: { email: MESSAGES.signInInvalid },
      };
    }
    try {
      await api.resendOtp(parsed.data);
    } catch (error) {
      return { ok: false, message: messageFor(error, CODE_MESSAGES, 'email code resend') };
    }
    return { ok: true, message: MESSAGES.codeSent };
  }

  async function signInWithGoogle(): Promise<ActionResult<'google'>> {
    const token = await requestGoogleIdToken();
    if (!token.ok) {
      const message =
        token.reason === 'cancelled'
          ? MESSAGES.googleCancelled
          : token.reason === 'unavailable'
            ? MESSAGES.googleUnavailable
            : MESSAGES.unavailable;
      return { ok: false, message };
    }

    let session: AuthSession;
    try {
      session = await api.completeGoogleIdToken({ idToken: token.idToken });
    } catch (error) {
      return { ok: false, message: messageFor(error, GOOGLE_MESSAGES, 'google sign-in') };
    }

    // Same checks as a password sign-in: the account must exist and be usable right now.
    return establishSession(session, 'google sign-in');
  }

  async function requestPasswordReset(email: string): Promise<ActionResult<'email'>> {
    const parsed = forgotPasswordRequestSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.signInInvalid,
        fieldErrors: { email: MESSAGES.signInInvalid },
      };
    }
    try {
      await api.forgotPassword(parsed.data);
    } catch (error) {
      return { ok: false, message: messageFor(error, CODE_MESSAGES, 'password reset request') };
    }
    return { ok: true, message: MESSAGES.resetRequested };
  }

  async function resetPassword(
    email: string,
    code: string,
    password: string,
  ): Promise<ActionResult<'email' | 'code' | 'password'>> {
    const parsed = resetPasswordRequestSchema.safeParse({
      email: email.trim(),
      code: code.replace(/\s+/g, ''),
      password,
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.checkFields,
        fieldErrors: fieldErrorsOf<'email' | 'code' | 'password'>(parsed.error.issues, {
          code: MESSAGES.codeSentField,
          password: MESSAGES.resetInvalid,
        }),
      };
    }

    try {
      await api.resetPassword(parsed.data);
    } catch (error) {
      if (hasCode(error, 'weak_password')) {
        return {
          ok: false,
          message: MESSAGES.checkFields,
          fieldErrors: { password: MESSAGES.weakPassword },
        };
      }
      const message = messageFor(error, CODE_MESSAGES, 'password reset');
      return {
        ok: false,
        message,
        ...(hasCode(error, 'invalid_code')
          ? { fieldErrors: { code: 'That code is not right.' } }
          : {}),
      };
    }
    // Every session for the account is gone, so this device is signed out too.
    await endSession({ status: 'signed_out' });
    return { ok: true, message: MESSAGES.resetDone };
  }

  async function register(input: RegisterInput): Promise<ActionResult<keyof RegisterInput>> {
    // Only these four fields exist, so a role or permission can never be sent.
    const parsed = registerRequestSchema.safeParse({
      email: input.email.trim(),
      password: input.password,
      fullName: input.fullName?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.checkFields,
        fieldErrors: fieldErrorsOf<keyof RegisterInput>(parsed.error.issues, {
          fullName: 'Enter your name in 120 characters or fewer.',
        }),
      };
    }

    try {
      await api.register(parsed.data);
    } catch (error) {
      if (hasCode(error, 'weak_password')) {
        return {
          ok: false,
          message: MESSAGES.checkFields,
          fieldErrors: { password: MESSAGES.weakPassword },
        };
      }
      return { ok: false, message: messageFor(error, REGISTER_MESSAGES, 'registration') };
    }
    // Identical for new and already-registered addresses, so nobody can probe for accounts.
    return { ok: true, message: MESSAGES.registered };
  }

  /** Revokes the session at the API, refreshing once if the access token has lapsed. */
  async function revoke(current: StoredSession): Promise<void> {
    try {
      await api.logout(current.accessToken);
      return;
    } catch (error) {
      if (!isUnauthenticated(error)) return; // unreachable: nothing more can be done
    }
    try {
      const session = await api.refresh(current.refreshToken);
      await api.logout(session.accessToken);
    } catch {
      // The refresh token was already invalid, or the API is unreachable.
    }
  }

  async function signOut(): Promise<void> {
    const current = tokens;
    // Forget the session on this device first: a slow or unreachable API, or the app
    // being closed meanwhile, must never leave usable credentials behind. Then revoke
    // it at the API so the tokens stop working everywhere.
    await endSession({ status: 'signed_out' });
    // And forget Google's session too, so the next sign-in shows the account picker.
    await googleSignOut();
    if (current !== null) await revoke(current);
  }

  async function updateProfile(input: ProfileInput): Promise<ActionResult<keyof ProfileInput>> {
    const parsed = updateProfileRequestSchema.safeParse({
      fullName: input.fullName.trim() || null,
      phone: input.phone.trim() || null,
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: MESSAGES.checkFields,
        fieldErrors: fieldErrorsOf<keyof ProfileInput>(parsed.error.issues, {
          fullName: 'Enter your name in 120 characters or fewer.',
        }),
      };
    }

    const started = generation;
    try {
      const { user } = await authorized((accessToken) => api.updateMe(accessToken, parsed.data));
      if (started === generation && state.status === 'signed_in') {
        setState({ status: 'signed_in', user });
      }
      return { ok: true, message: MESSAGES.profileSaved };
    } catch (error) {
      if (error instanceof SessionEndedError) return { ok: false, message: MESSAGES.sessionEnded };
      return { ok: false, message: messageFor(error, PROFILE_MESSAGES, 'profile update') };
    }
  }

  function setAvatar(avatar: SessionUser['profile']['avatar']): void {
    if (state.status !== 'signed_in') return;
    setState({
      status: 'signed_in',
      user: { ...state.user, profile: { ...state.user.profile, avatar } },
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore() {
      if (restoreRun === null) {
        const run = runRestore();
        restoreRun = run;
        const settle = () => {
          if (restoreRun === run) restoreRun = null;
        };
        run.then(settle, settle);
      }
      return restoreRun;
    },
    signIn,
    register,
    verifyEmailCode,
    resendEmailCode,
    requestPasswordReset,
    resetPassword,
    signInWithGoogle,
    googleSignInAvailable,
    signOut,
    authorized,
    updateProfile,
    setAvatar,
  };
}
