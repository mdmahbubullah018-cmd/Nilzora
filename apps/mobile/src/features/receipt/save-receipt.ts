import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/*
 * Saving a receipt PDF on the phone
 * ---------------------------------
 * The PDF is built by the API and downloaded with the customer's own access token, so it
 * matches the receipt on screen exactly. Android then hands the file to the customer's own
 * storage through the system folder picker (Storage Access Framework): the app never writes
 * silently into a shared folder, and the customer chooses where their receipt goes.
 *
 * The SAF API takes base64 text, so the bytes are encoded here — a few lines of the standard
 * alphabet rather than another dependency for one button.
 */

/** Whether this platform can hand a downloaded receipt to the customer's own files. */
export const CAN_SAVE_RECEIPT = Platform.OS === 'android';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of the bytes (no line breaks). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += ALPHABET[first >> 2];
    out += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out += second === undefined ? '=' : ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? '=' : ALPHABET[third & 0x3f];
  }
  return out;
}

/** `Nilzora-Receipt-NZ100042.pdf` → `Nilzora-Receipt-NZ100042`. */
function withoutExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

/** `saved` only when the file really was written to the folder the customer chose. */
export type SaveResult = 'saved' | 'cancelled' | 'failed';

/*
 * There is no platform branch here: the folder picker only exists on Android, so on any other
 * platform the call below throws and the customer is told the receipt could not be saved.
 * The screen does not offer the button off Android in the first place.
 */
export async function saveReceiptPdf(bytes: Uint8Array, fileName: string): Promise<SaveResult> {
  try {
    const folder = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!folder.granted) return 'cancelled';
    // The system adds the extension from the MIME type, so the name goes in without one.
    const target = await FileSystem.StorageAccessFramework.createFileAsync(
      folder.directoryUri,
      withoutExtension(fileName),
      'application/pdf',
    );
    await FileSystem.writeAsStringAsync(target, toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return 'saved';
  } catch {
    return 'failed';
  }
}
