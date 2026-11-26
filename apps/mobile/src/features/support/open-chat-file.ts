import type { DownloadedFile } from '@nilzora/api-client';
import type { ChatAttachment } from '@nilzora/contracts';
import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Share } from 'react-native';
import { toBase64 } from '@/features/receipt/save-receipt';

/*
 * Opening a document from a conversation
 * --------------------------------------
 * A support document is private, so it cannot be opened by address: the app downloads it once with
 * the account's own token (the bytes come through the authenticated media route) into its private
 * cache directory and then hands the local copy to the platform.
 *
 * What the platform does with the local copy, with the modules the app already ships:
 *
 *   iOS      the system share sheet with the file ("Open in ...", "Save to Files", Print, Mail).
 *   Android  `File.preview()` from expo-file-system (SDK 58): it turns the cache file into a
 *            `content://` URI through the module's own FileProvider (cache paths only, not
 *            exported) and starts an ACTION_VIEW intent with the read grant given to the apps that
 *            can handle the document type, so the customer's PDF / Office viewer opens it.
 *            If no installed app can open the type, or the installed build predates the native
 *            method, the file is saved to a folder the customer picks through the system folder
 *            chooser instead (the same route as the receipt PDF), and opened from Files.
 *
 * Nothing is written outside the app's cache except a file the customer chose to save, and no
 * public address for the file exists at any point.
 */

export type OpenChatFileResult =
  | { kind: 'opened' }
  | { kind: 'saved' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

/** Characters that must not reach a path, whatever the stored name says. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]+/g, '_').trim();
  return cleaned === '' ? 'file' : cleaned.slice(0, 80);
}

function withoutExtension(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,8}$/, '');
}

/** Writes the downloaded bytes to the app's cache, replacing an earlier copy. */
async function writeToCache(attachment: ChatAttachment, bytes: Uint8Array): Promise<File> {
  const target = new File(
    Paths.cache,
    `chat-doc-${attachment.id}-${safeName(attachment.fileName)}`,
  );
  if (target.exists) target.delete();
  target.create();
  await target.write(bytes);
  return target;
}

/** Saves the bytes to a folder the customer picks (Android's storage access framework). */
async function saveToChosenFolder(
  attachment: ChatAttachment,
  downloaded: DownloadedFile,
): Promise<OpenChatFileResult> {
  try {
    const folder = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!folder.granted) return { kind: 'cancelled' };
    const target = await FileSystem.StorageAccessFramework.createFileAsync(
      folder.directoryUri,
      withoutExtension(safeName(attachment.fileName)),
      attachment.contentType,
    );
    await FileSystem.writeAsStringAsync(target, toBase64(downloaded.bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { kind: 'saved' };
  } catch {
    return { kind: 'failed', message: 'The file could not be saved. Try again.' };
  }
}

/**
 * Downloads one document and gives it to the platform. `download` fetches the bytes with the
 * caller's own token; a failure at any step is a result the card can say, never a thrown error.
 */
export async function openChatDocument(
  attachment: ChatAttachment,
  download: () => Promise<DownloadedFile>,
): Promise<OpenChatFileResult> {
  let downloaded: DownloadedFile;
  try {
    downloaded = await download();
  } catch {
    return { kind: 'failed', message: 'The file could not be downloaded. Try again.' };
  }

  if (Platform.OS === 'android') {
    try {
      const local = await writeToCache(attachment, downloaded.bytes);
      await local.preview({ title: attachment.fileName, mimeType: attachment.contentType });
      return { kind: 'opened' };
    } catch {
      // No app can open this type, or the installed build has no native preview: offer the
      // folder chooser rather than leaving the customer without the file.
      return saveToChosenFolder(attachment, downloaded);
    }
  }

  try {
    const local = await writeToCache(attachment, downloaded.bytes);
    const shared = await Share.share({ url: local.uri, title: attachment.fileName });
    return shared.action === Share.dismissedAction ? { kind: 'cancelled' } : { kind: 'opened' };
  } catch {
    return { kind: 'failed', message: 'The file could not be opened. Try again.' };
  }
}
