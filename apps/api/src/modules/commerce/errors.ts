import { CART_LINE_PROBLEMS, moneyMinorSchema, MAX_CART_LINES } from '@nilzora/contracts';
import { z, type ZodType } from 'zod';

/**
 * The store's database could not be reached or answered unexpectedly; the global
 * error handler answers 503 service_unavailable. A 503 after a write does not mean
 * nothing was changed: the change may have committed before its answer was lost
 * (see OrderReadBackError), so clients retry POST /orders with the same
 * idempotencyKey.
 */
export class StoreUnavailableError extends Error {
  override readonly name: string = 'StoreUnavailableError';
}

/**
 * place_cod_order or cancel_my_order committed, but the order could not be read
 * back, even after one retry. Still a 503: the change is saved, so a retry with the
 * same idempotency key answers with the order. Logged distinctly, by order number.
 */
export class OrderReadBackError extends StoreUnavailableError {
  override readonly name = 'OrderReadBackError';
  readonly operation: string;
  readonly orderNumber: string;

  constructor(operation: string, orderNumber: string, options?: ErrorOptions) {
    super(`${operation} committed, but the order could not be read back`, options);
    this.operation = operation;
    this.orderNumber = orderNumber;
  }
}

/** Business rules the database refused, as raised by the commerce SQL functions. */
export type CommerceRefusal =
  | 'order_not_found'
  | 'account_suspended'
  | 'address_not_found'
  | 'cart_invalid'
  | 'product_unavailable'
  | 'insufficient_stock'
  | 'quantity_limit_exceeded'
  | 'idempotency_conflict'
  | 'delivery_unavailable'
  | 'price_changed'
  | 'order_not_cancellable'
  | 'too_many_pending_orders'
  | 'address_limit_reached'
  | 'payment_unavailable'
  | 'coupon_invalid'
  | 'coupon_unavailable'
  | 'coupon_min_order'
  | 'coupon_exhausted'
  | 'voucher_unavailable'
  | 'variant_required'
  | 'variant_invalid'
  | 'variant_sku_taken'
  | 'return_not_eligible'
  | 'return_quantity_exceeded'
  | 'return_closed'
  | 'refund_exceeds_balance'
  | 'refund_not_decidable'
  | 'refund_not_completable'
  | 'cart_line_invalid'
  | 'cart_guest_token_invalid'
  | 'checkout_already_converted'
  | 'seo_target_missing'
  | 'store_profile_invalid'
  | 'notification_not_found';

export class CommerceRefusalError extends Error {
  override readonly name = 'CommerceRefusalError';
  readonly refusal: CommerceRefusal;
  /** Safe, validated details for the client (problem lines or the current total). */
  readonly details: unknown;

  constructor(refusal: CommerceRefusal, details?: unknown) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
    this.details = details;
  }
}

/** The parts of a PostgREST error the API reads. */
export interface DatabaseFailure {
  code: string;
  message: string;
  details?: string | null;
}

