import {
  checkReportedFile,
  PRODUCT_IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_SIZE,
  type ProductImageContentType,
} from '@nilzora/contracts';
import * as ImagePicker from 'expo-image-picker';

/*
 * Choosing pictures
 * -----------------
 * Opens the system's own photo picker. It runs outside the app and hands back only the pictures
 * the person chose, so Android needs no storage permission for it and the app asks for none.
 * The camera is a separate control with its own permission (see the support chat), and these
 * forms never open it. If a device does refuse or the picker fails, the person gets a plain
 * message instead of a crash.
 *
 * These checks only save a trip for the usual mistakes. The API decodes every picture itself
 * and stays the authority on whether it can be used.
 */

export interface PickedImage {
  /** The picker's local copy (file:// or content://); never sent anywhere but the upload. */
  uri: string;
  fileName: string;
  contentType: ProductImageContentType;
  /** Bytes, as reported by the system. */
  size: number;
  width: number;
  height: number;
}

export type PickResult =
  | { kind: 'picked'; images: PickedImage[]; rejected: string[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface PickOptions {
  /** How many pictures may be chosen at once (1 picks a single picture). */
  limit: number;
  /** The shortest side the API accepts for this kind of picture. */
  minSide: number;
  /** The largest file the API accepts; a profile picture has a smaller ceiling than a photo. */
  maxBytes?: number;
}

const EXTENSION_TYPES: Record<string, ProductImageContentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const TYPE_LIST: readonly string[] = PRODUCT_IMAGE_CONTENT_TYPES;

/** The type the system reports, or the one the file name suggests when it reports none. */
function contentTypeOf(
  asset: Pick<ImagePicker.ImagePickerAsset, 'mimeType' | 'fileName' | 'uri'>,
): string {
  if (asset.mimeType) return asset.mimeType.toLowerCase();
  const name = asset.fileName ?? asset.uri;
  const extension = /\.([A-Za-z0-9]+)(?:\?.*)?$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? '';
}

function nameOf(asset: Pick<ImagePicker.ImagePickerAsset, 'fileName' | 'uri'>, n: number): string {
  const given = asset.fileName?.trim();
  if (given) return given;
  const fromUri = asset.uri.split('?')[0]?.split('/').pop();
  return fromUri && fromUri !== '' ? fromUri : `picture-${String(n + 1)}`;
}

/** Why one chosen picture cannot be sent, or null when it looks usable. */
export function problemWith(
  asset: ImagePicker.ImagePickerAsset,
  minSide: number,
  /** The byte ceiling: the shared picture maximum, or the smaller profile-picture one. */
  maxBytes: number = PRODUCT_IMAGE_MAX_BYTES,
): string | null {
  const type = contentTypeOf(asset);
  if (!TYPE_LIST.includes(type)) return 'Upload a JPEG, PNG or WebP picture.';
  // A size the system did not report is left for the API to judge.
  const sizeProblem = checkReportedFile({ size: asset.fileSize ?? 1, type }, maxBytes);
  if (sizeProblem) return sizeProblem;
  const shortest = Math.min(asset.width, asset.height);
  const longest = Math.max(asset.width, asset.height);
  if (shortest > 0 && shortest < minSide) {
    return `This picture is too small. Choose one at least ${String(minSide)} pixels on each side.`;
  }
  if (longest > PRODUCT_IMAGE_MAX_SIZE) {
    return `This picture is too large. Choose one no more than ${String(PRODUCT_IMAGE_MAX_SIZE)} pixels on a side.`;
  }
  return null;
}

/** Opens the photo picker and returns the usable pictures plus a message for each refused one. */
export async function pickImages({ limit, minSide, maxBytes }: PickOptions): Promise<PickResult> {
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: limit > 1,
      ...(limit > 1 ? { selectionLimit: limit } : {}),
      // Pictures are sent as the system gives them; the picker only drops the location data.
      exif: false,
      quality: 1,
    });
  } catch {
    return {
      kind: 'error',
      message:
        'Your photos could not be opened. Check that Nilzora may use your photos, then try again.',
    };
  }
  if (result.canceled) return { kind: 'cancelled' };

  const images: PickedImage[] = [];
  const rejected: string[] = [];
  result.assets.slice(0, limit).forEach((asset, index) => {
    const name = nameOf(asset, index);
    const problem = problemWith(asset, minSide, maxBytes);
    if (problem) {
      rejected.push(`${name}: ${problem}`);
      return;
    }
    images.push({
      uri: asset.uri,
      fileName: name,
      contentType: contentTypeOf(asset) as ProductImageContentType,
      size: asset.fileSize ?? 0,
      width: asset.width,
      height: asset.height,
    });
  });
  return { kind: 'picked', images, rejected };
}
