import { z } from 'zod';

/** Every business endpoint is served under this versioned prefix. */
export const API_V1_PREFIX = '/api/v1';

/**
 * Correlation header. Clients may send their own id (8–128 characters of
 * letters, digits, `.`, `_`, `:` or `-`); otherwise the API generates one.
 * Every response echoes the id, and error bodies include it as `requestId`.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Trusted server-to-server headers. The Nilzora web servers call the API on behalf
 * of browsers, so every request reaches the API from the web server's address. A web
 * server that presents the shared client secret may name the browser's address, which
 * the API then uses for per-client rate limits. Without a matching secret both headers
 * are ignored, so other callers cannot choose the address they are limited by.
 */
export const TRUSTED_CLIENT_SECRET_HEADER = 'X-Nilzora-Client-Secret';
export const TRUSTED_CLIENT_IP_HEADER = 'X-Nilzora-Client-IP';

/** Error codes the API can return in `error.code`. */
export const API_ERROR_CODES = [
  'bad_request',
  'invalid_json',
  'payload_too_large',
  'unsupported_media_type',
  'validation_failed',
  'not_found',
  'origin_not_allowed',
  'rate_limited',
  'internal_error',
  /** 401: no valid access token (missing, malformed, expired or revoked). */
  'unauthenticated',
  /** 403: signed in, but the account lacks the required permission. */
  'forbidden',
  /** 403: the account exists but is suspended. */
  'account_suspended',
  /** 403: the account has no usable profile or role, so access is refused. */
  'account_unavailable',
  /** 403: this account must pass two-factor authentication (or set it up) first. */
  'two_factor_required',
  /** 400: the authenticator or recovery code was wrong, expired or already used. */
  'invalid_two_factor_code',
  /** 429: too many wrong two-factor codes; try again after `lockedUntil`. */
  'two_factor_locked',
  /** 400: the password given to confirm a sensitive change was wrong (never 401: the session is fine). */
  'reauthentication_failed',
  /** 409: two-factor authentication is already set up for this account. */
  'two_factor_already_active',
  /** 409: there is no two-factor setup (or enrollment) to act on. */
  'two_factor_not_enrolled',
  /** 503: two-factor authentication is not configured on this deployment. */
  'two_factor_unavailable',
  /** 401: login failed; deliberately does not say which part was wrong. */
  'invalid_credentials',
  /** 403: correct credentials, but the email address is not confirmed yet. */
  'email_not_confirmed',
  /** 401: the refresh token is invalid, expired or already used. */
  'invalid_refresh_token',
  /** 400: a six-digit email code was wrong, expired, already used or out of attempts. */
  'invalid_code',
  /** 503: email delivery is not configured or the SMTP server could not be reached. */
  'email_unavailable',
  /** 503: social sign-in is not configured on this deployment. */
  'oauth_unavailable',
  /** 400: the identity provider rejected the password as too weak. */
  'weak_password',
  /** 503: the identity provider or database could not be reached; nothing was granted. */
  'auth_unavailable',
  /** 400: an email confirmation link is invalid, expired or already used. */
  'invalid_confirmation_link',
  /**
   * 503: the store's database could not be reached or answered unexpectedly. A write
   * may still have been saved (the answer can be lost after it commits): retry
   * POST /orders with the same idempotencyKey, never a new one.
   */
  'service_unavailable',
  /**
   * 503: the order WAS saved, but the API could not read it back to answer in full.
   * `details.orderNumber` names the order that exists, so a client can open it instead
   * of asking the customer to place the order again.
   */
  'order_confirmation_pending',
  /** 400: the cart is empty, too large, repeats a product or has an invalid quantity. */
  'cart_invalid',
  /** 409: a product in the cart is not on sale (details.problems lists which). */
  'product_unavailable',
  /** 409: not enough stock for a cart line (details.problems lists which). */
  'insufficient_stock',
  /** 409: a cart line exceeds the product's per-order limit (details.problems lists which). */
  'quantity_limit_exceeded',
  /** 409: the idempotency key was already used for a different order request. */
  'idempotency_conflict',
  /** 409: no delivery charge is set for the address's zone, so the order cannot be priced. */
  'delivery_unavailable',
  /** 409: the total differs from the one the customer reviewed (details.totalMinor). */
  'price_changed',
  /** 400: the coupon code is not valid (unknown or not yet active). */
  'coupon_invalid',
  /** 409: the coupon cannot be used now (inactive, not started, or expired). */
  'coupon_unavailable',
  /** 409: the cart's subtotal is below the coupon's minimum order. */
  'coupon_min_order',
  /** 409: the coupon has no redemptions left (overall or for this customer). */
  'coupon_exhausted',
  /** 409: a voucher cannot be collected or used (not collected, audience, scope, window or cap). */
  'voucher_unavailable',
  /** 409: the order can no longer be cancelled by the customer. */
  'order_not_cancellable',
  /** 409: too many of the account's orders are still waiting for confirmation. */
  'too_many_pending_orders',
  /** 400: the delivery address does not exist or belongs to another account. */
  'address_not_found',
  /** 409: the account already keeps the maximum number of addresses. */
  'address_limit_reached',
  /** 409: cash on delivery is switched off, so no cash order can be placed right now. */
  'payment_unavailable',
  /** 409: a product's content cannot change while it is on sale (unpublish it first). */
  'product_content_locked',
  /** 409: the product is under review, or already reviewed and approved. */
  'product_under_review',
  /** 409: only products with approved content can be published. */
  'product_not_approved',
  /** 409: the stock adjustment would leave less than zero units. */
  'stock_below_zero',
  /** 409: the order cannot move to the requested status from its current one. */
  'invalid_status_transition',
  /** 409: cash can be recorded only for a delivered order still awaiting payment. */
  'payment_not_collectable',
  /** 409: the collected amount differs from the order total (details.totalMinor). */
  'collection_amount_mismatch',
  /** 409: the content review is already decided or withdrawn. */
  'review_closed',
  /** 409: the review is closed, or the chosen account cannot review content. */
  'review_not_assignable',
  /** 409: nobody reviews content they submitted themselves. */
  'own_submission',
  /** 403: accounts cannot change their own status or permissions. */
  'cannot_change_self',
  /** 403: the account is outside what the caller may manage (an owner, an admin, a customer). */
  'account_not_manageable',
  /** 409: another product or category already uses this address (slug). */
  'slug_taken',
  'name_taken',
  /** 409: a shopping zone still holds products or categories, so it cannot be deleted yet. */
  'zone_in_use',
  /** 409: another product already uses this SKU. */
  'sku_taken',
  /** 400: an uploaded image was refused (details.reason says why). */
  'image_invalid',
  /** 409: the product already keeps the maximum number of images. */
  'image_limit_reached',
  /** 400: an uploaded video was refused (not an MP4 or WebM file, or empty). */
  'video_invalid',
  /** 409: the product already keeps the maximum number of videos. */
  'video_limit_reached',
  /** 503: media storage is not configured on this server. */
  'media_unavailable',
  /** 503: image search is switched off (by the deployment or in the admin settings). */
  'image_search_disabled',
  /** 503: image search cannot answer yet (no indexed pictures, or the model is unavailable). */
  'image_search_unavailable',
  'review_photos_locked',
  'review_photo_limit',
  /** 409: an account already uses this email address; change its role instead. */
  'account_exists',
  /** 400: a staff invitation link is invalid, expired or already used. */
  'invitation_invalid',
  /** 409: the invitation was already accepted, so there is nothing to re-send. */
  'invitation_accepted',
  /** 409: a category still has products or subcategories, so it cannot be deleted. */
  'category_in_use',
  /** 400: a product that sells as variants needs one of them chosen first. */
  'variant_required',
  /** 409: the chosen variant does not exist, is not on sale, or belongs to another product. */
  'variant_invalid',
  /** 409: another variant already uses this SKU, or already holds the same options. */
  'variant_sku_taken',
  /** 409: the variant has been sold or stocked, so it is hidden instead of deleted. */
  'variant_has_history',
  /** 409: a variant holding this option is already on sale, or the option is in use. */
  'variant_conflict',
  /** 409: the order cannot be returned (not delivered, or outside the return window). */
  'return_not_eligible',
  /** 409: more units were asked for than can still be returned. */
  'return_quantity_exceeded',
  /** 409: this return has already moved on and cannot take that step. */
  'return_closed',
  /** 409: the refund is more than the order's remaining refundable balance. */
  'refund_exceeds_balance',
  /** 409: this refund is no longer waiting for a decision. */
  'refund_not_decidable',
  /** 409: a refund must be approved before its payout can be recorded. */
  'refund_not_completable',
  /** 400: a cart line names a product or option that is not sold. */
  'cart_line_invalid',
  /** 400: the guest cart handle is missing or not a handle. */
  'cart_guest_token_invalid',
  /** 409: this checkout already became an order. */
  'checkout_already_converted',
  /** 404: the product or category named by an SEO save does not exist. */
  'seo_target_missing',
  /** 400: the store profile cannot be saved as given. */
  'store_profile_invalid',
  /** 404: that notification is not visible to the caller. */
  'notification_not_found',
  /** 404: that onboarding campaign or slide does not exist. */
  'onboarding_not_found',
  /** 400: the onboarding campaign or slide cannot be saved as given. */
  'onboarding_invalid',
  /** 409: another campaign of the same kind is active, or this one must be switched off first. */
  'onboarding_conflict',
  /** 409: a library picture is still used by the store profile, SEO, onboarding or a banner. */
  'in_use',
  /** 409: products still belong to the brand; move them to another brand (or none) first. */
  'brand_in_use',
  /** 409: the export holds more rows than a direct download allows; create an export job. */
  'export_too_large',
  /** 409: the export job has not finished (or failed), so there is no file yet. */
  'export_not_ready',
  /** 410: the export's file was kept for 7 days and is gone. */
  'export_expired',
  /** 503: background exports are not available on this server. */
  'exports_unavailable',
  /** 404: the conversation does not exist, or the caller may not see it. */
  'conversation_not_found',
  /** 409: the conversation is closed, so no new message is accepted until it reopens. */
  'conversation_closed',
  /** 404: the message does not exist in a conversation the caller may see. */
  'message_not_found',
  /** 400: the chosen account cannot take conversations in that queue. */
  'assignee_invalid',
  /** 503: realtime is not configured on this server; REST calls keep working. */
  'realtime_unavailable',
  'template_not_found',
  'template_variable_invalid',
  'saved_reply_not_found',
  'tag_not_found',
  'report_not_found',
  'automation_rule_not_found',
  'attachment_not_found',
  'attachment_type_unsupported',
  'attachment_invalid',
  'rating_not_open',
  /** 404: the discount campaign does not exist. */
  'campaign_not_found',
  /** 400: the discount campaign cannot be saved as given. */
  'campaign_invalid',
  /** 409: the campaign changed since it was read; reload before saving again. */
  'campaign_conflict',
  /** 404: the promotional popup does not exist. */
  'popup_not_found',
  /** 400: the promotional popup cannot be saved as given. */
  'popup_invalid',
  /** 409: another popup is already live; only one may be shown at a time. */
  'popup_conflict',
  /** 409: a campaign in the cart does not allow a coupon. */
  'coupon_campaign_blocked',
  /** 409: a checkout recovery link has expired, been used or been revoked. */
  'recovery_link_invalid',
  /** 503: couriers are switched off on this server, or the courier is not enabled or configured. */
  'courier_unavailable',
  /** 409: the courier offers no API for this; use its portal and record the result. */
  'courier_operation_unsupported',
  /** 409: the order (or return) cannot be booked with a courier in its current state. */
  'shipment_not_bookable',
  /** 409: the order already has an active shipment of this kind. */
  'shipment_already_active',
  /** 409: the quote expired or belongs to another courier or order; compare again. */
  'courier_quote_invalid',
  /** 409: the shipment cannot move to that status from its current one. */
  'invalid_shipment_transition',
  /** 409: the booking has no clear answer yet, or cannot be resolved now. */
  'shipment_booking_unresolved',
  /** 400: choosing a courier other than the recommended one needs a reason. */
  'courier_override_reason_required',
  /** 409: the shipment cannot be cancelled in its current state. */
  'shipment_not_cancellable',
  /** 409: the settlement or COD record is inconsistent (amounts, reference, courier). */
  'settlement_invalid',
  /** 400: turning on live courier operations (or verifying a courier) needs the typed confirmation. */
  'courier_confirmation_required',
  /** 409: a courier can be verified only after a successful live connection check. */
  'courier_live_check_required',
  /** 409: test (mock) courier mode is refused while the API uses a hosted database. */
  'courier_mock_not_allowed',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Body of every non-2xx response from the API. Never carries stack traces. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** One rejected request field, reported in `details.issues` for `validation_failed`. */
export const validationIssueSchema = z.object({
  location: z.enum(['params', 'query', 'body']),
  /** Dot-separated path to the field, empty for the whole location. */
  path: z.string(),
  message: z.string(),
});

export const validationErrorDetailsSchema = z.object({
  issues: z.array(validationIssueSchema),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationErrorDetails = z.infer<typeof validationErrorDetailsSchema>;
