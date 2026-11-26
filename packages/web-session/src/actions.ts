import { ApiError, type ApiClient } from '@nilzora/api-client';
import {
  confirmEmailRequestSchema,
  forgotPasswordRequestSchema,
  googleCallbackRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  verifyOtpRequestSchema,
  type AuthSession,
  type Permission,
} from '@nilzora/contracts';
import type { z } from 'zod';
import type { WebSessionConfig } from './config';
import {
  clearSessionCookies,
  cookieNames,
  sessionTokens,
  writeSessionCookies,
  type CookieJar,
} from './cookies';
import { CSRF_FIELD, isSameOriginRequest, rotateCsrfCookie, verifyCsrfToken } from './csrf';
import { refreshSessionOnce } from './refresh';
import type { SessionCall, SessionRead, SessionUser } from './session';

/** Everything a form action needs from the incoming request. */
export interface ActionContext {
  config: WebSessionConfig;
  jar: CookieJar;
  headers: Pick<Headers, 'get'>;
  api: ApiClient;
}

/**
 * What a form action returns to the page. It never contains tokens, passwords or raw
 * error objects: messages are fixed strings chosen here.
 */
export interface FormState {
  /** `signed_out`: the session ended; the page should send the visitor to sign in. */
  status: 'idle' | 'error' | 'success' | 'signed_out';
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Non-secret values echoed back so the form keeps what was typed. */
  values?: Partial<Record<string, string>>;
}

export const INITIAL_FORM_STATE: FormState = { status: 'idle' };

export const FORM_EXPIRED: FormState = {
  status: 'error',
  message: 'This form has expired or did not come from Nilzora. Reload the page and try again.',
};

/**
 * The HTTP status an upload route answers with for a form state.
 *
 * The body is always the same form state, so a browser shows the server's own message either
 * way; the status only stops a refused upload from arriving as `200 OK` in logs, proxies and
 * monitoring. A refused CSRF/origin check is 403, an ended session is 401, and an upload the
 * server looked at and declined is 422.
 */
export function formStateStatus(state: FormState): number {
  if (state.status === 'success' || state.status === 'idle') return 200;
  if (state.status === 'signed_out') return 401;
  return state.message === FORM_EXPIRED.message ? 403 : 422;
}

const UNAVAILABLE_MESSAGE = 'Nilzora could not be reached. Please try again in a moment.';
/**
 * Said when the API accepted the sign-up but the mail server would not take the code. Nothing
 * was created, so trying again is safe — and saying so keeps the visitor from wondering whether
 * a half-made account exists.
 */
export const EMAIL_UNAVAILABLE_MESSAGE =
  'We could not send your verification email just now, so no account was created. Please try again in a few minutes.';
/** What a refused-for-rate-limit form says; exported so a form can present it as a wait, not a mistake. */
export const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a few minutes, then try again.';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Same-origin post carrying a CSRF token that matches this browser's cookie. */
export function isTrustedForm(ctx: ActionContext, formData: FormData): boolean {
  return (
    isSameOriginRequest(ctx.headers, ctx.config) &&
    verifyCsrfToken(ctx.config, ctx.jar.get(cookieNames(ctx.config).csrf), formData.get(CSRF_FIELD))
  );
}

function fieldErrors(
  error: z.ZodError,
  overrides: Partial<Record<string, string>> = {},
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || errors[field] !== undefined) continue;
    errors[field] = overrides[field] ?? issue.message;
  }
  return errors;
}

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unexpected';
}

