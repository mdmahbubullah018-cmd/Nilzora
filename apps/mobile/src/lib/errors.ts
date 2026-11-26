import { ApiError } from '@nilzora/api-client';
import { SessionEndedError } from '@/auth/session-manager';

/*
 * Errors
 * ------
 * Turns whatever a failed call threw into text a customer can act on. Every message is a
 * fixed string chosen here, never the API's own text, so internals and request details
 * cannot leak onto a screen. Business refusals (stock, price, delivery) are explained in
 * the words the storefront uses.
 */

/** Thrown when an API call is attempted in a build that has no valid API address. */
export class ApiNotConfiguredError extends Error {
  override readonly name = 'ApiNotConfiguredError';

  constructor() {
    super('This build has no valid API address (EXPO_PUBLIC_API_BASE_URL)');
  }
}

export interface DescribedError {
  title: string;
  message: string;
  /** Whether trying the same thing again can succeed (a connection or server problem). */
  retryable: boolean;
}

const RETRY_LATER = 'Please try again in a moment.';

/** What the customer should do next, by API error code. */
const BY_CODE: Partial<Record<string, DescribedError>> = {
  network_error: {
    title: 'Nilzora could not be reached',
    message: 'Check your internet connection, then try again.',
    retryable: true,
  },
  timeout: {
    title: 'This is taking too long',
    message: 'The connection is slow or unavailable. Check it, then try again.',
    retryable: true,
  },
  rate_limited: {
    title: 'Too many requests',
    message: 'Please wait a minute before trying again.',
    retryable: true,
  },
  service_unavailable: {
    title: 'Nilzora is unavailable right now',
    message: RETRY_LATER,
    retryable: true,
  },
  payment_unavailable: {
    title: 'Checkout is temporarily unavailable',
    message: 'No payment method is available right now. Nothing was charged; please try again later.',
    retryable: false,
  },
  auth_unavailable: {
    title: 'Nilzora is unavailable right now',
    message: RETRY_LATER,
    retryable: true,
  },
  internal_error: {
    title: 'Something went wrong on our side',
    message: RETRY_LATER,
    retryable: true,
  },
  unauthenticated: {
    title: 'Your session has ended',
    message: 'Please sign in again to continue.',
    retryable: false,
  },
  invalid_refresh_token: {
    title: 'Your session has ended',
    message: 'Please sign in again to continue.',
    retryable: false,
  },
  account_suspended: {
    title: 'Account suspended',
    message: 'This account is suspended. Contact Nilzora support for help.',
    retryable: false,
  },
  account_unavailable: {
    title: 'Account unavailable',
    message: 'This account cannot be used right now. Contact Nilzora support.',
    retryable: false,
  },
  forbidden: {
    title: 'Not allowed',
    message: 'Your account cannot do this.',
    retryable: false,
  },
  not_found: {
    title: 'Not found',
    message: 'We could not find what you were looking for. It may have been removed.',
    retryable: false,
  },
  address_not_found: {
    title: 'Address not found',
    message: 'Choose one of your saved delivery addresses.',
    retryable: false,
  },
  address_limit_reached: {
    title: 'Address limit reached',
    message: 'Remove a saved address before adding another.',
    retryable: false,
  },
  validation_failed: {
    title: 'Check your details',
    message: 'Some details were not accepted. Check them and try again.',
    retryable: false,
  },
  bad_request: {
    title: 'Check your details',
    message: 'Some details were not accepted. Check them and try again.',
    retryable: false,
  },
  cart_invalid: {
    title: 'Your cart cannot be ordered',
    message: 'Check the items and quantities in your cart.',
    retryable: false,
  },
  product_unavailable: {
    title: 'An item is no longer available',
    message: 'Remove the unavailable items from your cart to continue.',
    retryable: false,
  },
  insufficient_stock: {
    title: 'Not enough stock',
    message: 'Some items have fewer units left than you chose. Adjust your cart to continue.',
    retryable: false,
  },
  quantity_limit_exceeded: {
    title: 'Quantity limit reached',
    message: 'Some items exceed the most you can order at once. Adjust your cart to continue.',
    retryable: false,
  },
  delivery_unavailable: {
    title: 'Delivery not available',
    message: 'We cannot deliver to this address yet. Choose another address.',
    retryable: false,
  },
  price_changed: {
    title: 'The total has changed',
    message: 'Prices or delivery changed since you reviewed your order. Review it and try again.',
    retryable: false,
  },
  idempotency_conflict: {
    title: 'This order was changed',
    message: 'Go back, review your order, and place it again.',
    retryable: false,
  },
  too_many_pending_orders: {
    title: 'Too many orders waiting',
    message: 'Wait until your current orders are confirmed before placing another.',
    retryable: false,
  },
  order_not_cancellable: {
    title: 'This order cannot be cancelled',
    message: 'It has already been confirmed or is on its way.',
    retryable: false,
  },
};

const NOT_CONFIGURED: DescribedError = {
  title: 'Nilzora is not set up',
  message: 'This build has no valid API address, so it cannot reach Nilzora.',
  retryable: false,
};

const SESSION_ENDED: DescribedError = {
  title: 'Your session has ended',
  message: 'Please sign in again to continue.',
  retryable: false,
};

const SERVER_FAULT: DescribedError = {
  title: 'Something went wrong on our side',
  message: RETRY_LATER,
  retryable: true,
};

const UNKNOWN: DescribedError = {
  title: 'Something went wrong',
  message: 'Please try again. If it keeps happening, contact Nilzora support.',
  retryable: true,
};

/** True when the session is over: the user must sign in again before retrying anything. */
export function isSessionEnded(error: unknown): boolean {
  if (error instanceof SessionEndedError) return true;
  return error instanceof ApiError && error.status === 401;
}

/**
 * Failures worth retrying automatically: the connection (network, timeout) or the server
 * (5xx). Everything else, including every 4xx, repeats with the same outcome.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return error.code === 'network_error' || error.code === 'timeout';
  return error.status >= 500;
}

/** A title, a message and whether trying again can help, for any error a call can throw. */
export function describeApiError(error: unknown): DescribedError {
  if (error instanceof ApiNotConfiguredError) return NOT_CONFIGURED;
  if (error instanceof SessionEndedError) return SESSION_ENDED;
  if (!(error instanceof ApiError)) return UNKNOWN;

  const known = BY_CODE[error.code];
  if (known !== undefined) return known;
  if (isSessionEnded(error)) return SESSION_ENDED;
  if (error.status === 404) return BY_CODE.not_found ?? UNKNOWN;
  if (error.status === 429) return BY_CODE.rate_limited ?? UNKNOWN;
  if (error.status >= 500) return SERVER_FAULT;
  if (error.status >= 400 && error.status < 500) {
    return {
      title: 'This could not be completed',
      message: 'Check your details and try again.',
      retryable: false,
    };
  }
  // `invalid_response` and anything else unexpected: not caused by the customer.
  return UNKNOWN;
}
