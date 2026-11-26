import type { OrderDetail } from '@nilzora/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/*
 * The pictures a receipt PDF carries
 * ----------------------------------
 * The official Nilzora logo (apps/api/assets/brand/nilzora-logo-on-light.png, a byte-for-byte copy
 * of the supplied lockup the storefront uses) and each line's product picture. Both are turned
 * into small sRGB JPEGs, which the PDF writer embeds as they are. The logo's transparency is laid
 * on white, the colour of the page it is printed on, so it looks exactly as supplied.
 *
 * Product pictures are fetched only from the store's own public media origin
 * (R2_PUBLIC_BASE_URL) over https, each with a short timeout and a size cap, so the server never
 * fetches an address a database row or a client could steer it to. A picture that cannot be read
 * leaves a neutral placeholder: the receipt is never refused because of an image.
 */

const LOGO_FILE = 'assets/brand/nilzora-logo-on-light.png';
/** Rendered at 120 pt wide on the page: twice that in pixels keeps it sharp in print. */
const LOGO_PIXEL_WIDTH = 480;
const PICTURE_PIXELS = 96;
const FETCH_TIMEOUT_MS = 2_500;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
const MAX_PICTURES = 40;
const CONCURRENCY = 4;

let logoPromise: Promise<Buffer | null> | null = null;

/** The API package's root, found by walking up from this module (source or built bundle). */
function assetPath(relative: string): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The official logo as a JPEG on white, or null when the asset is missing. Read once. */
export function receiptLogo(): Promise<Buffer | null> {
  logoPromise ??= (async () => {
    const path = assetPath(LOGO_FILE);
    if (path === null) return null;
    try {
      return await sharp(readFileSync(path))
        .resize({ width: LOGO_PIXEL_WIDTH, withoutEnlargement: true })
        .flatten({ background: '#FFFFFF' })
        .toColourspace('srgb')
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer();
    } catch {
      return null;
    }
  })();
  return logoPromise;
}

/** Only pictures under the store's own https media origin are ever fetched. */
export function trustedPictureUrl(
  url: string | undefined,
  mediaBaseUrl: string | undefined,
): string | null {
  if (url === undefined || mediaBaseUrl === undefined || mediaBaseUrl === '') return null;
  try {
    const picture = new URL(url);
    const base = new URL(mediaBaseUrl.endsWith('/') ? mediaBaseUrl : `${mediaBaseUrl}/`);
    if (picture.protocol !== 'https:' || picture.origin !== base.origin) return null;
    if (!picture.pathname.startsWith(base.pathname)) return null;
    return picture.toString();
  } catch {
    return null;
  }
}

async function fetchPicture(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_PICTURE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PICTURE_BYTES) return null;
    return await sharp(bytes, { limitInputPixels: 40_000_000 })
      .resize(PICTURE_PIXELS, PICTURE_PIXELS, { fit: 'cover' })
      .flatten({ background: '#FFFFFF' })
      .toColourspace('srgb')
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Each line's picture as a small JPEG, keyed by order line id; lines without one are absent. */
export async function receiptPictures(
  order: OrderDetail,
  mediaBaseUrl: string | undefined,
  fetchOne: (url: string) => Promise<Buffer | null> = fetchPicture,
): Promise<Map<number, Buffer>> {
  const wanted = order.items
    .slice(0, MAX_PICTURES)
    .map((item) => ({
      id: item.orderItemId,
      url: trustedPictureUrl(item.image?.thumbUrl ?? item.image?.url, mediaBaseUrl),
    }))
    .filter((entry): entry is { id: number; url: string } => entry.url !== null);
  const pictures = new Map<number, Buffer>();
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((entry) => fetchOne(entry.url)));
    batch.forEach((entry, index) => {
      const jpeg = results[index];
      if (jpeg) pictures.set(entry.id, jpeg);
    });
  }
  return pictures;
}
