'use server';

import {
  returnRequestSchema,
  validationErrorDetailsSchema,
  type ReturnResponse,
} from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState, type SessionAct } from '@nilzora/web-session';
import { redirect } from 'next/navigation';
import { session } from '@/lib/session';

/*
 * The customer's own returns. A request names an order by its number and the order lines by
 * their id and quantity; the API checks eligibility, that the order is the caller's, and
 * that no more than was bought comes back. Cancelling is allowed only while the request is
 * still waiting for a decision. Messages are fixed strings, and redirect() throws, so it is
 * never called inside try/catch.
 */

const NOT_CONFIRMED =
  'We could not confirm the return request. Reload the page to check whether it was saved before trying again.';

const RETURN_MESSAGES: Partial<Record<string, string>> = {
  return_not_eligible:
    'This order cannot be returned. Returns are accepted for delivered orders within the return window.',
  return_quantity_exceeded: 'You asked to return more units than this order contains.',
  return_closed: 'This return has already moved on and can no longer be changed.',
  not_found: 'That return could not be found.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  account_suspended:
    'This account is suspended, so it cannot request a return. Contact Nilzora support for help.',
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function logFailure(error: unknown, step: string): void {
  if (error instanceof ApiError) {
    console.error(`[nilzora] ${step} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error(`[nilzora] ${step} failed unexpectedly`);
  }
}

function failureState(error: unknown, values: Record<string, string>, step: string): FormState {
  if (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === 'invalid_response'
  ) {
    logFailure(error, step);
    return { status: 'error', message: NOT_CONFIRMED, values };
  }
  if (error.code === 'validation_failed') {
    const details = validationErrorDetailsSchema.safeParse(error.details);
    if (details.success) {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: Object.fromEntries(
          details.data.issues.map((issue) => [issue.path, issue.message]),
        ),
        values,
      };
    }
  }
  const message = RETURN_MESSAGES[error.code];
  if (message === undefined) logFailure(error, step);
  return {
    status: 'error',
    message: message ?? 'The return request could not be saved. Please try again.',
    values,
  };
}

/** Reads the per-line quantities the form offers; a blank or zero row means "not returned". */
function requestedItems(formData: FormData): { orderItemId: number; quantity: number }[] {
  const items: { orderItemId: number; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith('quantity-') || typeof value !== 'string') continue;
    const orderItemId = Number(name.slice('quantity-'.length));
    const quantity = Number(value.trim());
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    items.push({ orderItemId, quantity });
  }
  return items;
}

export async function requestReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reason = text(formData, 'reason').trim();
  const description = text(formData, 'description').trim();
  const values = { reason, description, orderNumber: text(formData, 'orderNumber') };
  const items = requestedItems(formData);
  if (items.length === 0) {
    return {
      status: 'error',
      message: 'Choose how many units of at least one item you are sending back.',
      values,
    };
  }
  const request = returnRequestSchema.safeParse({
    orderNumber: values.orderNumber,
    items,
    reason,
    ...(description === '' ? {} : { description }),
  });
  if (!request.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: Object.fromEntries(
        request.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
      ),
      values,
    };
  }

  const attempt: { result: SessionAct<ReturnResponse> } | { error: unknown } = await session
    .act(formData, (api, accessToken) => api.requestReturn(accessToken, request.data))
    .then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
  if ('error' in attempt) return failureState(attempt.error, values, 'return request');

  const { result } = attempt;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') {
    redirect(`/login?next=/account/returns&session=expired`);
  }
  if (result.kind === 'unavailable') {
    return { status: 'error', message: NOT_CONFIRMED, values };
  }

  redirect(`/account/returns/${result.value.return.id}?requested=1`);
}

export async function cancelReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = text(formData, 'returnId');
  if (returnId === '') {
    return { status: 'error', message: 'This page has expired. Reload it and try again.' };
  }

  const attempt: { result: SessionAct<void> } | { error: unknown } = await session
    .act(formData, (api, accessToken) => api.cancelMyReturn(accessToken, returnId))
    .then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
  if ('error' in attempt) return failureState(attempt.error, {}, 'return cancellation');

  const { result } = attempt;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED };
  if (result.kind === 'signed_out') {
    redirect(`/login?next=/account/returns/${returnId}&session=expired`);
  }
  if (result.kind === 'unavailable') {
    return { status: 'error', message: NOT_CONFIRMED };
  }

  redirect(`/account/returns/${returnId}?cancelled=1`);
}
