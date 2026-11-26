import type { ChatAttachment } from '@nilzora/contracts';
import { Platform, Share } from 'react-native';
import { openChatDocument } from '@/features/support/open-chat-file';

const mockPreview = jest.fn();
// The shared fake File has no `preview` (it is only used by upload tests), so this suite adds it.
jest.mock('expo-file-system', () => {
  const base = jest.requireActual<{
    expoFileSystemMock: { File: new (...parts: (string | { uri: string })[]) => object };
  }>('@/test-utils/upload-fakes').expoFileSystemMock;
  class PreviewFile extends base.File {
    preview(options: unknown): Promise<void> {
      return mockPreview(options) as Promise<void>;
    }
  }
  return { ...base, File: PreviewFile };
});

const mockRequestDirectory = jest.fn();
const mockCreateFile = jest.fn();
const mockWriteString = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    get requestDirectoryPermissionsAsync() {
      return mockRequestDirectory;
    },
    get createFileAsync() {
      return mockCreateFile;
    },
  },
  get writeAsStringAsync() {
    return mockWriteString;
  },
  EncodingType: { Base64: 'base64' },
}));

const DOC: ChatAttachment = {
  id: '00000000-0000-4000-8000-0000000000a1',
  fileName: 'Invoice 7.pdf',
  contentType: 'application/pdf',
  byteSize: 4,
  width: null,
  height: null,
  durationMs: null,
  url: '/chat/attachments/x/media',
  thumbnailUrl: null,
};

const download = () =>
  Promise.resolve({
    bytes: new Uint8Array([37, 80, 68, 70]),
    fileName: DOC.fileName,
    contentType: DOC.contentType,
  });

function platform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  jest.restoreAllMocks();
  mockRequestDirectory.mockReset();
  mockCreateFile.mockReset();
  mockWriteString.mockReset();
  mockPreview.mockReset();
  platform('ios');
});

describe('opening a chat document', () => {
  it('shares the downloaded cache copy on iOS', async () => {
    platform('ios');
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'opened' });

    const given = share.mock.calls[0]?.[0] as { url: string };
    expect(given.url).toMatch(/^file:\/\/\/cache\/chat-doc-.*Invoice 7\.pdf$/);
  });

  it('reports a dismissed share sheet as cancelled, not as a failure', async () => {
    platform('ios');
    jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'dismissedAction', activityType: undefined });

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'cancelled' });
  });

  it('opens the cache copy in a viewer app on Android, without saving anything', async () => {
    platform('android');
    mockPreview.mockResolvedValue(undefined);

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'opened' });

    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(mockPreview).toHaveBeenCalledWith({
      title: 'Invoice 7.pdf',
      mimeType: 'application/pdf',
    });
    expect(mockRequestDirectory).not.toHaveBeenCalled();
    expect(mockWriteString).not.toHaveBeenCalled();
  });

  it('falls back to saving into a folder the customer chooses when no app can open it', async () => {
    platform('android');
    mockPreview.mockRejectedValue(new Error('FilePreviewUnsupported'));
    mockRequestDirectory.mockResolvedValue({ granted: true, directoryUri: 'content://dir' });
    mockCreateFile.mockResolvedValue('content://dir/file');
    mockWriteString.mockResolvedValue(undefined);

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'saved' });

    expect(mockCreateFile).toHaveBeenCalledWith('content://dir', 'Invoice 7', 'application/pdf');
    expect(mockWriteString).toHaveBeenCalledWith('content://dir/file', 'JVBERg==', {
      encoding: 'base64',
    });
  });

  it('falls back to the folder chooser when the installed build has no native preview', async () => {
    platform('android');
    mockPreview.mockImplementation(() => {
      throw new TypeError('preview is not a function');
    });
    mockRequestDirectory.mockResolvedValue({ granted: false });

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'cancelled' });
    expect(mockRequestDirectory).toHaveBeenCalledTimes(1);
  });

  it('is cancelled when no app can open it and the customer does not choose a folder', async () => {
    platform('android');
    mockPreview.mockRejectedValue(new Error('FilePreviewUnsupported'));
    mockRequestDirectory.mockResolvedValue({ granted: false });

    await expect(openChatDocument(DOC, download)).resolves.toEqual({ kind: 'cancelled' });
    expect(mockCreateFile).not.toHaveBeenCalled();
  });

  it('says the file could not be saved when the fallback fails too', async () => {
    platform('android');
    mockPreview.mockRejectedValue(new Error('FilePreviewUnsupported'));
    mockRequestDirectory.mockRejectedValue(new Error('no folder picker'));

    await expect(openChatDocument(DOC, download)).resolves.toEqual({
      kind: 'failed',
      message: 'The file could not be saved. Try again.',
    });
  });

  it('says what went wrong when the download or the hand-over fails', async () => {
    platform('ios');
    await expect(
      openChatDocument(DOC, () => Promise.reject(new Error('offline'))),
    ).resolves.toEqual({ kind: 'failed', message: 'The file could not be downloaded. Try again.' });

    jest.spyOn(Share, 'share').mockRejectedValue(new Error('no activity'));
    await expect(openChatDocument(DOC, download)).resolves.toEqual({
      kind: 'failed',
      message: 'The file could not be opened. Try again.',
    });
  });
});
