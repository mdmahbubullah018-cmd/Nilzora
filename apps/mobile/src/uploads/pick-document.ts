import { CHAT_DOCUMENT_TYPES, chatMediaMaxBytes, chatMediaMaxLabel } from '@nilzora/contracts';
import * as DocumentPicker from 'expo-document-picker';

/*
 * Choosing a document
 * -------------------
 * The phone's own document browser (Storage Access Framework on Android), limited to the types
 * the server accepts. The picker cannot be trusted to honour `type`, so the chosen file's type
 * is checked here as well and the size is checked against the contract's document ceiling before
 * a single byte is uploaded — a 40 MB file is refused on the device rather than after the
 * transfer.
 *
 * The result is a local URI the existing upload transport reads; nothing is copied or moved by
 * this module, and the app never asks for storage permission because the picker's own grant is
 * enough for the file the person picked.
 */

export interface PickedDocument {
  uri: string;
  name: string;
  contentType: (typeof CHAT_DOCUMENT_TYPES)[number];
  byteSize: number;
}

export type PickDocumentResult =
  | { kind: 'picked'; document: PickedDocument }
  | { kind: 'cancelled' }
  | { kind: 'refused'; message: string };

const DOCUMENT_TYPES: readonly string[] = CHAT_DOCUMENT_TYPES;
const MAX_BYTES = chatMediaMaxBytes('document');
const MAX_LABEL = chatMediaMaxLabel('document');

/** The extension the picker reports, mapped to the type the server will accept. */
function typeFromName(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return null;
}

export async function pickSupportDocument(): Promise<PickDocumentResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    // The system browser is offered only the accepted types; the checks below do not rely on it.
    type: [...DOCUMENT_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return { kind: 'cancelled' };
  const asset = picked.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };

  const name = asset.name;
  const reported = (asset.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const contentType = DOCUMENT_TYPES.includes(reported) ? reported : typeFromName(name);
  if (contentType === null || !DOCUMENT_TYPES.includes(contentType)) {
    return {
      kind: 'refused',
      message: 'Attach a PDF, TXT, CSV, DOCX or XLSX file.',
    };
  }

  const byteSize = asset.size ?? 0;
  if (byteSize <= 0) {
    return { kind: 'refused', message: 'That file could not be read. Choose another.' };
  }
  if (byteSize > MAX_BYTES) {
    return { kind: 'refused', message: `That file is larger than ${MAX_LABEL}.` };
  }

  return {
    kind: 'picked',
    document: {
      uri: asset.uri,
      name,
      contentType: contentType as PickedDocument['contentType'],
      byteSize,
    },
  };
}
