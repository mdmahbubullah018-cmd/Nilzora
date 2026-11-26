import type { ApiErrorCode } from '@nilzora/contracts';
import type { Response } from 'express';
import { sendError } from '../../http/send-error';
import {
  CommerceRefusalError,
  StoreUnavailableError,
  type DatabaseFailure,
} from '../commerce/errors';

/**
 * Refusals raised by the admin and moderation SQL functions (see the
 * admin_permissions_moderation migration), plus unique-key conflicts.
 */
export type AdminRefusal =
  | 'missing_permission'
  | 'not_found'
  | 'invalid_input'
  | 'content_locked'
  | 'under_review'
  | 'not_approved'
  | 'stock_below_zero'
  | 'invalid_transition'
  | 'not_collectable'
  | 'review_closed'
  | 'own_submission'
  | 'cannot_change_self'
  | 'not_manageable'
  | 'slug_taken'
  | 'sku_taken'
  | 'name_taken'
  | 'image_limit'
  | 'category_in_use'
  | 'coupon_code_taken'
  | 'variant_invalid'
  | 'variant_required'
  | 'variant_sku_taken'
  | 'variant_has_history'
  | 'return_not_eligible'
  | 'return_quantity_exceeded'
  | 'return_closed'
  | 'refund_exceeds_balance'
  | 'refund_not_decidable'
  | 'refund_not_completable'
  | 'onboarding_not_found'
  | 'onboarding_invalid'
  | 'onboarding_conflict'
  | 'popup_not_found'
  | 'popup_invalid'
  | 'popup_conflict'
  | 'in_use'
  | 'export_not_ready'
  | 'export_expired'
  | 'campaign_not_found'
  | 'campaign_invalid'
  | 'campaign_conflict'
  | 'recovery_invalid'
  | 'recovery_link_invalid'
  | 'recovery_not_owner'
  | 'courier_unavailable'
  | 'shipment_not_bookable'
  | 'shipment_already_active'
  | 'courier_quote_invalid'
  | 'invalid_shipment_transition'
  | 'shipment_booking_unresolved'
  | 'courier_override_reason_required'
  | 'settlement_invalid'
  | 'shipment_not_cancellable'
  | 'courier_confirmation_required'
  | 'courier_live_check_required';

export class AdminRefusalError extends Error {
  override readonly name = 'AdminRefusalError';
  readonly refusal: AdminRefusal;
  /** Safe details for the client, set by the API itself (never database text). */
  readonly details: unknown;

  constructor(refusal: AdminRefusal, details?: unknown) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
    this.details = details;
  }
}

/** Custom SQLSTATEs of the admin functions. */
const SQLSTATES: Readonly<Record<string, AdminRefusal>> = {
  NZ403: 'missing_permission',
  NZ404: 'not_found',
  NZ412: 'invalid_input',
  // The database refused a stored media key (a category picture, for instance): the value
  // the client sent, not the store, was wrong.
  NZ422: 'invalid_input',
  NZ430: 'content_locked',
  NZ431: 'under_review',
  NZ432: 'not_approved',
  NZ433: 'stock_below_zero',
  NZ434: 'invalid_transition',
  NZ435: 'not_collectable',
  NZ436: 'review_closed',
  NZ437: 'own_submission',
  NZ438: 'cannot_change_self',
  NZ439: 'not_manageable',
  NZ440: 'image_limit',
  NZ441: 'slug_taken',
  NZ442: 'in_use',
  NZ443: 'export_not_ready',
  NZ444: 'export_expired',
  NZ409: 'category_in_use',
  NZ458: 'coupon_code_taken',
  NZ470: 'variant_invalid',
  NZ471: 'variant_required',
  NZ472: 'variant_sku_taken',
  NZ473: 'variant_has_history',
  NZ480: 'return_not_eligible',
  NZ481: 'return_quantity_exceeded',
  NZ482: 'return_closed',
  NZ483: 'refund_exceeds_balance',
  NZ484: 'refund_not_decidable',
  NZ485: 'refund_not_completable',
  NZ490: 'campaign_not_found',
  NZ491: 'campaign_invalid',
  NZ492: 'campaign_conflict',
  // 20261230090000_promotional_popups.sql
  NZ497: 'popup_not_found',
  NZ498: 'popup_invalid',
  NZ499: 'popup_conflict',
  // 20261231090000_abandoned_checkout_recovery.sql. Letter suffixes keep these apart from the
  // numeric ranges the chat and courier functions already use.
  NZR01: 'recovery_invalid',
  NZR02: 'recovery_invalid',
  NZR03: 'recovery_invalid',
  NZR04: 'recovery_link_invalid',
  NZR05: 'recovery_not_owner',
  NZR06: 'recovery_invalid',
  // Courier refusals (20261223091000_courier_foundation.sql). NZ609 (append-only history
  // touched) is an internal invariant, deliberately unmapped: it answers 503.
  NZ600: 'courier_unavailable',
  NZ601: 'shipment_not_bookable',
  NZ602: 'shipment_already_active',
  NZ603: 'courier_quote_invalid',
  NZ604: 'invalid_shipment_transition',
  NZ605: 'shipment_booking_unresolved',
  NZ606: 'courier_override_reason_required',
  NZ607: 'return_not_eligible',
  NZ608: 'settlement_invalid',
  NZ610: 'shipment_not_cancellable',
  // 20261224090000_courier_operations_and_credentials.sql
  NZ611: 'courier_confirmation_required',
  NZ612: 'courier_live_check_required',
};

