import { imageContentHash } from './embedding/provider';
import sharp, { type Metadata } from 'sharp';

/*
 * Every image that enters the feature passes through here
 * ------------------------------------------------------
 * Two different jobs, one set of rules:
 *
 *  - `prepareQueryImage` handles what a customer sends. It decodes the bytes, refuses
 *    anything that is not a JPEG, PNG or WebP, fixes the orientation from EXIF, shrinks the
 *    longest side to 1024 px, re-encodes as JPEG at quality 80 and returns the result. Sharp
 *    drops all metadata on the way out, so the stored-or-not question never involves a GPS
 *    position or a camera serial number.
 *  - `inspectStoredImage` handles a picture from the catalogue before it is embedded. The
 *    same decode, plus the eligibility rules: a minimum size, and a rejection of the
 *    near-uniform images that are placeholders rather than products.
 *
 * Nothing here writes to disk: a customer photograph lives in memory for the length of one
 * request.
 */

/** The longest side of a query image after preparation (the brief's 1024 px). */
export const QUERY_MAX_SIZE = 1024;
export const QUERY_JPEG_QUALITY = 80;
/** Below this on the shorter side a catalogue picture cannot add anything to a match. */
export const MIN_INDEX_SIZE = 128;
/** A catalogue picture larger than this is not one of ours. */
const MAX_INDEX_SIZE = 6000;
/** The formats the pipeline produces and accepts. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface PreparedQueryImage {
  /** The prepared JPEG: what is embedded, hashed and (never) stored. */
  jpeg: Buffer;
  width: number;
  height: number;
  /** SHA-256 of the prepared bytes, the identity used by the embedding cache and the log. */
  contentHash: string;
}

/** The reasons an image cannot be prepared or indexed; each has a fixed, user-safe message. */
export type ImageRejection =
  | 'unsupported_format'
  | 'corrupt'
  | 'too_small'
  | 'too_large'
  | 'placeholder'
  | 'empty';

export const IMAGE_REJECTION_MESSAGE: Readonly<Record<ImageRejection, string>> = {
  unsupported_format: 'Use a JPEG, PNG or WebP photo',
  corrupt: 'That image could not be read. Try another photo.',
  too_small: 'That photo is too small to search with. Move closer and try again.',
  too_large: 'That photo is too large. Try another photo.',
  placeholder: 'That picture is a placeholder, not a product photo',
  empty: 'The photo was empty',
};

export class ImageInputError extends Error {
  override readonly name = 'ImageInputError';
  readonly reason: ImageRejection;

  constructor(reason: ImageRejection) {
    super(IMAGE_REJECTION_MESSAGE[reason]);
    this.reason = reason;
  }
}

const sharpOptions = { failOn: 'error' as const, limitInputPixels: 40_000_000 };

/** Decodes the header of an image to prove the bytes are really that image. */
export async function probeImageFormat(bytes: Buffer): Promise<string> {
  try {
    const meta = await sharp(bytes, sharpOptions).metadata();
    if (meta.format === undefined) throw new ImageInputError('corrupt');
    if (!ACCEPTED_FORMATS.has(meta.format)) throw new ImageInputError('unsupported_format');
    if ((meta.pages ?? 1) > 1) throw new ImageInputError('unsupported_format');
    return meta.format;
  } catch (error) {
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError('corrupt');
  }
}

/**
 * The image a customer sent, ready for the model: orientation applied, at most 1024 px on
 * the longest side, JPEG, metadata gone.
 */
export async function prepareQueryImage(bytes: Buffer): Promise<PreparedQueryImage> {
  if (bytes.length === 0) throw new ImageInputError('empty');
  await probeImageFormat(bytes);
  try {
    const { data, info } = await sharp(bytes, sharpOptions)
      .rotate()
      .resize({
        width: QUERY_MAX_SIZE,
        height: QUERY_MAX_SIZE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: QUERY_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (info.width < 1 || info.height < 1) throw new ImageInputError('corrupt');
    return {
      jpeg: data,
      width: info.width,
      height: info.height,
      contentHash: imageContentHash(data),
    };
  } catch (error) {
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError('corrupt');
  }
}

export type StoredImageVerdict =
  | { eligible: true; width: number; height: number; contentHash: string }
  | { eligible: false; reason: ImageRejection | 'unknown_dimensions' };

/**
 * Decides whether a picture already in storage may be indexed, from its bytes.
 *
 * The placeholder test is deliberately simple and explainable: a real product photograph has
 * variation across the frame, while a "no image" tile, a flat background or a single-colour
 * swatch has almost none. Sharp's per-channel standard deviation is that measure; below the
 * threshold the picture is excluded with the reason "placeholder" instead of being embedded
 * and quietly matching everything.
 */
export async function inspectStoredImage(bytes: Buffer): Promise<StoredImageVerdict> {
  if (bytes.length === 0) return { eligible: false, reason: 'empty' };

  let meta: Metadata;
  try {
    meta = await sharp(bytes, sharpOptions).metadata();
  } catch {
    return { eligible: false, reason: 'corrupt' };
  }
  if (meta.format === undefined) return { eligible: false, reason: 'corrupt' };
  if (!ACCEPTED_FORMATS.has(meta.format)) return { eligible: false, reason: 'unsupported_format' };
  if ((meta.pages ?? 1) > 1) return { eligible: false, reason: 'unsupported_format' };

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) return { eligible: false, reason: 'unknown_dimensions' };
  if (width > MAX_INDEX_SIZE || height > MAX_INDEX_SIZE) return { eligible: false, reason: 'too_large' };
  if (width < MIN_INDEX_SIZE || height < MIN_INDEX_SIZE) return { eligible: false, reason: 'too_small' };

  try {
    const stats = await sharp(bytes, sharpOptions).stats();
    const deviation = Math.max(...stats.channels.map((channel) => channel.stdev));
    if (deviation < PLACEHOLDER_DEVIATION) return { eligible: false, reason: 'placeholder' };
  } catch {
    return { eligible: false, reason: 'corrupt' };
  }

  return { eligible: true, width, height, contentHash: imageContentHash(bytes) };
}

/**
 * A nearly uniform picture. 4 is well below what any photograph produces (a plain white
 * product shot on white still measures in the teens) and well above a solid colour tile.
 */
export const PLACEHOLDER_DEVIATION = 4;
