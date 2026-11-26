import { z } from 'zod';

/*
 * Product videos (Cloudflare R2). Short clips shown with a product's pictures. The API
 * stores the file under a key it derives from the product and video ids (never a client
 * name), checks the bytes themselves and not only the declared type, and serves them from
 * the public media bucket. Like images, videos are product content: they change only while
 * the product is off sale and not under review.
 */

/** How many videos one product keeps. */
export const MAX_PRODUCT_VIDEOS = 3;

/** Largest video accepted, in bytes (40 MB). */
export const PRODUCT_VIDEO_MAX_BYTES = 40 * 1024 * 1024;

/** The only Content-Type values a video upload may carry. */
export const PRODUCT_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm'] as const;
export type ProductVideoContentType = (typeof PRODUCT_VIDEO_CONTENT_TYPES)[number];

/**
 * The type the first bytes show, or null: MP4 has an `ftyp` box at byte 4, WebM starts with
 * the EBML magic number. The declared Content-Type must match what the bytes show.
 */
export function sniffVideoType(bytes: Uint8Array): ProductVideoContentType | null {
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'video/mp4';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'video/webm';
  }
  return null;
}

/** The file name extension stored for each type. */
export const PRODUCT_VIDEO_EXTENSIONS: Readonly<Record<ProductVideoContentType, string>> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export const productVideoTitleSchema = z.string().trim().min(1).max(160);

export const productVideoSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  contentType: z.enum(PRODUCT_VIDEO_CONTENT_TYPES),
  bytes: z.number().int().positive(),
  /** Short description, also the accessible name of the player. */
  title: z.string().nullable(),
  position: z.number().int().min(0),
});
export type ProductVideo = z.infer<typeof productVideoSchema>;

export const productVideoListResponseSchema = z.object({
  videos: z.array(productVideoSchema),
});
export type ProductVideoListResponse = z.infer<typeof productVideoListResponseSchema>;

export const productVideoUploadQuerySchema = z.object({
  title: productVideoTitleSchema.optional(),
});

export const reorderProductVideosRequestSchema = z.object({
  videoIds: z.array(z.uuid()).min(1).max(MAX_PRODUCT_VIDEOS),
});
export type ReorderProductVideosRequest = z.infer<typeof reorderProductVideosRequestSchema>;