/** unique_violation */
const UNIQUE_VIOLATION = '23505';
/** check_violation: a value the API's validation should already have refused. */
const CHECK_VIOLATION = '23514';

/**
 * A unique-key conflict names its key in DETAIL ("Key (sku)=(...) already exists.").
 * Only the column name is read, server-side; the text never reaches clients.
 */
function duplicateRefusal(failure: DatabaseFailure): AdminRefusal | undefined {
  const text = `${failure.details ?? ''} ${failure.message}`;
  if (/\(sku\)|_sku_key/.test(text)) return 'sku_taken';
  if (/\(slug\)|_slug_key/.test(text)) return 'slug_taken';
  if (/brands_name_key/.test(text)) return 'name_taken';
  return undefined;
}

/**
 * Turns a failed admin database call into a refusal the routes answer with a stable
 * code, or StoreUnavailableError (a 503) for anything unexpected. Database messages
 * never reach clients; the original error is kept as the cause for the server log.
 */
export function toAdminStoreError(failure: DatabaseFailure, operation: string): Error {
  const refusal =
    failure.code === UNIQUE_VIOLATION
      ? duplicateRefusal(failure)
      : failure.code === CHECK_VIOLATION
        ? 'invalid_input'
        : SQLSTATES[failure.code];
  if (refusal) return new AdminRefusalError(refusal);
  return new StoreUnavailableError(`${operation} failed (${failure.code || 'network'})`, {
    cause: failure,
  });
}

export type RefusalAnswer = readonly [status: number, code: ApiErrorCode, message: string];