/** Logs what helps an operator (code, status, request id) and nothing secret. */
function logFailure(action: string, error: unknown): void {
  if (error instanceof ApiError) {
    console.error(`[nilzora] ${action} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error(`[nilzora] ${action} failed unexpectedly`);
  }
}

const SIGN_IN_MESSAGES: Partial<Record<string, string>> = {
  invalid_credentials: 'The email address or password is incorrect.',
  email_not_confirmed:
    'Confirm your email address first. We sent a confirmation link when you registered.',
  account_suspended: 'This account is suspended. Contact Nilzora support for help.',
  account_unavailable: 'This account cannot be used right now. Contact Nilzora support.',
  rate_limited: RATE_LIMITED_MESSAGE,
  validation_failed: 'Enter a valid email address and password.',
};

export interface SignInOptions {
  /** Staff apps: the account must hold at least one of these, or it is signed straight out. */
  requireAnyPermission?: readonly Permission[];
  deniedMessage?: string;
}

export type SignInResult = FormState & { user?: SessionUser };

export async function signIn(
  ctx: ActionContext,
  formData: FormData,
  options: SignInOptions = {},
): Promise<SignInResult> {
  const email = text(formData, 'email').trim();
  const values = { email };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = loginRequestSchema.safeParse({ email, password: text(formData, 'password') });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error, { password: 'Enter your password.' }),
      values,
    };
  }

  let session;
  try {
    session = await ctx.api.login(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (SIGN_IN_MESSAGES[code] === undefined) logFailure('sign-in', error);
    return { status: 'error', message: SIGN_IN_MESSAGES[code] ?? UNAVAILABLE_MESSAGE, values };
  }

  return establish(ctx, session, options, values);
}

/**
 * Turns a session the API just issued into this browser's session: checks the account
 * still exists and may use this app, stores the tokens and rotates the CSRF secret.
 * Shared by password sign-in and by redeeming an email code, which signs the account in
 * as soon as the address is verified.
 */
async function establish(
  ctx: ActionContext,
  session: AuthSession,
  options: SignInOptions,
  values: Partial<Record<string, string>>,
): Promise<SignInResult> {
  let user: SessionUser;
  try {
    user = (await ctx.api.getMe(session.accessToken)).user;
  } catch (error) {
    logFailure('sign-in profile check', error);
    await ctx.api.logout(session.accessToken).catch(() => undefined);
    return { status: 'error', message: UNAVAILABLE_MESSAGE, values };
  }

  const required = options.requireAnyPermission;
  if (required && !required.some((permission) => user.permissions.includes(permission))) {
    // Never leave a session behind for an account this app will not serve.
    await ctx.api.logout(session.accessToken).catch(() => undefined);
    return {
      status: 'error',
      message: options.deniedMessage ?? 'This account cannot sign in here.',
      values,
    };
  }

  writeSessionCookies(ctx.jar, ctx.config, session);
  rotateCsrfCookie(ctx.jar, ctx.config);
  return { status: 'success', user };
}

const REGISTERED_MESSAGE =
  'Check your inbox. If this address can be used for a new account, we have sent it a confirmation link.';

export async function register(ctx: ActionContext, formData: FormData): Promise<FormState> {
  const values = {
    email: text(formData, 'email').trim(),
    fullName: text(formData, 'fullName').trim(),
    phone: text(formData, 'phone').trim(),
  };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  // Only these four fields are read, so a submitted role or permission goes nowhere.
  const parsed = registerRequestSchema.safeParse({
    email: values.email,
    password: text(formData, 'password'),
    fullName: values.fullName || undefined,
    phone: values.phone || undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error, {
        fullName: 'Enter your name in 120 characters or fewer.',
      }),
      values,
    };
  }

  try {
    await ctx.api.register(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'weak_password') {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: { password: 'Choose a stronger password.' },
        values,
      };
    }
    if (code === 'rate_limited') return { status: 'error', message: RATE_LIMITED_MESSAGE, values };
    if (code === 'bad_request' || code === 'validation_failed') {
      return {
        status: 'error',
        message: 'An account could not be created with these details.',
        values,
      };
    }
    // The API could not hand the code to the mail server, so it created nothing: say exactly
    // that, rather than the generic outage line, so the visitor knows retrying is safe.
    if (code === 'email_unavailable') {
      logFailure('registration', error);
      return { status: 'error', message: EMAIL_UNAVAILABLE_MESSAGE, values };
    }
    logFailure('registration', error);
    return { status: 'error', message: UNAVAILABLE_MESSAGE, values };
  }
  // Identical for new and already-registered addresses (no account discovery).
  return { status: 'success', message: REGISTERED_MESSAGE, values: { email: parsed.data.email } };
}

const CODE_MESSAGES: Partial<Record<string, string>> = {
  invalid_code: 'That code is invalid or has expired. Ask for a new one.',
  email_unavailable:
    'We could not send the email right now. Nothing was created; please try again in a few minutes.',
  rate_limited: RATE_LIMITED_MESSAGE,
  validation_failed: 'Enter the six-digit code from your email.',
};

const CODE_SENT_MESSAGE =
  'If this address needs a code, we have sent one. It expires in 10 minutes.';

/**
 * Redeems the six-digit code emailed at sign-up. Verifying the address is what completes
 * registration, so the account is signed in here; staff apps pass the same permission
 * check as sign-in.
 */
export async function verifyOtp(
  ctx: ActionContext,
  formData: FormData,
  options: SignInOptions = {},
): Promise<SignInResult> {
  const values = { email: text(formData, 'email').trim() };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = verifyOtpRequestSchema.safeParse({
    email: values.email,
    code: text(formData, 'code').replace(/\s+/g, ''),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error, { code: 'Enter the six-digit code from your email.' }),
      values,
    };
  }

  let session: AuthSession;
  try {
    session = await ctx.api.verifyOtp(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (CODE_MESSAGES[code] === undefined) logFailure('email code', error);
    return {
      status: 'error',
      message: CODE_MESSAGES[code] ?? UNAVAILABLE_MESSAGE,
      ...(code === 'invalid_code' ? { fieldErrors: { code: 'That code is not right.' } } : {}),
      values,
    };
  }

  return establish(ctx, session, options, values);
}

/** Sends a fresh sign-up code. The answer never says whether the address has an account. */
export async function resendOtp(ctx: ActionContext, formData: FormData): Promise<FormState> {
  const values = { email: text(formData, 'email').trim() };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = resendOtpRequestSchema.safeParse({ email: values.email });
  if (!parsed.success) return { status: 'error', message: 'Enter your email address.', values };

  try {
    await ctx.api.resendOtp(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (CODE_MESSAGES[code] === undefined) logFailure('email code resend', error);
    return { status: 'error', message: CODE_MESSAGES[code] ?? UNAVAILABLE_MESSAGE, values };
  }
  return { status: 'success', message: CODE_SENT_MESSAGE, values };
}

const RESET_REQUESTED_MESSAGE =
  'If this address belongs to an account, we have sent a six-digit reset code.';

/** Emails a password-reset code. Identical answer for unknown addresses. */
export async function requestPasswordReset(
  ctx: ActionContext,
  formData: FormData,
): Promise<FormState> {
  const values = { email: text(formData, 'email').trim() };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = forgotPasswordRequestSchema.safeParse({ email: values.email });
  if (!parsed.success) return { status: 'error', message: 'Enter your email address.', values };

  try {
    await ctx.api.forgotPassword(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (CODE_MESSAGES[code] === undefined) logFailure('password reset request', error);
    return { status: 'error', message: CODE_MESSAGES[code] ?? UNAVAILABLE_MESSAGE, values };
  }
  return { status: 'success', message: RESET_REQUESTED_MESSAGE, values };
}

/**
 * Sets a new password from a reset code. The API ends every session for the account, so
 * this browser is signed out and continues with the new password.
 */
export async function resetPassword(ctx: ActionContext, formData: FormData): Promise<FormState> {
  const values = { email: text(formData, 'email').trim() };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = resetPasswordRequestSchema.safeParse({
    email: values.email,
    code: text(formData, 'code').replace(/\s+/g, ''),
    password: text(formData, 'password'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error, {
        code: 'Enter the six-digit code from your email.',
        password: 'Use at least 8 characters, with letters and numbers.',
      }),
      values,
    };
  }

  try {
    await ctx.api.resetPassword(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'weak_password') {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: { password: 'Choose a stronger password.' },
        values,
      };
    }
    if (CODE_MESSAGES[code] === undefined) logFailure('password reset', error);
    return {
      status: 'error',
      message: CODE_MESSAGES[code] ?? UNAVAILABLE_MESSAGE,
      ...(code === 'invalid_code' ? { fieldErrors: { code: 'That code is not right.' } } : {}),
      values,
    };
  }
  // Every session for the account is gone, so these cookies are worthless now.
  clearSessionCookies(ctx.jar, ctx.config);
  return {
    status: 'success',
    message: 'Your password has been changed. Sign in with your new password.',
    values,
  };
}

/** Why a Google sign-in did not complete; each maps to one fixed message. */
export type GoogleFailureReason = 'denied' | 'invalid' | 'unavailable' | 'suspended' | 'blocked';

export type GoogleStartOutcome = { ok: true; url: string } | { ok: false; message: string };

/**
 * Starts Google sign-in: the API builds the authorization URL (signed state, nonce and
 * PKCE challenge) and the caller redirects the browser to it. The form is CSRF-checked
 * first, because the response sends the visitor to a third party.
 */
export async function googleStart(
  ctx: ActionContext,
  formData: FormData,
): Promise<GoogleStartOutcome> {
  if (!isTrustedForm(ctx, formData)) return { ok: false, message: FORM_EXPIRED.message ?? '' };
  try {
    const { url } = await ctx.api.googleStart(text(formData, 'next'));
    return { ok: true, url };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'oauth_unavailable') {
      return { ok: false, message: 'Google sign-in is not available right now.' };
    }
    if (code !== 'rate_limited') logFailure('google sign-in start', error);
    return {
      ok: false,
      message: code === 'rate_limited' ? RATE_LIMITED_MESSAGE : UNAVAILABLE_MESSAGE,
    };
  }
}

export type GoogleSignInOutcome =
  { ok: true; returnTo: string | undefined } | { ok: false; reason: GoogleFailureReason };

/**
 * Completes Google sign-in from a callback route: the code and state are relayed to the
 * API server-side (they never reach browser script), and the session it returns becomes
 * this app's HttpOnly cookies. The API validates the state signature, expiry, nonce and
 * PKCE, so a forged or replayed callback cannot sign anyone in.
 */
export async function completeGoogleSignIn(
  ctx: ActionContext,
  input: {
    code?: string | undefined;
    state?: string | undefined;
    iss?: string | undefined;
    error?: string | undefined;
  },
): Promise<GoogleSignInOutcome> {
  if (input.error) return { ok: false, reason: 'denied' };

  // `iss` is part of the authorization response (RFC 9207) and the API checks it, so a
  // callback that receives one must forward it unchanged.
  const parsed = googleCallbackRequestSchema.safeParse({
    code: input.code,
    state: input.state,
    ...(input.iss ? { iss: input.iss } : {}),
  });
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  let result: AuthSession & { returnTo?: string | undefined };
  try {
    result = await ctx.api.completeGoogle(parsed.data);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'account_suspended') return { ok: false, reason: 'suspended' };
    if (code === 'invalid_credentials') return { ok: false, reason: 'denied' };
    if (code === 'invalid_code' || code === 'email_not_confirmed' || code === 'oauth_unavailable') {
      return { ok: false, reason: 'invalid' };
    }
    logFailure('google sign-in callback', error);
    return { ok: false, reason: 'unavailable' };
  }

  // The same checks as a password sign-in: the account must exist and be usable now.
  const established = await establish(ctx, result, {}, {});
  if (established.status !== 'success') {
    return {
      ok: false,
      reason: established.message === UNAVAILABLE_MESSAGE ? 'unavailable' : 'blocked',
    };
  }
  return { ok: true, returnTo: result.returnTo };
}

const CONFIRM_MESSAGES: Partial<Record<string, string>> = {
  invalid_confirmation_link:
    'This confirmation link is invalid, expired or already used. Try signing in, or register again to get a new link.',
  validation_failed:
    'This confirmation link is invalid, expired or already used. Try signing in, or register again to get a new link.',
  rate_limited: RATE_LIMITED_MESSAGE,
};

/**
 * Confirms the address behind a confirmation link. It leaves this browser's session
 * alone: the owner signs in with their password next, so a link someone else sends can
 * never sign the visitor in to the sender's account.
 */
export async function confirmEmail(ctx: ActionContext, formData: FormData): Promise<FormState> {
  if (!isTrustedForm(ctx, formData)) return FORM_EXPIRED;
  const parsed = confirmEmailRequestSchema.safeParse({ tokenHash: text(formData, 'tokenHash') });
  if (!parsed.success) {
    return { status: 'error', message: CONFIRM_MESSAGES.invalid_confirmation_link };
  }

  try {
    await ctx.api.confirmEmail(parsed.data.tokenHash);
    return { status: 'success' };
  } catch (error) {
    const code = errorCode(error);
    if (CONFIRM_MESSAGES[code] === undefined) logFailure('email confirmation', error);
    return { status: 'error', message: CONFIRM_MESSAGES[code] ?? UNAVAILABLE_MESSAGE };
  }
}

/** Revokes the session at the API; false when the token was not accepted. */
async function revoke(api: ApiClient, accessToken: string): Promise<boolean> {
  try {
    await api.logout(accessToken);
    return true;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) logFailure('sign-out', error);
    return false;
  }
}

/**
 * Ends the session: revokes it at the API (refreshing once if the access token has
 * lapsed), then clears this browser's cookies even if the API could not be reached.
 */
export async function signOut(ctx: ActionContext, formData: FormData): Promise<FormState> {
  if (!isTrustedForm(ctx, formData)) return FORM_EXPIRED;
  const { accessToken, refreshToken } = sessionTokens(ctx.jar, ctx.config);

  const revoked = accessToken !== undefined && (await revoke(ctx.api, accessToken));
  if (!revoked && refreshToken !== undefined) {
    const outcome = await refreshSessionOnce(ctx.api, refreshToken);
    if (outcome.kind === 'refreshed') await revoke(ctx.api, outcome.session.accessToken);
  }

  clearSessionCookies(ctx.jar, ctx.config);
  rotateCsrfCookie(ctx.jar, ctx.config);
  return { status: 'success' };
}

/**
 * Calls the API with the session's access token. On 401 it refreshes once (shared with
 * concurrent requests) and retries once; a refused refresh clears the session. There
 * is no loop: at most one refresh and one retry per call.
 */
export async function withAccessToken<T>(
  ctx: ActionContext,
  call: (accessToken: string) => Promise<T>,
): Promise<SessionRead<T>> {
  const { accessToken, refreshToken } = sessionTokens(ctx.jar, ctx.config);

  if (accessToken !== undefined) {
    try {
      return { kind: 'ok', value: await call(accessToken) };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }
  if (refreshToken === undefined) {
    clearSessionCookies(ctx.jar, ctx.config);
    return { kind: 'signed_out' };
  }

  const outcome = await refreshSessionOnce(ctx.api, refreshToken);
  if (outcome.kind === 'unavailable') return { kind: 'unavailable' };
  if (outcome.kind === 'rejected') {
    clearSessionCookies(ctx.jar, ctx.config);
    return { kind: 'signed_out' };
  }
  writeSessionCookies(ctx.jar, ctx.config, outcome.session);
  try {
    return { kind: 'ok', value: await call(outcome.session.accessToken) };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
    clearSessionCookies(ctx.jar, ctx.config);
    return { kind: 'signed_out' };
  }
}

/** What a Server Action's authenticated call produced; `untrusted` reached no API. */
export type SessionAct<T> = SessionRead<T> | { kind: 'untrusted' };

/**
 * An authenticated call for a Server Action. The form must be trusted first (exact
 * Origin and a CSRF token matching this browser's cookie); then withAccessToken runs
 * the call, refreshing and retrying once on 401. Errors other than 401 reach the
 * caller, which maps API error codes to its own messages.
 */
export async function actWithAccessToken<T>(
  ctx: ActionContext,
  formData: FormData,
  call: SessionCall<T>,
): Promise<SessionAct<T>> {
  if (!isTrustedForm(ctx, formData)) return { kind: 'untrusted' };
  return withAccessToken(ctx, (accessToken) => call(ctx.api, accessToken));
}

const PROFILE_MESSAGES: Partial<Record<string, string>> = {
  account_suspended: 'This account is suspended, so its profile cannot be changed.',
  validation_failed: 'Check your name and phone number, then try again.',
  rate_limited: RATE_LIMITED_MESSAGE,
};

/** Saves the fields customers may edit: name and phone. An empty field clears it. */
export async function updateProfile(ctx: ActionContext, formData: FormData): Promise<FormState> {
  const values = {
    fullName: text(formData, 'fullName').trim(),
    phone: text(formData, 'phone').trim(),
  };
  if (!isTrustedForm(ctx, formData)) return { ...FORM_EXPIRED, values };

  const parsed = updateProfileRequestSchema.safeParse({
    fullName: values.fullName || null,
    phone: values.phone || null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error, {
        fullName: 'Enter your name in 120 characters or fewer.',
      }),
      values,
    };
  }

  try {
    const result = await withAccessToken(ctx, (token) => ctx.api.updateMe(token, parsed.data));
    if (result.kind === 'signed_out') return { status: 'signed_out' };
    if (result.kind === 'unavailable')
      return { status: 'error', message: UNAVAILABLE_MESSAGE, values };
    const { profile } = result.value.user;
    return {
      status: 'success',
      message: 'Your profile has been saved.',
      values: { fullName: profile.fullName ?? '', phone: profile.phone ?? '' },
    };
  } catch (error) {
    const code = errorCode(error);
    if (PROFILE_MESSAGES[code] === undefined) logFailure('profile update', error);
    return { status: 'error', message: PROFILE_MESSAGES[code] ?? UNAVAILABLE_MESSAGE, values };
  }
}
