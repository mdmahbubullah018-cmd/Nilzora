import type { ProductImage } from '@nilzora/contracts';

/** The columns of product_images the API reads (created_by is never exposed). */
export const IMAGE_COLUMNS = 'id, storage_key, width, height, alt_text, position';

export interface ImageRow {
  id: string;
  storage_key: string;
  width: number;
  height: number;
  alt_text: string | null;
  position: number;
}

export const FULL_FILE = 'full.webp';
export const THUMB_FILE = 'thumb.webp';

/** The two object keys behind an image's base key. */
export function variantKeys(storageKey: string): [full: string, thumb: string] {
  return [`${storageKey}/${FULL_FILE}`, `${storageKey}/${THUMB_FILE}`];
}

/**
 * The public image for a stored row. URLs are built from the configured public base
 * (never stored). Without media configured there is nothing to link to: null.
 */
export function toProductImage(
  row: ImageRow,
  publicBaseUrl: string | undefined,
): ProductImage | null {
  if (publicBaseUrl === undefined) return null;
  const [full, thumb] = variantKeys(row.storage_key);
  return {
    id: row.id,
    url: `${publicBaseUrl}/${full}`,
    thumbUrl: `${publicBaseUrl}/${thumb}`,
    alt: row.alt_text,
    width: row.width,
    height: row.height,
    position: row.position,
  };
}

/**
 * The two public URLs of a stored base key, or null without a key or without media
 * configured. Used wherever a row keeps only the key (an order line, a campaign banner,
 * a conversation's product): the URLs are always built, never stored.
 */
export function pictureFromKey(
  imageKey: string | null | undefined,
  publicBaseUrl: string | undefined,
  alt: string | null = null,
): { url: string; thumbUrl: string; alt: string | null } | null {
  if (imageKey === null || imageKey === undefined || imageKey === '') return null;
  if (publicBaseUrl === undefined) return null;
  const [full, thumb] = variantKeys(imageKey);
  return { url: `${publicBaseUrl}/${full}`, thumbUrl: `${publicBaseUrl}/${thumb}`, alt };
}

/** Images in position order. Empty when media is not configured. */
export function toProductImages(
  rows: readonly ImageRow[],
  publicBaseUrl: string | undefined,
): ProductImage[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => toProductImage(row, publicBaseUrl))
    .filter((image): image is ProductImage => image !== null);
}
