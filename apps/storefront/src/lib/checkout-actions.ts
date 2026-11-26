'use server';

import {
  moneyMinorSchema,
  orderConfirmationPendingDetailsSchema,
  placeOrderRequestSchema,
  validationErrorDetailsSchema,
  type OrderDetail,
  type PlaceOrderResponse,
} from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState, type SessionAct } from '@nilzora/web-session';
import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCart } from '@/lib/cart';
import { ORDER_NOT_CONFIRMED } from '@/lib/checkout-messages';
import { formatMoney } from '@/lib/format';
import { productTag } from '@/lib/catalog';
import { recordCheckoutConverted } from '@/lib/saved-cart';
import { session } from '@/lib/session';

/*
 * Places the Cash-on-Delivery order from the checkout page. What to buy comes only
 * from the cart cookie, never from form fields; the API prices it again inside the
 * order transaction and compares the total with expectedTotalMinor, the total the
 * customer reviewed. The idempotencyKey names this checkout attempt: every error
 * echoes it back so a retry (with or without JavaScript) reuses it, and only a placed
 * order or a fresh checkout page brings a new one. Messages are fixed strings; the
 * API's own messages are never shown. redirect() throws, so it is never called inside
 * try/catch.
 *
 * An answer that never arrives is not a failure: the order may be saved. So the same
 * request (same key, same total) is sent again, which the API answers with the order it
 * already has instead of creating another; and an order the API says it saved but could not
 * read back is fetched by its own number. The customer only hears "we could not confirm"
 * when all of that fails.
 */

const MAX_NOTE_LENGTH = 500;
const SIGN_IN_AGAIN = '/login?next=/checkout&session=expired';

/** The first request and two safe retries of exactly the same one. */
const PLACE_ATTEMPTS = 3;
/** Waits between attempts: brief, so a slow answer is not followed by a long stare. */
const RETRY_DELAYS_MS = [250, 900];

// The order may still exist (the answer can be lost after it is saved). Trying again from
// this page reuses its key, so it can never create a second order.
const NOT_PLACED = 'Your order could not be placed. Check the details below, then try again.';
const CHECKOUT_EXPIRED = 'This checkout page has expired. Reload the page and try again.';

/** Refusals whose fixed message is all the customer needs; the attempt keeps its key. */
const ORDER_MESSAGES: Partial<Record<string, string>> = {
  delivery_unavailable: 'Delivery is not available for this address yet. Choose another address.',
  too_many_pending_orders:
    'You already have several orders waiting for confirmation. You can place another once one of them is confirmed.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  account_suspended:
    'This account is suspended, so it cannot place orders. Contact Nilzora support for help.',
  payment_unavailable:
    'Cash on delivery is switched off right now, so this order was not placed. Nothing has been charged and your cart is still here.',
};

/** Cart refusals: the customer goes back to the cart, which explains what changed. */
const CART_ISSUES: Partial<Record<string, string>> = {
  insufficient_stock: 'stock',
  product_unavailable: 'unavailable',
  quantity_limit_exceeded: 'limit',
  cart_invalid: 'invalid',
  // A line without a variant it needs, or with one the product does not have: the cart says so.
  variant_required: 'options',
  variant_invalid: 'options',
};

type Values = Partial<Record<string, string>>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** An amount in poisha from a hidden field, or undefined when malformed. */
function amount(value: string): number | undefined {
  if (!/^\d{1,16}$/.test(value)) return undefined;
  const parsed = moneyMinorSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : undefined;
}

