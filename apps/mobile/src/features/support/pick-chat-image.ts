import {
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  CHAT_IMAGE_MAX_BYTES,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/*
 * Picking a picture for a chat message
 * ------------------------------------
 * Two sources, both from the system: the photo library and the camera. The app never records
 * anything on its own — the picker or the camera app runs outside Nilzora and hands back one
 * file the person chose or took.
 *
 * Everything is checked on the device first (type and size), and the API checks the bytes
 * again: it decodes every picture itself. These checks only save a wasted upload.
 */

export type ChatImageSource = 'library' | 'camera';

export interface PickedChatImage {
  /** The picker's or camera's local copy; only ever sent to the chat attachment upload. */
  uri: string;
  name: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
}

export type PickChatImagesResult =
  | { kind: 'picked'; images: PickedChatImage[] }
  | { kind: 'cancelled' }
  /** Nothing was picked and the screen should say why. */
  | { kind: 'refused'; message: string };

const MAX_BYTES = CHAT_IMAGE_MAX_BYTES;
const MAX_LABEL = chatMediaMaxLabel('image');

const LIBRARY_DENIED = 'Nilzora needs permission to open your photos. Turn it on in Settings.';
const CAMERA_DENIED = 'Nilzora needs permission to use the camera. Turn it on in Settings.';
const CAMERA_UNAVAILABLE =
  'The camera is not available on this device. You can still send a picture from your gallery.';
const UNSUPPORTED = 'That picture could not be read. Choose a JPEG, PNG or WebP picture.';
const LIBRARY_UNAVAILABLE = 'Your photos could not be opened. Please try again.';

type ChatImageType = PickedChatImage['contentType'];

const BY_EXTENSION: Record<string, ChatImageType> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function extensionOf(name: string | null | undefined): string | null {
  return /\.([A-Za-z0-9]+)(?:\?.*)?$/.exec(name ?? '')?.[1]?.toLowerCase() ?? null;
}

/**
 * The type of the bytes the picker really wrote, or null when they are not a format the chat can
 * carry (HEIC, GIF ...).
 *
 * With `quality` below 1 the picker re-encodes the picture, so the file it hands back can differ
 * from the original: a PNG screenshot may arrive as JPEG, and `fileName` still names the original.
 * The API checks the signature against the declared type, so the declared type must come from the
 * file that will be uploaded. The local file's own extension is the most direct evidence, then the
 * type the picker reports, and only then the original name.
 */
function contentTypeOf(
  asset: Pick<ImagePicker.ImagePickerAsset, 'mimeType' | 'fileName' | 'uri'>,
): ChatImageType | null {
  const fromUri = BY_EXTENSION[extensionOf(asset.uri) ?? ''];
  if (fromUri !== undefined) return fromUri;
  const reported = (asset.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (reported === 'image/png' || reported === 'image/webp' || reported === 'image/jpeg') {
    return reported;
  }
  // A type the picker names that the chat cannot carry is a refusal, not a guess at JPEG.
  if (reported.startsWith('image/') && reported !== 'image/jpg') return null;
  return BY_EXTENSION[extensionOf(asset.fileName) ?? ''] ?? 'image/jpeg';
}

/**
 * The size of the picked file. Some pickers omit `fileSize`; reading it from the file itself is
 * what keeps a real picture from being refused as empty.
 */
function byteSizeOf(asset: Pick<ImagePicker.ImagePickerAsset, 'fileSize' | 'uri'>): number {
  if (typeof asset.fileSize === 'number' && asset.fileSize > 0) return asset.fileSize;
  try {
    return new File(asset.uri).size ?? 0;
  } catch {
    return 0;
  }
}

function nameOf(
  asset: Pick<ImagePicker.ImagePickerAsset, 'fileName' | 'uri'>,
  source: ChatImageSource,
) {
  const given = asset.fileName?.trim();
  if (given) return given;
  const fromUri = asset.uri.split('?')[0]?.split('/').pop();
  if (fromUri) return fromUri;
  return `${source === 'camera' ? 'photo' : 'image'}-${String(Date.now())}.jpg`;
}

/** The pictures in a picker result, or a refusal the screen can show. */
function imagesFromResult(
  result: ImagePicker.ImagePickerResult,
  source: ChatImageSource,
): PickChatImagesResult {
  if (result.canceled) return { kind: 'cancelled' };
  const accepted: PickedChatImage[] = [];
  let tooLarge = 0;
  for (const asset of result.assets ?? []) {
    const contentType = contentTypeOf(asset);
    if (contentType === null) continue;
    const byteSize = byteSizeOf(asset);
    if (byteSize > MAX_BYTES) {
      tooLarge += 1;
      continue;
    }
    if (byteSize <= 0) continue;
    accepted.push({ uri: asset.uri, name: nameOf(asset, source), contentType, byteSize });
  }
  if (accepted.length === 0) {
    if (tooLarge === 0) {
      return { kind: 'refused', message: UNSUPPORTED };
    }
    return {
      kind: 'refused',
      message:
        tooLarge > 1
          ? `Those pictures are larger than ${MAX_LABEL}.`
          : `That picture is larger than ${MAX_LABEL}.`,
    };
  }
  return { kind: 'picked', images: accepted };
}

/**
 * Opens the photo library or the camera and answers with the pictures to send.
 *
 * The library takes several pictures at once, up to the number of slots the message has left; the
 * camera is always one, because it takes one at a time. A refused permission and a camera the
 * device does not have both come back as a message, never as a silent no-op: the person pressed a
 * button and is owed an explanation.
 */
export async function pickChatImages(
  source: ChatImageSource,
  /** How many more files this message can take; the library picker never offers more. */
  slots: number = CHAT_ATTACHMENT_MAX_PER_MESSAGE,
): Promise<PickChatImagesResult> {
  if (source === 'library') {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return { kind: 'refused', message: LIBRARY_DENIED };
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, Math.min(slots, CHAT_ATTACHMENT_MAX_PER_MESSAGE)),
        quality: 0.8,
        exif: false,
      });
      return imagesFromResult(result, source);
    } catch {
      return { kind: 'refused', message: LIBRARY_UNAVAILABLE };
    }
  }

  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'refused', message: CAMERA_DENIED };
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
      exif: false,
    });
    return imagesFromResult(result, source);
  } catch {
    // Some emulators and tablets have no camera activity to open at all.
    return { kind: 'refused', message: CAMERA_UNAVAILABLE };
  }
}
