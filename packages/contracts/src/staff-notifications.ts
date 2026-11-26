import { z } from 'zod';

/*
 * Staff notifications
 * -------------------
 * The in-app inbox for staff and admins. A notification is either addressed to one named
 * person or to everyone holding one permission; the database decides which rows a caller
 * may see, so the API never filters on the client's word.
 */

/**
 * Every value of the database enum `public.staff_notification_kind`, in the order it grew.
 * The enum is the authority: when a migration adds a value, it must be added here in the
 * same change, or a row of that kind makes the whole inbox unreadable (the API validates
 * each row, so one unknown kind is a 500 for the entire page). `chat_message` and
 * `chat_escalation` came with the internal chat (20261114090000_chat_phase2_schema.sql).
 */
export const STAFF_NOTIFICATION_KINDS = [
  'order_new',
  'stock_low',
  'return_new',
  'refund_action',
  'moderation_pending',
  'chat_message',
  'chat_escalation',
] as const;
export type StaffNotificationKind = (typeof STAFF_NOTIFICATION_KINDS)[number];
export const staffNotificationKindSchema = z.enum(STAFF_NOTIFICATION_KINDS);

/**
 * The entity a notification is about — the database's `staff_notifications.entity_type`
 * check, which gained `conversation` with the internal chat.
 */
export const STAFF_NOTIFICATION_ENTITY_TYPES = [
  'order',
  'product',
  'return',
  'refund',
  'conversation',
] as const;
export type StaffNotificationEntityType = (typeof STAFF_NOTIFICATION_ENTITY_TYPES)[number];
export const staffNotificationEntityTypeSchema = z.enum(STAFF_NOTIFICATION_ENTITY_TYPES);

export const staffNotificationSchema = z.object({
  id: z.uuid(),
  kind: staffNotificationKindSchema,
  title: z.string(),
  body: z.string().nullable().default(null),
  entityType: z.enum(STAFF_NOTIFICATION_ENTITY_TYPES),
  entityId: z.string(),
  /** The Admin page that acts on it, or null when there is nothing to open. */
  actionPath: z.string().nullable().default(null),
  readAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
});

export const staffNotificationListResponseSchema = z.object({
  notifications: z.array(staffNotificationSchema),
  unread: z.number().int().min(0).default(0),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(25),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});

export const staffNotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const unreadNotificationCountSchema = z.object({ unread: z.number().int().min(0) });

export type StaffNotification = z.infer<typeof staffNotificationSchema>;
export type StaffNotificationListResponse = z.infer<
  typeof staffNotificationListResponseSchema
>;
export type StaffNotificationQuery = z.input<typeof staffNotificationQuerySchema>;
export type UnreadNotificationCount = z.infer<typeof unreadNotificationCountSchema>;
