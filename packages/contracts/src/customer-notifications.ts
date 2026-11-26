import { z } from 'zod';

/*
 * A customer's own notification history
 * -------------------------------------
 * What happened to this account's orders, returns and refunds, kept so it can be read back
 * later — a push that never arrives, or that was turned off, no longer means the customer
 * never learns. The rows are written by database triggers on the real business events and
 * are readable only by their owner: the API never accepts a customer id, the database
 * answers `auth.uid()`.
 *
 * Every stored kind must appear here. A value the database can produce but this list omits
 * would make the whole page unreadable (the store validates each row), which is exactly the
 * defect the staff inbox once had; `supabase/tests/customer_notifications.test.sql` pins the
 * two together.
 */

export const CUSTOMER_NOTIFICATION_KINDS = [
  'order_update',
  'payment_update',
  'return_update',
  'refund_update',
  /** A courier shipment moved (booked, picked up, out for delivery, delivered, returned). */
  'shipment_update',
] as const;
export type CustomerNotificationKind = (typeof CUSTOMER_NOTIFICATION_KINDS)[number];
export const customerNotificationKindSchema = z.enum(CUSTOMER_NOTIFICATION_KINDS);

/** The entity a notification is about — the table's own check constraint. */
export const CUSTOMER_NOTIFICATION_ENTITY_TYPES = ['order', 'return', 'refund'] as const;

export const customerNotificationSchema = z.object({
  id: z.uuid(),
  kind: customerNotificationKindSchema,
  title: z.string(),
  body: z.string().nullable().default(null),
  entityType: z.enum(CUSTOMER_NOTIFICATION_ENTITY_TYPES),
  entityId: z.string(),
  /**
   * Always a path inside the storefront's account area, or null. The database constrains it
   * to `^/account/…` and the API checks it again before it reaches a link, so a stored value
   * can never send a customer to another site.
   */
  actionPath: z
    .string()
    .regex(/^\/account\/[A-Za-z0-9/_?=&%.-]{0,159}$/)
    .nullable()
    .default(null),
  readAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type CustomerNotification = z.infer<typeof customerNotificationSchema>;

export const customerNotificationListResponseSchema = z.object({
  notifications: z.array(customerNotificationSchema),
  unread: z.number().int().min(0).default(0),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(20),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});
export type CustomerNotificationListResponse = z.infer<
  typeof customerNotificationListResponseSchema
>;

/** GET /me/notifications — bounded page size, and an optional category. */
export const customerNotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  kind: customerNotificationKindSchema.optional(),
});
export type CustomerNotificationQuery = z.input<typeof customerNotificationQuerySchema>;

export const customerUnreadCountSchema = z.object({ unread: z.number().int().min(0) });
export type CustomerUnreadCount = z.infer<typeof customerUnreadCountSchema>;

/** POST /me/notifications/delete — the customer's own entries to remove from the notification centre. */
export const deleteCustomerNotificationsRequestSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(100),
});
export type DeleteCustomerNotificationsRequest = z.infer<
  typeof deleteCustomerNotificationsRequestSchema
>;

/** POST /me/notifications/clear — everything up to the moment the customer pressed Clear all. */
export const clearCustomerNotificationsRequestSchema = z.strictObject({
  before: z.iso.datetime(),
});
export type ClearCustomerNotificationsRequest = z.infer<
  typeof clearCustomerNotificationsRequestSchema
>;

export const customerNotificationsDeletedSchema = z.object({
  deleted: z.number().int().min(0),
});
export type CustomerNotificationsDeleted = z.infer<typeof customerNotificationsDeletedSchema>;
