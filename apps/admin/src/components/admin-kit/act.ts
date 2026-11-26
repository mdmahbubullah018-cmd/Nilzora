import 'server-only';
import type { ApiErrorCode } from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState, type SessionCall } from '@nilzora/web-session';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { session } from '@/lib/session';
import { signInPath } from '@/lib/workspace-access';

/*
 * The write side of the admin kit, for Server Actions (adminRead is the read side).
 * Server Actions are public POST endpoints: session.act() refuses a form without this
 * app's Origin and CSRF token before any API call, and the API authorises the change
 * itself. Only fixed messages chosen here return to the browser, never API text.
 */

/** What an admin form action returns to its form (useActionState). */
export type ActionState = FormState;

/** A change that may have been saved even though no answer arrived. */
export const UNCONFIRMED_MESSAGE =
  'Nilzora could not be reached, so the change could not be confirmed. Reload the page to check before trying again.';

/** Answers every admin action shares; each action adds or overrides its own. */
const COMMON_MESSAGES: Partial<Record<string, string>> = {
  forbidden: 'Your account does not have permission to do this.',
  not_found: 'This record no longer exists, or your account cannot see it.',
  rate_limited: 'Too many changes in a short time. Wait a minute, then try again.',
  validation_failed: 'Some of the details were refused. Check them and try again.',
  bad_request: 'Some of the details were refused. Check them and try again.',
  account_suspended: 'Your account is suspended, so it cannot make changes.',
  account_unavailable: 'Your account cannot make changes right now. Contact the store owner.',
  service_unavailable: UNCONFIRMED_MESSAGE,
};

export interface AdminActOptions {
  /** The page to come back to after signing in again (a fixed app path). */
  returnTo: Route;
  /** Names the action in the server log, e.g. "order status change". */
  label: string;
  /** Messages for this action's API error codes. */
  messages?: Partial<Record<ApiErrorCode, string>>;
}

export type AdminActResult<T> =
  | { ok: true; value: T }
  /** `code` and `details`: the API's error code and details, when the API refused the change. */
  | { ok: false; state: ActionState; code?: string; details?: unknown };

/** Logs what helps an operator (code, status, request id) and nothing secret. */
function logFailure(label: string, error: unknown): void {
  if (error instanceof ApiError) {
    console.error(`[nilzora] ${label} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error(`[nilzora] ${label} failed unexpectedly`);
  }
}

/** The fixed message for a failed call. */
export function failureMessage(
  error: unknown,
  messages: Partial<Record<string, string>> = {},
): string {
  if (error instanceof ApiError) {
    return messages[error.code] ?? COMMON_MESSAGES[error.code] ?? UNCONFIRMED_MESSAGE;
  }
  return UNCONFIRMED_MESSAGE;
}

/**
 * An authenticated API change for a Server Action. An untrusted form reaches no API
 * (`FORM_EXPIRED`); a lapsed session goes to sign in and back to `returnTo`; every
 * refusal becomes a fixed message.
 *
 *   const result = await adminAct(formData, (api, token) => api.adminGetOrder(token, n), {
 *     returnTo: '/admin/orders', label: 'order read',
 *   });
 *   if (!result.ok) return result.state;
 */
export async function adminAct<T>(
  formData: FormData,
  call: SessionCall<T>,
  options: AdminActOptions,
): Promise<AdminActResult<T>> {
  let outcome;
  try {
    outcome = await session.act(formData, call);
  } catch (error) {
    // An expected refusal (a 4xx with its own message) is not worth a log line.
    const expected =
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      (options.messages?.[error.code as ApiErrorCode] ?? COMMON_MESSAGES[error.code]);
    if (!expected) logFailure(options.label, error);
    return {
      ok: false,
      state: { status: 'error', message: failureMessage(error, options.messages) },
      ...(error instanceof ApiError ? { code: error.code, details: error.details } : {}),
    };
  }
  // Outside the try: redirect() works by throwing.
  if (outcome.kind === 'signed_out') redirect(signInPath(options.returnTo));
  if (outcome.kind === 'untrusted') return { ok: false, state: FORM_EXPIRED };
  if (outcome.kind === 'unavailable') {
    return { ok: false, state: { status: 'error', message: UNCONFIRMED_MESSAGE } };
  }
  return { ok: true, value: outcome.value };
}

/** A form field as text ('' when missing or a file). */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** A refused form, with a message per field. */
export function invalid(
  message: string,
  fieldErrors: Partial<Record<string, string>> = {},
  values?: Partial<Record<string, string>>,
): ActionState {
  return { status: 'error', message, fieldErrors, ...(values ? { values } : {}) };
}

/**
 * Taka typed into a form ("1250", "1,250.50", "৳ 80") as poisha, or undefined when it
 * is not an amount with at most two decimals.
 */
export function takaToMinor(text: string): number | undefined {
  const cleaned = text.replace(/[৳,\s]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match?.[1]) return undefined;
  const poisha = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(poisha);
}