/** Custom SQLSTATEs raised by the commerce functions (see the catalog_and_cod_orders migration). */
const REFUSALS: Readonly<Record<string, CommerceRefusal>> = {
  NZ404: 'order_not_found',
  NZ410: 'account_suspended',
  NZ411: 'address_not_found',
  NZ412: 'cart_invalid',
  NZ413: 'product_unavailable',
  NZ414: 'insufficient_stock',
  NZ415: 'quantity_limit_exceeded',
  NZ416: 'idempotency_conflict',
  NZ417: 'delivery_unavailable',
  NZ418: 'price_changed',
  NZ419: 'order_not_cancellable',
  NZ420: 'too_many_pending_orders',
  NZ421: 'address_limit_reached',
  NZ423: 'payment_unavailable',
  NZ450: 'coupon_invalid',
  NZ451: 'coupon_invalid',
  NZ452: 'coupon_unavailable',
  NZ453: 'coupon_unavailable',
  NZ454: 'coupon_unavailable',
  NZ455: 'coupon_min_order',
  NZ456: 'coupon_exhausted',
  NZ457: 'coupon_exhausted',
  NZ459: 'voucher_unavailable',
  NZ470: 'variant_invalid',
  NZ471: 'variant_required',
  NZ472: 'variant_sku_taken',
  NZ480: 'return_not_eligible',
  NZ481: 'return_quantity_exceeded',
  NZ482: 'return_closed',
  NZ483: 'refund_exceeds_balance',
  NZ484: 'refund_not_decidable',
  NZ485: 'refund_not_completable',
  NZ490: 'cart_line_invalid',
  NZ491: 'cart_guest_token_invalid',
  NZ492: 'checkout_already_converted',
  NZ494: 'seo_target_missing',
  NZ495: 'store_profile_invalid',
  NZ496: 'notification_not_found',
  // 20261231090000_abandoned_checkout_recovery.sql — a recovery link that cannot be used.
  NZR04: 'cart_invalid',
  NZR05: 'cart_invalid',
  NZR06: 'cart_invalid',
};

const problemsSchema = z
  .array(z.object({ productId: z.uuid(), problem: z.enum(CART_LINE_PROBLEMS) }))
  .max(MAX_CART_LINES);
const priceChangedSchema = z.object({ totalMinor: moneyMinorSchema });

/** Parses a DETAIL text as JSON without ever throwing. */
function parseDetail(detail: string | null | undefined): unknown {
  if (!detail) return undefined;
  try {
    return JSON.parse(detail);
  } catch {
    return undefined;
  }
}

/**
 * Only fields re-validated here reach clients: the problem lines of a cart (product
 * id and problem kind) and the current total. Anything else in DETAIL is dropped.
 */
function refusalDetails(refusal: CommerceRefusal, detail: string | null | undefined): unknown {
  if (
    refusal === 'product_unavailable' ||
    refusal === 'insufficient_stock' ||
    refusal === 'quantity_limit_exceeded'
  ) {
    const parsed = problemsSchema.safeParse(parseDetail(detail));
    return { problems: parsed.success ? parsed.data : [] };
  }
  if (refusal === 'price_changed') {
    const parsed = priceChangedSchema.safeParse(parseDetail(detail));
    return parsed.success ? { totalMinor: parsed.data.totalMinor } : undefined;
  }
  return undefined;
}

/**
 * Turns a failed database call into the error the routes understand: a refusal for
 * the commerce SQLSTATEs, otherwise StoreUnavailableError (network failures, 5xx,
 * permission or schema surprises). Database messages never reach clients; the
 * original error is kept as the cause for the server log.
 */
export function toStoreError(failure: DatabaseFailure, operation: string): Error {
  const refusal = REFUSALS[failure.code];
  if (refusal) return new CommerceRefusalError(refusal, refusalDetails(refusal, failure.details));
  return new StoreUnavailableError(`${operation} failed (${failure.code || 'network'})`, {
    cause: failure,
  });
}

/** Checks a database answer against the public contract before it is served. */
export function conform<T>(schema: ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new StoreUnavailableError(`${operation} returned an unexpected answer`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** PostgREST timestamps carry an offset (+00:00); a direct connection returns Date. */
export function isoTimestamp(value: string | Date): string {
  const date = new Date(value);
  // An unparseable value is passed on unchanged, so conform() reports it.
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** A timestamp as PostgreSQL writes it into JSON: `2026-11-08T09:30:00.123456+00:00`. */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/;

/**
 * Database functions that answer jsonb write timestamps with an offset; the contracts want
 * the `Z` form. Every such string, at any depth, becomes the same instant in `Z` form.
 */
export function isoTimestamps(value: unknown): unknown {
  if (typeof value === 'string') {
    return PG_TIMESTAMP.test(value) ? new Date(value).toISOString() : value;
  }
  if (Array.isArray(value)) return value.map(isoTimestamps);
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isoTimestamps(entry),
      ]),
    );
  }
  return value;
}
