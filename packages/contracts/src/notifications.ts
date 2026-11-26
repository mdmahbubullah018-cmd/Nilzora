import { z } from 'zod';
import { mediaKeySchema } from './seo';
import { bannerHrefSchema } from './merchandising';

/*
 * Push broadcasts: a short message staff send to every customer whose device opted in to
 * promotional notifications. The API queues one delivery per customer through the same
 * outbox as product announcements; nothing is sent from the request itself.
 */

export const BROADCAST_TITLE_MAX = 65;
export const BROADCAST_BODY_MAX = 240;

/** POST /admin/broadcasts */
export const broadcastRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(BROADCAST_TITLE_MAX),
  body: z.string().trim().min(1).max(BROADCAST_BODY_MAX),
  /** A product on sale to open when the notification is tapped; omit for none. */
  productId: z.uuid().optional(),
  /** A picture from the media library, shown large in the notification; omit for text only. */
  imageKey: mediaKeySchema.optional(),
  /** A page inside the store to open when tapped (a category, a screen, a product path). */
  linkPath: bannerHrefSchema.optional(),
  /** Send later (within 30 days); omit to send now. */
  scheduledFor: z.iso.datetime().optional(),
});
export type BroadcastRequest = z.input<typeof broadcastRequestSchema>;

export const broadcastSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  productSlug: z.string().nullable(),
  linkPath: z.string().nullable().default(null),
  imageKey: z.string().nullable().default(null),
  scheduledFor: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  author: z.string().nullable(),
  recipients: z.number().int().min(0),
  sent: z.number().int().min(0),
  pending: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type Broadcast = z.infer<typeof broadcastSchema>;

/** GET /admin/broadcasts */
export const broadcastListResponseSchema = z.object({ broadcasts: z.array(broadcastSchema) });
export type BroadcastListResponse = z.infer<typeof broadcastListResponseSchema>;

/** POST /admin/broadcasts answer: how many customers it was queued for. */
export const broadcastCreatedResponseSchema = z.object({
  id: z.uuid(),
  recipients: z.number().int().min(0),
});
export type BroadcastCreatedResponse = z.infer<typeof broadcastCreatedResponseSchema>;

/**
 * Automatic announcements of newly published products: whether they are sent, and the words.
 * {name} in either template is replaced with the product's name.
 */
export const pushSettingsSchema = z.object({
  autoAnnounceProducts: z.boolean(),
  productTitleTemplate: z.string(),
  productBodyTemplate: z.string(),
  updatedAt: z.iso.datetime().nullable().default(null),
});
export type PushSettings = z.infer<typeof pushSettingsSchema>;

export const savePushSettingsSchema = z.strictObject({
  autoAnnounceProducts: z.boolean(),
  productTitleTemplate: z.string().trim().min(1).max(BROADCAST_TITLE_MAX),
  productBodyTemplate: z.string().trim().min(1).max(BROADCAST_BODY_MAX),
});
export type SavePushSettingsRequest = z.input<typeof savePushSettingsSchema>;