/** Logs what helps an operator (code, status, request id) and nothing personal. */
function logFailure(error: unknown): void {
  if (error instanceof ApiError) {
    console.error('[nilzora] order placement failed', {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error('[nilzora] order placement failed unexpectedly');
  }
}

/**
 * No answer, a timeout, a server error or an answer that could not be read: the order
 * may have been saved, so the customer retries with the same key and gets that order.
 */
function outcomeUnknown(error: ApiError): boolean {
  return error.status === 0 || error.status >= 500 || error.code === 'invalid_response';
}

/** The new total sent with price_changed, when present and well formed. */
function changedTotal(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null || !('totalMinor' in details)) {
    return undefined;
  }
  const parsed = moneyMinorSchema.safeParse(details.totalMinor);
  return parsed.success ? parsed.data : undefined;
}

/** Whether the API refused the note itself (the only field the customer typed). */
function noteRejected(details: unknown): boolean {
  const parsed = validationErrorDetailsSchema.safeParse(details);
  return parsed.success && parsed.data.issues.some((issue) => issue.path === 'note');
}

/** Maps a refused order to the form's message. Cart problems are handled by the caller. */
function failureState(error: unknown, values: Values): FormState {
  if (!(error instanceof ApiError) || outcomeUnknown(error)) {
    logFailure(error);
    return { status: 'error', message: ORDER_NOT_CONFIRMED, values };
  }

  switch (error.code) {
    case 'price_changed': {
      // Show the updated prices; the form then carries the new total to confirm.
      refresh();
      const total = changedTotal(error.details);
      return {
        status: 'error',
        message:
          total === undefined
            ? 'The total has changed since you reviewed your order. Check the updated order, then place it again.'
            : `The total has changed to ${formatMoney(total)} since you reviewed your order. Check the updated order, then place it again.`,
        values,
      };
    }
    case 'idempotency_conflict':
      // This attempt's key already belongs to another order, so the next one starts
      // afresh: no key is echoed and the re-rendered page brings a new one.
      refresh();
      return {
        status: 'error',
        message:
          'This checkout was already used for an order with different details. Check your orders first; placing this order again starts a fresh checkout.',
        values: { note: values.note },
      };
    case 'address_not_found':
      // The re-rendered page falls back to a saved address.
      refresh();
      return {
        status: 'error',
        message: 'This delivery address is no longer saved. Choose another address.',
        values,
      };
    case 'validation_failed':
      if (noteRejected(error.details)) {
        return {
          status: 'error',
          message: 'Check the highlighted field.',
          fieldErrors: { note: `Keep the note under ${MAX_NOTE_LENGTH} characters.` },
          values,
        };
      }
      logFailure(error);
      return { status: 'error', message: NOT_PLACED, values };
    default: {
      // A refused payment method means the store's switch changed under this page: re-render
      // so checkout shows its closed state instead of the same button.
      if (error.code === 'payment_unavailable') refresh();
      const message = ORDER_MESSAGES[error.code];
      if (message === undefined) logFailure(error);
      return { status: 'error', message: message ?? NOT_PLACED, values };
    }
  }
}

function cartIssueOf(error: unknown): string | undefined {
  return error instanceof ApiError ? CART_ISSUES[error.code] : undefined;
}

export async function placeOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const keyField = placeOrderRequestSchema.shape.idempotencyKey.safeParse(
    text(formData, 'idempotencyKey'),
  );
  const note = text(formData, 'note').trim();
  // A malformed key is not worth keeping: the reloaded page brings a valid one.
  const addressField = placeOrderRequestSchema.shape.addressId.safeParse(
    text(formData, 'addressId'),
  );
  // The address is echoed so the form can drop a message once another address is chosen.
  const values: Values = {
    ...(keyField.success ? { idempotencyKey: keyField.data } : {}),
    ...(addressField.success ? { addressId: addressField.data } : {}),
    note,
  };
  const expectedTotalMinor = amount(text(formData, 'expectedTotalMinor'));
  // The code the customer reviewed. The order transaction resolves it again, so an
  // expired or exhausted coupon fails the checkout instead of charging full price.
  const couponField = placeOrderRequestSchema.shape.couponCode.safeParse(
    text(formData, 'couponCode'),
  );
  // Only an outdated or altered page lacks these; nothing is sent.
  if (!keyField.success || !addressField.success || expectedTotalMinor === undefined) {
    return { status: 'error', message: CHECKOUT_EXPIRED, values };
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fieldErrors: { note: `Keep the note under ${MAX_NOTE_LENGTH} characters.` },
      values,
    };
  }

  // What to buy is read here, from the cart cookie, never from the form.
  const items = parseCart(await session.cartCookie.get());
  if (items.length === 0) redirect('/cart');

  const request = {
    idempotencyKey: keyField.data,
    addressId: addressField.data,
    items,
    ...(note === '' ? {} : { note }),
    expectedTotalMinor,
    ...(couponField.success && couponField.data !== undefined
      ? { couponCode: couponField.data }
      : {}),
  };
  const send = () =>
    session
      .act(formData, (api, accessToken) => api.placeOrder(accessToken, request))
      .then(
        (result): Attempt => ({ result }),
        (error: unknown): Attempt => ({ error }),
      );

  let attempt = await send();
  for (let round = 1; round < PLACE_ATTEMPTS && answerIsUncertain(attempt); round += 1) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[round - 1] ?? 900));
    attempt = await send();
  }

  if ('error' in attempt) {
    // The order was saved and only its read-back failed: it is named, so open it rather
    // than asking the customer to order again.
    const saved = await savedOrderOf(attempt.error);
    if (saved !== null) return finish(saved);
    const issue = cartIssueOf(attempt.error);
    if (issue !== undefined) redirect(`/cart?issue=${issue}`);
    return failureState(attempt.error, values);
  }

  const { result } = attempt;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') redirect(SIGN_IN_AGAIN);
  if (result.kind === 'unavailable')
    return { status: 'error', message: ORDER_NOT_CONFIRMED, values };

  return finish(result.value.order);
}

