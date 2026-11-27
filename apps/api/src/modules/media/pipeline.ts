import {
  PRODUCT_IMAGE_MAX_SIZE,
  PRODUCT_IMAGE_MIN_SIZE,
  type ImageRejection,
} from '@nilzora/contracts';
import sharp, { type Metadata } from 'sharp';

export const FULL_MAX_SIZE = 1600;
export const THUMB_MAX_SIZE = 480;

const PIXEL_LIMIT = PRODUCT_IMAGE_MAX_SIZE * PRODUCT_IMAGE_MAX_SIZE;

/** Formats decoded from the bytes themselves; the request's Content-Type is not trusted. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class ImageRejectedError extends Error {
  override readonly name = 'ImageRejectedError';
  readonly reason: ImageRejection;

  constructor(reason: ImageRejection) {
    super(`Image refused: ${reason}`);
    this.reason = reason;
  }
}

export interface ImageVariant {
  data: Buffer;
  width: number;
  height: number;
}

/** What a kind of picture needs beyond the shared rules (type, byte limit, 8000 px ceiling). */
export interface ImageProcessingOptions {
  /** Shortest side accepted, in pixels. Product images use PRODUCT_IMAGE_MIN_SIZE. */
  minSize?: number;
  /** Longest side of the stored full-size variant. Defaults to FULL_MAX_SIZE. */
  fullMax?: number;
  /**
   * The format the stored variants take. Defaults to WebP, which every Nilzora client renders;
   * AVIF is refused (rather than silently written as WebP) when this build cannot encode it.
   */
  format?: ImageOutputFormat;
}

export interface ProcessedImage {
  full: ImageVariant;
  thumb: ImageVariant;
  /** The type and extension that match the bytes actually produced. */
  contentType: string;
  extension: string;
}

/**
 * What a stored picture becomes. WebP is the production format: every consumer renders it —
 * both web apps and the Android app, whose React Native image pipeline cannot be relied on to
 * decode AVIF below Android 12. AVIF is implemented and measured, and is offered here so a
 * deployment whose clients all decode it can switch by changing one argument; see
 * `supportsAvif()` and the measurements in the test suite.
 */
export const IMAGE_OUTPUT_FORMATS = ['webp', 'avif'] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

/** The MIME type and file extension each output format implies. */
export const FORMAT_DETAILS: Readonly<
  Record<ImageOutputFormat, { contentType: string; extension: string }>
> = {
  webp: { contentType: 'image/webp', extension: 'webp' },
  avif: { contentType: 'image/avif', extension: 'avif' },
};

let avifSupport: Promise<boolean> | undefined;

/**
 * Whether this build of sharp can actually write AVIF. Probed once, by encoding a single pixel
 * and checking the ISO-BMFF box: `sharp.format.avif` describes *input* decoding on some builds,
 * so the only trustworthy answer comes from output.
 */
export function supportsAvif(): Promise<boolean> {
  avifSupport ??= (async () => {
    try {
      const output = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .avif({ quality: 50, effort: 1 })
        .toBuffer();
      // Bytes 4..8 are the box type ("ftyp") and 8..12 the brand ("avif" or "avis").
      return (
        output.subarray(4, 8).toString('latin1') === 'ftyp' &&
        output.subarray(8, 12).toString('latin1').startsWith('avi')
      );
    } catch {
      return false;
    }
  })();
  return avifSupport;
}

async function variant(
  input: Buffer,
  maxSize: number,
  quality: number,
  format: ImageOutputFormat,
): Promise<ImageVariant> {
  const pipeline = sharp(input, { limitInputPixels: PIXEL_LIMIT, failOn: 'error' })
    // Applies the EXIF orientation to the pixels; no metadata is carried over to the output.
    .rotate()
    .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb');
  const { data, info } =
    format === 'avif'
      ? // AVIF reaches the same visual quality at a lower number: effort 4 is the price/quality
        // knee for a server-side conversion of a photograph.
        await pipeline.avif({ quality: Math.round(quality * 0.7), effort: 4 }).toBuffer({
          resolveWithObject: true,
        })
      : await pipeline.webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Validates an uploaded image from its bytes and produces the two stored variants: WebP,
 * orientation applied, all metadata (EXIF, GPS, ICC, XMP) dropped, never enlarged.
 * Throws ImageRejectedError for anything that is not a single, still, sensibly sized
 * JPEG, PNG or WebP picture.
 */
export async function processProductImage(
  input: Buffer,
  options: ImageProcessingOptions = {},
): Promise<ProcessedImage> {
  const minSize = options.minSize ?? PRODUCT_IMAGE_MIN_SIZE;
  const fullMax = options.fullMax ?? FULL_MAX_SIZE;
  const format = options.format ?? 'webp';
  if (format === 'avif' && !(await supportsAvif())) {
    // Silently writing WebP under an AVIF name would leave a file whose type lies about it.
    throw new ImageRejectedError('unsupported_format');
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: PIXEL_LIMIT }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new ImageRejectedError(/pixel limit/i.test(message) ? 'too_large' : 'unsupported_format');
  }

  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw new ImageRejectedError('unsupported_format');
  }
  if ((metadata.pages ?? 1) > 1) throw new ImageRejectedError('animated');

  const { width, height } = metadata;
  if (!width || !height) throw new ImageRejectedError('corrupt');
  if (Math.min(width, height) < minSize) throw new ImageRejectedError('too_small');
  if (Math.max(width, height) > PRODUCT_IMAGE_MAX_SIZE) throw new ImageRejectedError('too_large');

  try {
    const [full, thumb] = await Promise.all([
      variant(input, fullMax, 82, format),
      variant(input, Math.min(THUMB_MAX_SIZE, fullMax), 78, format),
    ]);
    return { full, thumb, ...FORMAT_DETAILS[format] };
  } catch {
    // A valid header over damaged pixel data.
    throw new ImageRejectedError('corrupt');
  }
}
