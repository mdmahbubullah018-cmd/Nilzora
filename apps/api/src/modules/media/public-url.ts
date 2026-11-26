import { mediaKeySchema, type MediaPicture } from '@nilzora/contracts';
import { z } from 'zod';
import { variantKeys } from './images';

/*
 * Public media URLs
 * -----------------
 * A stored key is a *base* key: the media pipeline writes `<key>/full.webp` and
 * `<key>/thumb.webp` beside it (see variantKeys). Only this API knows the bucket's public
 * address (R2_PUBLIC_BASE_URL), so only this API turns a key into a URL — the storefront and
 * the mobile app receive the finished URL and never build one themselves.
 *
 * Nothing here guesses. A key is accepted only in the exact shape the Admin forms and the
 * media service produce (mediaKeySchema: a known folder, letters, digits, slash, dash and
 * underscore), so a stored value can never inject a scheme, a host, a query or a `..`
 * segment into a public URL. Without configuration, or with anything unexpected stored, the
 * answer is null and the reader shows nothing rather than a broken link.
 */

/** Which stored file a reader wants: the full-size WebP or its thumbnail. */
export type MediaVariant = 'full' | 'thumb';

function publicBase(publicBaseUrl: string | undefined): URL | null {
  if (publicBaseUrl === undefined || publicBaseUrl.trim() === '') return null;
  let base: URL;
  try {
    base = new URL(publicBaseUrl.trim());
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    return null;
  }
  return base;
}

/**
 * The public URL of one stored image, or null when there is nothing safe to link to.
 *
 * `publicBaseUrl` is the configured media address (normalised by config/env.ts); a base with
 * a path is kept, and the object key is appended to it.
 */
export function publicMediaUrl(
  key: string | null,
  publicBaseUrl: string | undefined,
  variant: MediaVariant = 'full',
  keySchema: z.ZodType<string> = mediaKeySchema,
): string | null {
  if (key === null) return null;
  const parsedKey = keySchema.safeParse(key);
  if (!parsedKey.success) return null;
  const base = publicBase(publicBaseUrl);
  if (base === null) return null;

  const [full, thumb] = variantKeys(parsedKey.data);
  const directory = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${directory}/${variant === 'full' ? full : thumb}`, base.origin);
  // The key cannot escape the base (mediaKeySchema has no dots), and this keeps it true even
  // if that rule ever loosens.
  return url.origin === base.origin ? url.toString() : null;
}

/**
 * The public URL of one stored object that was written under exactly the key it is read back
 * by, with no variants beside it: a chat document or voice recording. Same rules as
 * `publicMediaUrl`: the key must match the caller's own pattern and the base must be safe, so a
 * stored value can never inject a host or a path segment, and anything unexpected answers null.
 */
export function singleObjectUrl(
  key: string | null,
  publicBaseUrl: string | undefined,
  keySchema: z.ZodType<string>,
): string | null {
  if (key === null) return null;
  const parsedKey = keySchema.safeParse(key);
  if (!parsedKey.success) return null;
  const base = publicBase(publicBaseUrl);
  if (base === null) return null;

  const directory = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${directory}/${parsedKey.data}`, base.origin);
  return url.origin === base.origin ? url.toString() : null;
}

/**
 * Keys the API generates for pictures that belong to one account: a profile picture
 * (avatars/<user>/<picture>) or a review photo (review-images/<review>/<photo>). They are
 * deliberately not part of mediaKeySchema, which is what an admin may type into the store
 * profile or an SEO field: nobody can point a public field at someone's avatar or photo.
 */
const UUID_PART = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const ownedPictureKeySchema = z
  .string()
  .regex(new RegExp('^(avatars|review-images)/' + UUID_PART + '/' + UUID_PART + '$'));

/** The full-size and thumbnail URLs of an owned picture, or null when there is nothing safe. */
export function ownedPicture(
  key: string | null,
  publicBaseUrl: string | undefined,
): MediaPicture | null {
  const url = publicMediaUrl(key, publicBaseUrl, 'full', ownedPictureKeySchema);
  const thumbUrl = publicMediaUrl(key, publicBaseUrl, 'thumb', ownedPictureKeySchema);
  return url === null || thumbUrl === null ? null : { url, thumbUrl };
}
