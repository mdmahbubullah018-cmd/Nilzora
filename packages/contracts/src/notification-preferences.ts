import { z } from 'zod';

/*
 * Notification preferences
 * ------------------------
 * What an account wants to be told, and what it wants kept. The row belongs to the account
 * and is written only by its owner: the API sends no customer id, the database answers
 * `auth.uid()`.
 *
 * Two different things live here on purpose:
 *   - the categories and `inApp` are account-wide and enforced where a notification is
 *     written, so switching one off stops new ones being recorded;
 *   - push delivery is per device (a device is the only thing that can receive a push), so
 *     "push on/off" stays a device action (register/unregister) and promotional pushes keep
 *     their own per-device opt-in.
 */

export const notificationPreferenceSchema = z.object({
  /** Order status changes: confirmed, shipped, delivered, cancelled. */
  orderUpdates: z.boolean(),
  /** Cash recorded as collected. */
  paymentUpdates: z.boolean(),
  /** A return request decided or received. */
  returnUpdates: z.boolean(),
  /** A refund approved, paid or declined. */
  refundUpdates: z.boolean(),
  /** New products and campaigns. Push promotions are a separate per-device choice. */
  promotions: z.boolean(),
  /** False stops new notifications being recorded; the history already kept stays readable. */
  inApp: z.boolean(),
  updatedAt: z.iso.datetime().nullable().default(null),
});
export type NotificationPreferences = z.infer<typeof notificationPreferenceSchema>;

/** PATCH /me/notification-preferences — every field is optional; absent keeps its value. */
export const notificationPreferencesPatchSchema = z.strictObject({
  orderUpdates: z.boolean().optional(),
  paymentUpdates: z.boolean().optional(),
  returnUpdates: z.boolean().optional(),
  refundUpdates: z.boolean().optional(),
  promotions: z.boolean().optional(),
  inApp: z.boolean().optional(),
});
export type NotificationPreferencesPatch = z.input<typeof notificationPreferencesPatchSchema>;

export const notificationPreferencesResponseSchema = z.object({
  preferences: notificationPreferenceSchema,
});
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;
