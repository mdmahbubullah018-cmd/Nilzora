import { MAX_ADDRESSES, type ApiErrorCode } from '@nilzora/contracts';
import type { RequestHandler, Response } from 'express';
import { sendError } from '../../http/send-error';
import { CommerceRefusalError, type CommerceRefusal } from './errors';

/** Short shared caching for public catalog reads; prices and stock are re-checked at checkout. */
export const PUBLIC_CATALOG_CACHE = 'public, max-age=60';

/**
 * Marks every response of a route, including 401/403/4xx errors, as uncacheable.
 * Mounted first on routes that serve personal data or live prices.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const REFUSALS: Record<CommerceRefusal, [number, ApiErrorCode, string]> = {
  order_not_found: [404, 'not_found', 'Order not found'],
  account_suspended: [403, 'account_suspended', 'This account is suspended'],
  address_not_found: [400, 'address_not_found', 'Choose one of your saved delivery addresses'],
  cart_invalid: [400, 'cart_invalid', 'The cart is invalid'],
  product_unavailable: [
    409,
    'product_unavailable',
    'Some products in your cart are no longer available',
  ],
  insufficient_stock: [409, 'insufficient_stock', 'Some products do not have enough stock'],
  quantity_limit_exceeded: [
    409,
    'quantity_limit_exceeded',
    'Some quantities are above the per-order limit',
  ],
  idempotency_conflict: [
    409,
    'idempotency_conflict',
    'This checkout was already submitted with different details. Review your order and try again.',
  ],
  delivery_unavailable: [
    409,
    'delivery_unavailable',
    'Delivery is not available for this address yet',
  ],
  price_changed: [
    409,
    'price_changed',
    'Your order total has changed. Review the new total before placing the order.',
  ],
  order_not_cancellable: [409, 'order_not_cancellable', 'This order can no longer be cancelled'],
  too_many_pending_orders: [
    409,
    'too_many_pending_orders',
    'You have too many orders waiting for confirmation. Try again once one is confirmed.',
  ],
  address_limit_reached: [
    409,
    'address_limit_reached',
    `You can keep up to ${MAX_ADDRESSES} addresses. Remove one to add another.`,
  ],
  payment_unavailable: [
    409,
    'payment_unavailable',
    'Cash on delivery is not available right now. Please try again later.',
  ],
  coupon_invalid: [400, 'coupon_invalid', 'This coupon code is not valid'],
  coupon_unavailable: [409, 'coupon_unavailable', 'This coupon cannot be used right now'],
  coupon_min_order: [409, 'coupon_min_order', 'Your cart is below the minimum this coupon needs'],
  coupon_exhausted: [409, 'coupon_exhausted', 'This coupon has no uses left'],
  voucher_unavailable: [
    409,
    'voucher_unavailable',
    'This voucher cannot be used here. Check that you collected it and that your cart meets its conditions.',
  ],
  variant_required: [400, 'variant_required', 'Choose an option for every product that has them'],
  variant_invalid: [409, 'variant_invalid', 'One of the chosen options is no longer sold'],
  variant_sku_taken: [409, 'variant_sku_taken', 'This SKU is already used'],
  return_not_eligible: [
    409,
    'return_not_eligible',
    'Only delivered orders inside the return window can be returned',
  ],
  return_quantity_exceeded: [
    409,
    'return_quantity_exceeded',
    'More items were chosen than can still be returned',
  ],
  return_closed: [409, 'return_closed', 'This return can no longer be changed'],
  refund_exceeds_balance: [
    409,
    'refund_exceeds_balance',
    'The amount is more than this order can still refund',
  ],
  refund_not_decidable: [
    409,
    'refund_not_decidable',
    'This refund is no longer waiting for a decision',
  ],
  refund_not_completable: [
    409,
    'refund_not_completable',
    'Approve the refund before recording the payout',
  ],
  cart_line_invalid: [400, 'cart_line_invalid', 'That product or option cannot be added'],
  cart_guest_token_invalid: [
    404,
    'cart_guest_token_invalid',
    'That cart is no longer available. Reload the page to start a new one.',
  ],
  checkout_already_converted: [
    409,
    'checkout_already_converted',
    'This checkout has already become an order',
  ],
  seo_target_missing: [404, 'seo_target_missing', 'That page no longer exists'],
  store_profile_invalid: [400, 'store_profile_invalid', 'Check the store details and try again'],
  notification_not_found: [404, 'notification_not_found', 'That notification is not available'],
};

/**
 * Answers a refusal from the database with its stable error code. Anything else is
 * rethrown for the global error handler (503 when the store is unavailable).
 */
export function sendCommerceFailure(res: Response, error: unknown): void {
  if (!(error instanceof CommerceRefusalError)) throw error;
  const [status, code, message] = REFUSALS[error.refusal];
  sendError(res, status, code, message, error.details);
}
