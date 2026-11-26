import { z } from 'zod';
import {
  accountRefSchema,
  adminPageQueryShape,
  adminSearchSchema,
  pageInfoShape,
} from './admin-common';

/*
 * Media library
 * -------------
 * Pictures the store reuses outside the catalog: the store logo and sharing image, SEO
 * images and onboarding slides. An upload is checked from its bytes (JPEG, PNG or WebP,
 * at most 5 MB, at least 400 pixels on the shorter side), turned upright, stripped of
 * every piece of metadata and stored as two WebP files: a full size (at most 1600 px)
 * and a thumbnail (at most 480 px). The server chooses the storage key; a file name the
 * browser sent is kept only as a label.
 *
 * `key` is what a store-profile, SEO or onboarding image field stores. An asset that one
 * of those fields still uses cannot be deleted (409 in_use).
 */

/** The storage folder of library pictures: keys are `library/<asset id>`. */
export const MEDIA_LIBRARY_PREFIX = 'library';

export const MEDIA_ALT_MAX = 250;
export const MEDIA_ORIGINAL_NAME_MAX = 200;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The base key of a library picture. */
export const mediaLibraryKeySchema = z
  .string()
  .regex(new RegExp(`^${MEDIA_LIBRARY_PREFIX}/${UUID_PATTERN}$`));

/** A description for screen readers; an empty one is no description. */
const mediaAltSchema = z
  .string()
  .trim()
  .max(MEDIA_ALT_MAX, { error: `Keep the description under ${String(MEDIA_ALT_MAX)} characters` });

/**
 * The browser's file name, kept only as a label: any folder part is dropped, control and
 * unusual characters become spaces, and it is shortened to 200 characters. Nothing left
 * means no name.
 */
export const mediaOriginalNameSchema = z
  .string()
  .max(1000)
  .transform((name) => {
    const base = name.split(/[\\/]/).pop() ?? '';
    const cleaned = base
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}\p{M} ._()+-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MEDIA_ORIGINAL_NAME_MAX)
      .trim();
    return cleaned === '' ? undefined : cleaned;
  });

/** POST /admin/media?alt=&name= — the raw image is the request body. */
export const mediaUploadQuerySchema = z.object({
  alt: mediaAltSchema.optional(),
  name: mediaOriginalNameSchema.optional(),
});

/** GET /admin/media?q=&page=&pageSize= — newest first; `q` matches the description or name. */
export const mediaListQuerySchema = z.object({
  q: adminSearchSchema.optional(),
  ...adminPageQueryShape,
});

/** PATCH /admin/media/:id — an empty description removes it. */
export const updateMediaRequestSchema = z.strictObject({ alt: mediaAltSchema.nullable() });

export const mediaAssetSchema = z.object({
  id: z.uuid(),
  /** The value to store in an image field (store profile, SEO, onboarding). */
  key: mediaLibraryKeySchema,
  /** The full-size WebP (at most 1600 pixels on a side). */
  url: z.url(),
  /** The thumbnail WebP (at most 480 pixels on a side). */
  thumbUrl: z.url(),
  /** Type of the stored files (always WebP today). */
  contentType: z.string(),
  /** Pixel size and bytes of the full-size file. */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  bytes: z.number().int().min(1),
  alt: z.string().nullable(),
  originalName: z.string().nullable(),
  /** Who uploaded it; null once that account is gone. */
  uploadedBy: accountRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const mediaListResponseSchema = z.object({
  assets: z.array(mediaAssetSchema),
  ...pageInfoShape,
});

export const mediaAssetResponseSchema = z.object({ asset: mediaAssetSchema });

export type MediaUploadQuery = z.input<typeof mediaUploadQuerySchema>;
export type MediaListQuery = z.input<typeof mediaListQuerySchema>;
export type UpdateMediaRequest = z.input<typeof updateMediaRequestSchema>;
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;
export type MediaAssetResponse = z.infer<typeof mediaAssetResponseSchema>;
