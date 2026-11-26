import { z } from 'zod';

/*
 * Product images
 * --------------
 * Staff upload an image as raw bytes (POST /admin/products/:productId/images); the API
 * re-encodes it into two WebP files and answers with the public URLs below. Clients never
 * choose a file name, key or URL. Position 0 is the primary image shown in listings.
 */

/** Most images one product keeps. */
export const MAX_PRODUCT_IMAGES = 8;

/** Largest upload accepted, in bytes. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The only Content-Type values an upload may carry. The bytes themselves are checked as well. */
export const PRODUCT_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageContentType = (typeof PRODUCT_IMAGE_CONTENT_TYPES)[number];

/** Smallest and largest source dimensions accepted, in pixels. */
export const PRODUCT_IMAGE_MIN_SIZE = 400;
export const PRODUCT_IMAGE_MAX_SIZE = 8000;

/**
 * A single public picture: a brand logo, a banner or a category cover, as the URLs of its
 * stored WebP variants. The full-size file is for detail views, the thumbnail for lists.
 */
export const mediaPictureSchema = z.object({ url: z.url(), thumbUrl: z.url() });

export type MediaPicture = z.infer<typeof mediaPictureSchema>;

/** Why an upload was refused (error.details.reason of `image_invalid`). */
export const IMAGE_REJECTIONS = [
  'unsupported_format',
  'corrupt',
  'animated',
  'too_small',
  'too_large',
] as const;
export type ImageRejection = (typeof IMAGE_REJECTIONS)[number];

/** A short description for screen readers. */
const altSchema = z
  .string()
  .trim()
  .max(160, { error: 'Keep the description under 160 characters' });

export const productImageSchema = z.object({
  id: z.uuid(),
  /** The full-size WebP (at most 1600 pixels on a side). */
  url: z.url(),
  /** The thumbnail WebP (at most 480 pixels on a side). */
  thumbUrl: z.url(),
  alt: z.string().nullable(),
  /** Pixel size of the full-size file. */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  /** 0 is the primary image. */
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_PRODUCT_IMAGES - 1),
});

/** POST /admin/products/:productId/images?alt= — the raw image is the request body. */
export const productImageUploadQuerySchema = z.object({ alt: altSchema.optional() });

/** PATCH /admin/product-images/:imageId — an empty description removes it. */
export const updateProductImageRequestSchema = z.strictObject({ alt: altSchema.nullable() });

/** PUT /admin/products/:productId/images/order — every image of the product, in the new order. */
export const reorderProductImagesRequestSchema = z.strictObject({
  imageIds: z.array(z.uuid()).min(1).max(MAX_PRODUCT_IMAGES),
});

/** The product's images in order (every change answers with the whole list). */
export const productImageListResponseSchema = z.object({ images: z.array(productImageSchema) });

/** 201 from an upload: the new image and the product's images after it. */
export const productImageUploadResponseSchema = productImageListResponseSchema.extend({
  image: productImageSchema,
});

export type ProductImage = z.infer<typeof productImageSchema>;
export type ProductImageUploadQuery = z.input<typeof productImageUploadQuerySchema>;
export type UpdateProductImageRequest = z.input<typeof updateProductImageRequestSchema>;
export type ReorderProductImagesRequest = z.input<typeof reorderProductImagesRequestSchema>;
export type ProductImageListResponse = z.infer<typeof productImageListResponseSchema>;
export type ProductImageUploadResponse = z.infer<typeof productImageUploadResponseSchema>;
