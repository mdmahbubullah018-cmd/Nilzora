import { saveReceiptPdf, toBase64 } from '../features/receipt/save-receipt';

/* The Android folder picker, faked: a test never touches a real file system. */
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
  },
  writeAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

interface FakeFileSystem {
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.Mock;
    createFileAsync: jest.Mock;
  };
  writeAsStringAsync: jest.Mock;
}

const files = jest.requireMock<FakeFileSystem>('expo-file-system/legacy');
const picker = files.StorageAccessFramework;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
const NAME = 'Nilzora-Receipt-NZ100042.pdf';

beforeEach(() => {
  picker.requestDirectoryPermissionsAsync.mockReset();
  picker.createFileAsync.mockReset();
  files.writeAsStringAsync.mockReset();
  picker.requestDirectoryPermissionsAsync.mockResolvedValue({
    granted: true,
    directoryUri: 'content://picked',
  });
  picker.createFileAsync.mockResolvedValue('content://picked/Nilzora-Receipt-NZ100042.pdf');
  files.writeAsStringAsync.mockResolvedValue(undefined);
});

describe('toBase64', () => {
  it.each([
    ['an empty file', new Uint8Array([]), ''],
    ['one byte', new Uint8Array([0x66]), 'Zg=='],
    ['two bytes', new Uint8Array([0x66, 0x6f]), 'Zm8='],
    ['three bytes', new Uint8Array([0x66, 0x6f, 0x6f]), 'Zm9v'],
    ['the PDF magic line', PDF, 'JVBERg=='],
    ['all six-bit values', new Uint8Array([0xfb, 0xff, 0xbf]), '+/+/'],
  ])('encodes %s', (_name, bytes, expected) => {
    expect(toBase64(bytes)).toBe(expected);
  });
});

describe('saveReceiptPdf', () => {
  it('writes the PDF into the folder the customer picked', async () => {
    expect(await saveReceiptPdf(PDF, NAME)).toBe('saved');

    expect(picker.createFileAsync).toHaveBeenCalledWith(
      'content://picked',
      // The system appends ".pdf" from the MIME type, so the name must not carry it.
      'Nilzora-Receipt-NZ100042',
      'application/pdf',
    );
    expect(files.writeAsStringAsync).toHaveBeenCalledWith(
      'content://picked/Nilzora-Receipt-NZ100042.pdf',
      'JVBERg==',
      { encoding: 'base64' },
    );
  });

  it('writes nothing when the customer backs out of the folder picker', async () => {
    picker.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: false,
      directoryUri: null,
    });

    expect(await saveReceiptPdf(PDF, NAME)).toBe('cancelled');
    expect(picker.createFileAsync).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing when the file cannot be written', async () => {
    files.writeAsStringAsync.mockRejectedValue(new Error('no space'));

    expect(await saveReceiptPdf(PDF, NAME)).toBe('failed');
  });
});
