import { CHAT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { pickChatImages } from '@/features/support/pick-chat-image';
import {
  capture,
  captureNothing,
  choose,
  chooseNothing,
  fakeAsset,
  launchCameraAsync,
  launchImageLibraryAsync,
  permissions,
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
} from '@/test-utils/upload-fakes';

jest.mock(
  'expo-image-picker',
  () =>
    jest.requireActual<{ expoImagePickerMock: object }>('@/test-utils/upload-fakes')
      .expoImagePickerMock,
);

jest.mock(
  'expo-file-system',
  () =>
    jest.requireActual<{ expoFileSystemMock: object }>('@/test-utils/upload-fakes')
      .expoFileSystemMock,
);

beforeEach(() => {
  launchImageLibraryAsync.mockReset();
  launchCameraAsync.mockReset();
  requestMediaLibraryPermissionsAsync.mockReset();
  requestCameraPermissionsAsync.mockReset();
  permissions(true);
});

/** The message of a refusal, failing the test when the result is not one. */
function refusalMessage(result: Awaited<ReturnType<typeof pickChatImages>>): string {
  if (result.kind !== 'refused') throw new Error(`expected a refusal, got ${result.kind}`);
  return result.message;
}

describe('picking chat pictures from the gallery', () => {
  it('asks for permission, then opens the system picker for several pictures', async () => {
    choose(fakeAsset());
    await pickChatImages('library');

    expect(requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true }),
    );
  });

  it('explains a refused permission instead of opening the picker', async () => {
    permissions(false);

    const result = await pickChatImages('library');
    expect(refusalMessage(result)).toContain('permission to open your photos');
    expect(launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('reports a cancelled picker as cancelled, not as an error', async () => {
    chooseNothing();
    await expect(pickChatImages('library')).resolves.toEqual({ kind: 'cancelled' });
  });

  it('answers with every file the person chose, and its real type', async () => {
    choose(
      fakeAsset({
        uri: 'file:///cache/receipt.png',
        fileName: 'receipt.png',
        mimeType: 'image/png',
        fileSize: 4096,
      }),
      fakeAsset({ fileName: 'box.jpg', mimeType: 'image/jpeg', fileSize: 8192 }),
    );

    await expect(pickChatImages('library')).resolves.toEqual({
      kind: 'picked',
      images: [
        {
          uri: 'file:///cache/receipt.png',
          name: 'receipt.png',
          contentType: 'image/png',
          byteSize: 4096,
        },
        {
          uri: 'file:///cache/me.jpg',
          name: 'box.jpg',
          contentType: 'image/jpeg',
          byteSize: 8192,
        },
      ],
    });
  });

  it('refuses pictures above the chat image limit before uploading anything', async () => {
    choose(fakeAsset({ fileSize: CHAT_IMAGE_MAX_BYTES + 1 }));

    expect(refusalMessage(await pickChatImages('library'))).toContain('larger than 10 MB');
  });

  it('keeps the pictures that fit and refuses the ones that do not', async () => {
    choose(
      fakeAsset({ fileName: 'small.png', mimeType: 'image/png', fileSize: 4096 }),
      fakeAsset({
        fileName: 'huge.png',
        mimeType: 'image/png',
        fileSize: CHAT_IMAGE_MAX_BYTES + 1,
      }),
    );

    const result = await pickChatImages('library');
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images.map((image) => image.name)).toEqual(['small.png']);
  });

  it('falls back to the URI name when the picker reports none', async () => {
    choose(fakeAsset({ fileName: '', uri: 'file:///cache/IMG_0042.jpg', mimeType: '' }));

    const result = await pickChatImages('library');
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images[0]?.name).toBe('IMG_0042.jpg');
    expect(result.images[0]?.contentType).toBe('image/jpeg');
  });
});

describe('what the picker really produced', () => {
  it('reads the size from the file when the picker omits it, instead of calling it empty', async () => {
    choose({ ...fakeAsset({ fileName: 'noisy.jpg' }), fileSize: undefined as unknown as number });

    const result = await pickChatImages('library');
    if (result.kind !== 'picked') throw new Error('expected a pick');
    // The test file system reports 48,000 bytes for any cached file.
    expect(result.images[0]?.byteSize).toBe(48_000);
  });

  it('declares the type of the re-encoded file, not of the original name', async () => {
    // The user chose shot.png, but quality 0.8 re-encoded it: the file written is a JPEG.
    choose(
      fakeAsset({
        fileName: 'shot.png',
        mimeType: 'image/png',
        uri: 'file:///cache/ImagePicker/abc.jpg',
        fileSize: 4096,
      }),
    );

    const result = await pickChatImages('library');
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images[0]?.contentType).toBe('image/jpeg');
  });

  it('refuses a format the chat cannot carry instead of guessing JPEG', async () => {
    choose(
      fakeAsset({
        fileName: 'live.heic',
        mimeType: 'image/heic',
        uri: 'content://media/external/images/42',
        fileSize: 4096,
      }),
    );

    expect(refusalMessage(await pickChatImages('library'))).toContain('JPEG, PNG or WebP');
  });

  it('never offers more pictures than the message has room for', async () => {
    choose(fakeAsset());
    await pickChatImages('library', 2);

    expect(launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ selectionLimit: 2, allowsMultipleSelection: true }),
    );
  });
});

describe('taking a chat picture with the camera', () => {
  it('opens the camera only after the camera permission is granted', async () => {
    capture(fakeAsset({ fileName: 'camera.jpg' }));

    const result = await pickChatImages('camera');
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images[0]?.name).toBe('camera.jpg');
    expect(requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(launchCameraAsync).toHaveBeenCalledTimes(1);
  });

  it('explains a refused camera permission', async () => {
    permissions(false);

    expect(refusalMessage(await pickChatImages('camera'))).toContain(
      'permission to use the camera',
    );
    expect(launchCameraAsync).not.toHaveBeenCalled();
  });

  it('says the camera is unavailable when the device has none, instead of failing silently', async () => {
    launchCameraAsync.mockRejectedValue(new Error('No camera activity'));

    expect(refusalMessage(await pickChatImages('camera'))).toContain('camera is not available');
  });

  it('reports backing out of the camera as cancelled', async () => {
    captureNothing();
    await expect(pickChatImages('camera')).resolves.toEqual({ kind: 'cancelled' });
  });
});