const ANSWERS: Readonly<Record<AdminRefusal, RefusalAnswer>> = {
  missing_permission: [403, 'forbidden', 'You do not have permission to do this'],
  not_found: [404, 'not_found', 'Not found'],
  invalid_input: [400, 'bad_request', 'The request was refused as invalid'],
  category_in_use: [
    409,
    'category_in_use',
    'Move or delete this category’s products and subcategories first',
  ],
  coupon_code_taken: [409, 'name_taken', 'Another coupon already uses this code'],
  variant_invalid: [409, 'variant_invalid', 'That variant no longer exists'],
  variant_required: [400, 'variant_required', 'Choose at least one option value'],
  variant_sku_taken: [409, 'variant_sku_taken', 'This SKU or option combination is already used'],
  variant_has_history: [
    409,
    'variant_has_history',
    'This combination has order or stock history. Hide it instead of deleting it.',
  ],
  return_not_eligible: [
    409,
    'return_not_eligible',
    'Only delivered orders inside the window can be returned',
  ],
  return_quantity_exceeded: [
    409,
    'return_quantity_exceeded',
    'More units were chosen than can still be returned',
  ],
  return_closed: [409, 'return_closed', 'This return can no longer take that step'],
  refund_exceeds_balance: [
    409,
    'refund_exceeds_balance',
    'The amount is above the refundable balance',
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
  onboarding_not_found: [404, 'onboarding_not_found', 'That campaign or slide no longer exists'],
  onboarding_invalid: [400, 'onboarding_invalid', 'The campaign or slide cannot be saved as given'],
  onboarding_conflict: [
    409,
    'onboarding_conflict',
    'Another campaign of this kind is already active, or this one must be switched off first',
  ],
  content_locked: [
    409,
    'product_content_locked',
    "Unpublish the product before changing its content, or submit a draft's content",
  ],
  under_review: [
    409,
    'product_under_review',
    'The product is under review or already approved; withdraw the review to change it',
  ],
  not_approved: [
    409,
    'product_not_approved',
    'Only products with approved content can be published',
  ],
  stock_below_zero: [409, 'stock_below_zero', 'Stock cannot go below zero'],
  invalid_transition: [
    409,
    'invalid_status_transition',
    'The order cannot move to this status from its current one',
  ],
  not_collectable: [
    409,
    'payment_not_collectable',
    'Cash can be recorded only for a delivered order still awaiting payment',
  ],
  review_closed: [409, 'review_closed', 'This review is already closed'],
  own_submission: [409, 'own_submission', 'Nobody reviews content they submitted'],
  cannot_change_self: [403, 'cannot_change_self', 'You cannot change your own account this way'],
  not_manageable: [403, 'account_not_manageable', 'You cannot manage this account'],
  slug_taken: [409, 'slug_taken', 'Another item already uses this address'],
  sku_taken: [409, 'sku_taken', 'Another product already uses this SKU'],
  name_taken: [409, 'name_taken', 'Another brand already uses this name'],
  image_limit: [409, 'image_limit_reached', 'A product keeps at most 8 images'],
  in_use: [409, 'in_use', 'This is still in use, so it cannot be deleted'],
  export_not_ready: [409, 'export_not_ready', 'The export has not finished yet'],
  export_expired: [410, 'export_expired', 'This export was kept for 7 days and is gone'],
  campaign_not_found: [404, 'campaign_not_found', 'That campaign no longer exists'],
  campaign_invalid: [400, 'campaign_invalid', 'The campaign cannot be saved as given'],
  campaign_conflict: [
    409,
    'campaign_conflict',
    'Another administrator changed this campaign; reload it and try again',
  ],
  popup_not_found: [404, 'popup_not_found', 'That popup no longer exists'],
  popup_invalid: [400, 'popup_invalid', 'The popup cannot be saved as given'],
  popup_conflict: [
    409,
    'popup_conflict',
    'Another popup is already live; switch it off before showing this one',
  ],
  courier_unavailable: [
    503,
    'courier_unavailable',
    'This courier is not available. Check that it is set up and enabled.',
  ],
  shipment_not_bookable: [
    409,
    'shipment_not_bookable',
    'This order cannot be booked with a courier in its current status',
  ],
  shipment_already_active: [
    409,
    'shipment_already_active',
    'This order already has an active shipment of this kind',
  ],
  courier_quote_invalid: [
    409,
    'courier_quote_invalid',
    'The quote has expired or does not match this booking; compare couriers again',
  ],
  invalid_shipment_transition: [
    409,
    'invalid_shipment_transition',
    'The shipment cannot move to that status from its current one',
  ],
  shipment_booking_unresolved: [
    409,
    'shipment_booking_unresolved',
    'The booking has no clear answer yet; check the courier portal and resolve it first',
  ],
  courier_override_reason_required: [
    400,
    'courier_override_reason_required',
    'Say why the recommended courier was not chosen',
  ],
  settlement_invalid: [
    409,
    'settlement_invalid',
    'The settlement or cash record does not add up; check the amounts and the reference',
  ],
  shipment_not_cancellable: [
    409,
    'shipment_not_cancellable',
    'This shipment cannot be cancelled in its current status',
  ],
  courier_confirmation_required: [
    400,
    'courier_confirmation_required',
    'Type the confirmation text exactly as shown to make this change',
  ],
  courier_live_check_required: [
    409,
    'courier_live_check_required',
    'Run a successful live connection check (in the last 24 hours) first',
  ],
  recovery_invalid: [400, 'bad_request', 'That action is not possible for this checkout'],
  recovery_link_invalid: [409, 'recovery_link_invalid', 'That recovery link is no longer usable'],
  recovery_not_owner: [403, 'forbidden', 'That recovery link belongs to another customer'],
};

/**
 * The status, code and message an error would be answered with, without sending it: for
 * bulk actions, which report each item's refusal in one response. Undefined for anything
 * that is not a known refusal.
 */
export function refusalAnswerOf(
  error: unknown,
  overrides: Partial<Record<AdminRefusal, RefusalAnswer>> = {},
): RefusalAnswer | undefined {
  if (error instanceof CommerceRefusalError && Object.hasOwn(ANSWERS, error.refusal)) {
    const refusal = error.refusal as unknown as AdminRefusal;
    return overrides[refusal] ?? ANSWERS[refusal];
  }
  if (error instanceof AdminRefusalError) return overrides[error.refusal] ?? ANSWERS[error.refusal];
  return undefined;
}

/**
 * Answers a refusal with its stable error code; a route may word some refusals for
 * its own resource (`overrides`). Anything else is rethrown for the global error
 * handler (503 when the store is unavailable).
 */
export function sendAdminFailure(
  res: Response,
  error: unknown,
  overrides: Partial<Record<AdminRefusal, RefusalAnswer>> = {},
): void {
  // Stores shared with the shop (returns, refunds) raise the shop's refusal type over the direct
  // database connection; a refusal of the same name is answered here like an admin one.
  if (error instanceof CommerceRefusalError && Object.hasOwn(ANSWERS, error.refusal)) {
    const refusal = error.refusal as unknown as AdminRefusal;
    const [status, code, message] = overrides[refusal] ?? ANSWERS[refusal];
    sendError(res, status, code, message, error.details);
    return;
  }
  if (!(error instanceof AdminRefusalError)) throw error;
  const [status, code, message] = overrides[error.refusal] ?? ANSWERS[error.refusal];
  sendError(res, status, code, message, error.details);
}
