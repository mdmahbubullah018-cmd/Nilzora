import { z } from 'zod';
import {
  mediaPictureSchema,
  PRODUCT_IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageContentType,
} from './media';

/*
 * Customer and staff uploads: profile avatars and review photos
 * -------------------------------------------------------------
 * Like the product, brand, category and banner uploads, a picture travels as raw bytes in a
 * POST body (Content-Type: image/jpeg|png|webp), is decoded and re-encoded by the API from its
 * real content, and is stored under a key the server generates. A client never names a key,
 * a path or a URL, and every answer carries finished public URLs.
 *
 * File type and byte limits are the shared ones (PRODUCT_IMAGE_CONTENT_TYPES and
 * PRODUCT_IMAGE_MAX_BYTES in ./media); only the smallest accepted picture differs.
 */

/** Smallest side, in pixels, an avatar may have (a profile picture is shown small). */
export const AVATAR_MIN_SIZE = 128;

/**
 * Largest avatar accepted: 3 MB of bytes. A profile picture is never shown larger than a
 * few hundred pixels, and this is the ceiling the API enforces on the body it decodes.
 */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

/** Smallest side, in pixels, a review photo may have. */
export const REVIEW_IMAGE_MIN_SIZE = 300;

/**
 * Most photos one review keeps. The database enforces the same number (see
 * private.review_image_limit in the migrations), so changing it means changing both.
 */
export const MAX_REVIEW_IMAGES = 4;

/** POST /me/avatar and DELETE /me/avatar: the caller's own picture, or null once removed. */
export const avatarResponseSchema = z.object({ avatar: mediaPictureSchema.nullable() });

/** One photo on a review. */
export const reviewImageSchema = mediaPictureSchema.extend({ id: z.uuid() });

/** POST /me/reviews/:reviewId/images: the stored photo and the review's photos after it. */
export const reviewImageUploadResponseSchema = z.object({
  image: reviewImageSchema,
  images: z.array(reviewImageSchema).max(MAX_REVIEW_IMAGES),
});

/** DELETE /me/reviews/:reviewId/images/:imageId */
export const reviewImageListResponseSchema = z.object({
  images: z.array(reviewImageSchema).max(MAX_REVIEW_IMAGES),
});

export type AvatarResponse = z.infer<typeof avatarResponseSchema>;
export type ReviewImage = z.infer<typeof reviewImageSchema>;
export type ReviewImageUploadResponse = z.infer<typeof reviewImageUploadResponseSchema>;
export type ReviewImageListResponse = z.infer<typeof reviewImageListResponseSchema>;

/*
 * Checks on a picture before its bytes go to the API
 * ---------------------------------------------------
 * They save a round trip for the usual mistakes and keep wrongly named files away from the API;
 * the API decodes the picture itself and stays the authority on whether it is usable. The type
 * is taken from the file's first bytes, never from its name or the browser's word.
 */

export const IMAGE_TOO_BIG = 'This image is larger than 5 MB. Choose a smaller one.';
/** The same refusal for a profile picture, which has a smaller ceiling. */
export const AVATAR_TOO_BIG = 'This picture is larger than 3 MB. Choose a smaller one.';
export const IMAGE_NOT_SUPPORTED = 'Upload a JPEG, PNG or WebP picture.';
export const IMAGE_MISSING = 'Choose an image to upload.';

/** The image type a file's first bytes declare, whatever its name or reported type says. */
export function sniffImageType(bytes: Uint8Array): ProductImageContentType | null {
  const at = (index: number) => bytes[index];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF", a 4-byte size, then "WEBP".
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** A refusal before upload, or the checked bytes with the type they really are. */
export type ImageFileCheck =
  | { ok: true; bytes: Uint8Array; contentType: ProductImageContentType }
  | { ok: false; message: string };

/** Size and type checks on a browser-reported file, for use before reading it. */
export function checkReportedFile(
  file: { size: number; type: string },
  /** The byte ceiling: the shared picture maximum, or the smaller avatar one. */
  maxBytes: number = PRODUCT_IMAGE_MAX_BYTES,
): string | null {
  if (file.size <= 0) return IMAGE_MISSING;
  if (file.size > maxBytes) return maxBytes === AVATAR_MAX_BYTES ? AVATAR_TOO_BIG : IMAGE_TOO_BIG;
  const reported: readonly string[] = PRODUCT_IMAGE_CONTENT_TYPES;
  if (file.type !== '' && !reported.includes(file.type)) return IMAGE_NOT_SUPPORTED;
  return null;
}

/** The same check for a profile picture: 3 MB, not the shared 5. */
export function checkReportedAvatar(file: { size: number; type: string }): string | null {
  return checkReportedFile(file, AVATAR_MAX_BYTES);
}

/** The part of a browser File this needs, so the check runs wherever a File exists. */
export interface FileLike {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The uploaded file in a form field, checked by size and by its actual bytes. */
export async function checkImageFile(
  value: string | FileLike | null,
  maxBytes: number = PRODUCT_IMAGE_MAX_BYTES,
): Promise<ImageFileCheck> {
  if (typeof value === 'string' || value === null) return { ok: false, message: IMAGE_MISSING };
  const refusal = checkReportedFile(value, maxBytes);
  if (refusal) return { ok: false, message: refusal };
  const bytes = new Uint8Array(await value.arrayBuffer());
  // The reported size is the browser's word; the bytes are what would be sent.
  if (bytes.byteLength > maxBytes) {
    return { ok: false, message: maxBytes === AVATAR_MAX_BYTES ? AVATAR_TOO_BIG : IMAGE_TOO_BIG };
  }
  const contentType = sniffImageType(bytes);
  if (contentType === null) return { ok: false, message: IMAGE_NOT_SUPPORTED };
  return { ok: true, bytes, contentType };
}
