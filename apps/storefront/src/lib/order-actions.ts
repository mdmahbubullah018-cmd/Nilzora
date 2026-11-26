'use server';

import {
  orderNumberSchema,
  validationErrorDetailsSchema,
  type OrderResponse,
} from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState, type SessionAct } from '@nilzora/web-session';
import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { productTag } from '@/lib/catalog';
import { session } from '@/lib/session';

/*
 * Cancels one of the customer's own orders, which the API allows only while it is
 * still pending. The order number names the order and plays the part of an
 * idempotency key: repeating a cancellation changes nothing. Messages are fixed
 * strings. redirect() throws, so it is never called inside try/catch.
 */

const MAX_REASON_LENGTH = 300;

const NOT_CONFIRMED =
  "We could not confirm the cancellation. Reload the page to see the order's status, then try again if it is still awaiting confirmation.";

const CANCEL_MESSAGES: Partial<Record<string, string>> = {
  order_not_cancellable:
    'This order can no longer be cancelled. It may already be confirmed or cancelled; reload the page to see its status.',
  not_found: 'This order could not be found.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  account_suspended:
    'This account is suspended, so its orders cannot be changed. Contact Nilzora support for help.',
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function logFailure(error: unknown): void {
  if (error instanceof ApiError) {
    console.error('[nilzora] order cancellation failed', {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error('[nilzora] order cancellation failed unexpectedly');
  }
}

function reasonTooLong(values: Partial<Record<string, string>>): FormState {
  return {
    status: 'error',
    message: 'Check the highlighted field.',
    fieldErrors: { reason: `Keep the reason under ${MAX_REASON_LENGTH} characters.` },
    values,
  };
}

function failureState(error: unknown, values: Partial<Record<string, string>>): FormState {
  // No answer, a timeout or a server error: the cancellation may have been saved.
  if (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === 'invalid_response'
  ) {
    logFailure(error);
    return { status: 'error', message: NOT_CONFIRMED, values };
  }
  if (error.code === 'validation_failed') {
    const details = validationErrorDetailsSchema.safeParse(error.details);
    if (details.success && details.data.issues.some((issue) => issue.path === 'reason')) {
      return reasonTooLong(values);
    }
  }
  const message = CANCEL_MESSAGES[error.code];
  if (message === undefined) logFailure(error);
  return {
    status: 'error',
    message: message ?? 'This order could not be cancelled. Please try again.',
    values,
  };
}

export async function cancelOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reason = text(formData, 'reason').trim();
  const values = { reason };
  const orderNumber = orderNumberSchema.safeParse(text(formData, 'orderNumber'));
  if (!orderNumber.success) {
    return {
      status: 'error',
      message: 'This page has expired. Reload the page and try again.',
      values,
    };
  }
  if (reason.length > MAX_REASON_LENGTH) return reasonTooLong(values);

  const attempt: { result: SessionAct<OrderResponse> } | { error: unknown } = await session
    .act(formData, (api, accessToken) =>
      api.cancelOrder(accessToken, orderNumber.data, {
        reason: reason === '' ? undefined : reason,
      }),
    )
    .then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
  if ('error' in attempt) return failureState(attempt.error, values);

  const { result } = attempt;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') {
    redirect(`/login?next=/account/orders/${orderNumber.data}&session=expired`);
  }
  if (result.kind === 'unavailable') return { status: 'error', message: NOT_CONFIRMED, values };

  // The stock came back: product pages show it on their next request.
  for (const slug of new Set(result.value.order.items.map((item) => item.productSlug))) {
    updateTag(productTag(slug));
  }
  redirect(`/account/orders/${result.value.order.orderNumber}?cancelled=1`);
}
