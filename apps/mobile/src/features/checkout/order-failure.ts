import { ApiError } from '@nilzora/api-client';
import { moneyMinorSchema, validationErrorDetailsSchema } from '@nilzora/contracts';
import { SessionEndedError } from '@/auth/session-manager';
import { ApiNotConfiguredError, describeApiError } from '@/lib/errors';
import { formatMoney } from '@/lib/money';

/*
 * What a refused or failed "place order" means for the customer and for the next attempt.
 * Every message is a fixed string chosen here (or in describeApiError), never the API's own
 * text. The `kind` tells the screen what to refresh and whether the idempotency key stays.
 */

export type OrderFailureKind =
  /** No answer, a timeout or a 5xx: the order may exist. Retry with the same key. */
  | 'outcome_unknown'
  /** The total differs from the one reviewed. */
  | 'price_changed'
  /** Stock, availability or per-order limits: the cart needs fixing. */
  | 'cart_problem'
  | 'address_missing'
  | 'delivery_unavailable'
  | 'rate_limited'
  | 'too_many_pending'
  /** The key already belongs to an order with different details. */
  | 'key_conflict'
  | 'note_invalid'
  /** The API replayed an earlier order for this key, and that order was cancelled. */
  | 'earlier_cancelled'
  | 'session_ended'
  | 'account_blocked'
  | 'rejected';

export interface OrderFailure {
  kind: OrderFailureKind;
  title: string;
  message: string;
  /** The order may exist, so the next attempt must reuse the same idempotency key. */
  keepKey: boolean;
  /** What to reload so the customer sees the current state. */
  refresh: 'none' | 'quote' | 'addresses' | 'store';
  /** The new total of a `price_changed` refusal, when the API sent one. */
  newTotalMinor?: number;
}

export const MAX_NOTE_LENGTH = 500;

const CART_CODES = new Set([
  'insufficient_stock',
  'product_unavailable',
  'quantity_limit_exceeded',
  'cart_invalid',
]);
const ACCOUNT_CODES = new Set(['account_suspended', 'account_unavailable', 'forbidden']);

function failure(
  kind: OrderFailureKind,
  title: string,
  message: string,
  extra: Partial<Pick<OrderFailure, 'keepKey' | 'refresh' | 'newTotalMinor'>> = {},
): OrderFailure {
  return { kind, title, message, keepKey: false, refresh: 'none', ...extra };
}

/** The new total sent with `price_changed` (details.totalMinor), when present and well formed. */
function changedTotal(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null || !('totalMinor' in details)) {
    return undefined;
  }
  const parsed = moneyMinorSchema.safeParse(details.totalMinor);
  return parsed.success ? parsed.data : undefined;
}

function noteRejected(details: unknown): boolean {
  const parsed = validationErrorDetailsSchema.safeParse(details);
  return parsed.success && parsed.data.issues.some((issue) => issue.path === 'note');
}

/**
 * The order may have been saved even though the answer did not arrive: no response, a
 * timeout, a server error or an answer that could not be read. Anything unexpected thrown
 * after the request was sent (a parsing bug, say) is just as unknown. Only a session that
 * ended or a build without an API address are known not to have sent anything.
 */
export function outcomeUnknown(error: unknown): boolean {
  if (error instanceof SessionEndedError || error instanceof ApiNotConfiguredError) return false;
  if (error instanceof ApiError) {
    return error.status === 0 || error.status >= 500 || error.code === 'invalid_response';
  }
  return true;
}

/**
 * The API answered a repeat with the order saved earlier under the same key, and that order
 * has since been cancelled. Nothing new was placed and the cart is left as it is.
 */
export function earlierOrderCancelled(): OrderFailure {
  return failure(
    'earlier_cancelled',
    'Earlier order cancelled',
    'That earlier order was cancelled. Place the order again to reorder.',
  );
}

export function interpretOrderError(error: unknown): OrderFailure {
  if (outcomeUnknown(error)) {
    return failure(
      'outcome_unknown',
      'We could not confirm your order',
      'Your order may already be placed: check your orders first. Trying again from here will not create a second order.',
      { keepKey: true },
    );
  }

  const described = describeApiError(error);
  if (error instanceof SessionEndedError) {
    return failure('session_ended', described.title, described.message);
  }
  if (!(error instanceof ApiError)) return failure('rejected', described.title, described.message);

  if (error.status === 401) return failure('session_ended', described.title, described.message);
  if (ACCOUNT_CODES.has(error.code)) {
    return failure('account_blocked', described.title, described.message);
  }
  if (CART_CODES.has(error.code)) {
    return failure('cart_problem', described.title, described.message, { refresh: 'quote' });
  }

  switch (error.code) {
    case 'price_changed': {
      const newTotalMinor = changedTotal(error.details);
      return failure(
        'price_changed',
        'The total has changed',
        newTotalMinor === undefined
          ? 'Prices or delivery changed since you reviewed your order. Review the updated order, then place it again.'
          : `The total is now ${formatMoney(newTotalMinor)}. Review the updated order, then place it again.`,
        { refresh: 'quote', ...(newTotalMinor === undefined ? {} : { newTotalMinor }) },
      );
    }
    case 'address_not_found':
      return failure(
        'address_missing',
        'Address not found',
        'This delivery address is no longer saved. Choose another address.',
        { refresh: 'addresses' },
      );
    case 'delivery_unavailable':
      return failure(
        'delivery_unavailable',
        described.title,
        'Delivery is not available for this address yet. Choose another address.',
        { refresh: 'quote' },
      );
    case 'too_many_pending_orders':
      return failure('too_many_pending', described.title, described.message);
    case 'idempotency_conflict':
      return failure(
        'key_conflict',
        'This order was changed',
        'This checkout was already used for an order with different details. Check your orders first; placing the order again starts a fresh checkout.',
      );
    case 'validation_failed':
      if (noteRejected(error.details)) {
        return failure(
          'note_invalid',
          'Check your note',
          `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
        );
      }
      return failure(
        'rejected',
        'Your order could not be placed',
        'Check your details, then try again.',
      );
    case 'rate_limited':
      return failure('rate_limited', described.title, described.message);
    case 'payment_unavailable':
      // The database refused because cash on delivery is switched off. The quote itself is
      // still valid, so only the store's payment switch has to be re-read.
      return failure(
        'rejected',
        'Your order was not placed',
        'Cash on delivery is switched off right now. Nothing was charged, and your cart is unchanged. Please try again later.',
        { refresh: 'store' },
      );
    default:
      return failure('rejected', described.title, described.message);
  }
}
