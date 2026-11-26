import { z } from 'zod';

/*
 * Push-notification devices. A signed-in app registers the native push token of its
 * device (FCM on Android, APNs on iOS later) and removes it on sign-out. The API only
 * stores tokens for the notification sender to read on the server; no response ever
 * carries a token back, so a token is never readable from a client.
 */

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * The token the platform's push service issued: 20 to 1,024 characters of letters,
 * digits and `: _ . ~ + / = -`, the same rule the database checks again. (Real FCM and
 * APNs tokens are far shorter; the limit keeps the token index entry well in range.)
 */
export const deviceTokenSchema = z
  .string()
  .trim()
  .min(20, { error: 'The push token is too short' })
  .max(1024, { error: 'The push token is too long' })
  .regex(/^[A-Za-z0-9:_.~+/=-]+$/, { error: 'The push token has invalid characters' });

/**
 * POST /me/devices — registers the device's token for the signed-in account, or
 * refreshes it. A token that belonged to another account moves to the caller (the
 * device now belongs to them). An account keeps its 10 most recently seen devices.
 */
export const deviceRegistrationRequestSchema = z.strictObject({
  token: deviceTokenSchema,
  platform: z.enum(DEVICE_PLATFORMS),
  appVersion: z.string().trim().min(1).max(32).optional(),
});

/** POST /me/devices/remove — forgets the caller's own token (sign-out). */
export const deviceRemovalRequestSchema = z.strictObject({ token: deviceTokenSchema });

/**
 * POST /me/devices/announcements — the caller's own choice about product announcements on
 * this device. Separate from order updates: opting out of announcements never stops an order
 * notification, and vice versa.
 */
export const deviceAnnouncementPreferenceRequestSchema = z.strictObject({
  token: deviceTokenSchema,
  enabled: z.boolean(),
});

export const deviceAnnouncementPreferenceResponseSchema = z.object({ enabled: z.boolean() });

export const deviceRegistrationResponseSchema = z.object({
  device: z.object({ id: z.uuid() }),
});

export type DeviceRegistrationRequest = z.input<typeof deviceRegistrationRequestSchema>;
export type DeviceRemovalRequest = z.input<typeof deviceRemovalRequestSchema>;
export type DeviceRegistrationResponse = z.infer<typeof deviceRegistrationResponseSchema>;
export type DeviceAnnouncementPreferenceRequest = z.input<
  typeof deviceAnnouncementPreferenceRequestSchema
>;
export type DeviceAnnouncementPreferenceResponse = z.infer<
  typeof deviceAnnouncementPreferenceResponseSchema
>;