/** An answer that may not say whether an order exists. */
type Attempt = { result: SessionAct<PlaceOrderResponse> } | { error: unknown };

/**
 * Whether another attempt could still settle this one. A refusal (wrong total, no stock, a
 * used key) is final: sending it again would only repeat it. A missing answer, a server
 * error or an answer that could not be read may hide a saved order, so the same request is
 * sent again — the key makes that a replay, never a second order.
 */
function answerIsUncertain(attempt: Attempt): boolean {
  if ('error' in attempt) return errorIsUncertain(attempt.error);
  return attempt.result.kind === 'unavailable';
}

function errorIsUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  // The order exists and is named: reading it back is cheaper than replaying the order.
  if (error.code === 'order_confirmation_pending') return false;
  return error.status === 0 || error.status >= 500 || error.code === 'invalid_response';
}

/**
 * The order the API says it saved, when it could not answer in full. Reading it by its own
 * number is a plain read of the caller's own order: it settles the uncertainty without
 * touching the cart, stock or the idempotency key.
 */
async function savedOrderOf(error: unknown): Promise<OrderDetail | null> {
  if (!(error instanceof ApiError) || error.code !== 'order_confirmation_pending') return null;
  const details = orderConfirmationPendingDetailsSchema.safeParse(error.details);
  if (!details.success) return null;
  const read = await session.read((api, accessToken) =>
    api.getOrder(accessToken, details.data.orderNumber),
  );
  return read.kind === 'ok' ? read.value.order : null;
}

/**
 * A placed order — now or with this key earlier — ends the checkout: the cart is emptied,
 * the attempt converts and the receipt opens.
 */
async function finish(order: OrderDetail): Promise<FormState> {
  await session.cartCookie.clear();
  // Only a real order converts the attempt: the API looks the number up against this
  // customer's own orders, so a failed or refused checkout never reaches here.
  await recordCheckoutConverted(order.orderNumber);
  // Stock moved: product pages show fresh availability on their next request. Listings
  // keep their minute-long cache (refreshing them on every order would defeat it); the
  // API checks stock again at checkout, so a stale "in stock" there costs nothing.
  for (const slug of new Set(order.items.map((item) => item.productSlug))) {
    updateTag(productTag(slug));
  }
  // A placed order opens its receipt: the paper is the confirmation, and it is the same
  // document the customer can reopen from the order list later.
  redirect(`/account/orders/${order.orderNumber}/receipt?placed=1`);
}
