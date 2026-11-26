import { CHAT_DOCUMENT_MAX_BYTES } from '@nilzora/contracts';
import { pickSupportDocument } from '@/uploads/pick-document';
import { FakeDocumentPicker } from '@/test-utils/document-picker-fake';

jest.mock(
  'expo-document-picker',
  () =>
    jest.requireActual<{ expoDocumentPickerMock: object }>('@/test-utils/document-picker-fake')
      .expoDocumentPickerMock,
);

beforeEach(() => FakeDocumentPicker.reset());

describe('pickSupportDocument', () => {
  it('accepts a PDF and reports the type the server allows', async () => {
    FakeDocumentPicker.next({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 120_000,
      uri: 'file:///cache/invoice.pdf',
    });

    const result = await pickSupportDocument();

    expect(result).toEqual({
      kind: 'picked',
      document: {
        uri: 'file:///cache/invoice.pdf',
        name: 'invoice.pdf',
        contentType: 'application/pdf',
        byteSize: 120_000,
      },
    });
  });

  it('derives the type from the name when the picker reports none', async () => {
    FakeDocumentPicker.next({ name: 'sheet.xlsx', size: 4_096, uri: 'file:///cache/sheet.xlsx' });

    const result = await pickSupportDocument();

    expect(result.kind).toBe('picked');
    if (result.kind !== 'picked') return;
    expect(result.document.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it.each(['setup.exe', 'archive.zip', 'script.sh', 'notes.pages'])(
    'refuses %s, which is not on the allowlist',
    async (name) => {
      FakeDocumentPicker.next({ name, size: 1_000, uri: 'file:///cache/file' });

      const result = await pickSupportDocument();

      expect(result.kind).toBe('refused');
      if (result.kind !== 'refused') return;
      expect(result.message).toContain('PDF, TXT, CSV, DOCX or XLSX');
    },
  );

  it('refuses a file above the document ceiling on the device', async () => {
    FakeDocumentPicker.next({
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      size: CHAT_DOCUMENT_MAX_BYTES + 1,
      uri: 'file:///cache/huge.pdf',
    });

    const result = await pickSupportDocument();

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.message).toContain('larger than 20 MB');
  });

  it('refuses an empty file rather than uploading nothing', async () => {
    FakeDocumentPicker.next({
      name: 'empty.pdf',
      mimeType: 'application/pdf',
      size: 0,
      uri: 'file:///cache/empty.pdf',
    });

    const result = await pickSupportDocument();

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.message).toContain('could not be read');
  });

  it('reports a cancelled picker without an error', async () => {
    FakeDocumentPicker.cancel();

    await expect(pickSupportDocument()).resolves.toEqual({ kind: 'cancelled' });
  });
});
