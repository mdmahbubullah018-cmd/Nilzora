import { pickImages } from '@/uploads/pick-images';
import {
  choose,
  chooseNothing,
  fakeAsset,
  launchImageLibraryAsync,
} from '@/test-utils/upload-fakes';

jest.mock(
  'expo-image-picker',
  () =>
    jest.requireActual<{ expoImagePickerMock: object }>('@/test-utils/upload-fakes')
      .expoImagePickerMock,
);

beforeEach(() => launchImageLibraryAsync.mockReset());

const AVATAR = { limit: 1, minSide: 128 };
const REVIEW = { limit: 4, minSide: 300 };

describe('pickImages', () => {
  it('opens the system photo picker for pictures only, without location data', async () => {
    chooseNothing();
    await pickImages(REVIEW);

    expect(launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 4,
        exif: false,
      }),
    );
  });

  it('picks a single picture when the limit is one', async () => {
    chooseNothing();
    await pickImages(AVATAR);
    const [options] = launchImageLibraryAsync.mock.calls[0] as [Record<string, unknown>];
    expect(options.allowsMultipleSelection).toBe(false);
    expect(options).not.toHaveProperty('selectionLimit');
  });

  it('reports a cancelled picker as such', async () => {
    chooseNothing();
    await expect(pickImages(AVATAR)).resolves.toEqual({ kind: 'cancelled' });
  });

  it('returns usable pictures with their size, type and dimensions', async () => {
    choose(fakeAsset({ fileName: 'a.png', mimeType: 'image/png', fileSize: 1234 }));
    const result = await pickImages(AVATAR);

    expect(result).toEqual({
      kind: 'picked',
      rejected: [],
      images: [
        {
          uri: 'file:///cache/me.jpg',
          fileName: 'a.png',
          contentType: 'image/png',
          size: 1234,
          width: 800,
          height: 800,
        },
      ],
    });
  });

  it('refuses the wrong type, an oversized file and out-of-range dimensions, keeping the good ones', async () => {
    choose(
      fakeAsset({ uri: 'file:///1.jpg', fileName: 'good.jpg' }),
      fakeAsset({ uri: 'file:///2.gif', fileName: 'anim.gif', mimeType: 'image/gif' }),
      fakeAsset({ uri: 'file:///3.jpg', fileName: 'huge.jpg', fileSize: 5 * 1024 * 1024 + 1 }),
      fakeAsset({ uri: 'file:///4.jpg', fileName: 'tiny.jpg', width: 100, height: 900 }),
      fakeAsset({ uri: 'file:///5.jpg', fileName: 'wide.jpg', width: 9000, height: 900 }),
    );
    const result = await pickImages({ limit: 5, minSide: 300 });

    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images.map((i) => i.fileName)).toEqual(['good.jpg']);
    expect(result.rejected).toEqual([
      'anim.gif: Upload a JPEG, PNG or WebP picture.',
      'huge.jpg: This image is larger than 5 MB. Choose a smaller one.',
      'tiny.jpg: This picture is too small. Choose one at least 300 pixels on each side.',
      'wide.jpg: This picture is too large. Choose one no more than 8000 pixels on a side.',
    ]);
  });

  it('judges the file by its extension when the system reports no type', async () => {
    choose(
      fakeAsset({
        uri: 'file:///x/photo.webp',
        fileName: undefined as unknown as string,
        mimeType: undefined as unknown as string,
      }),
    );
    const result = await pickImages(AVATAR);
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images[0]).toMatchObject({ contentType: 'image/webp', fileName: 'photo.webp' });
  });

  it('never returns more pictures than asked for', async () => {
    choose(
      fakeAsset({ uri: 'file:///1.jpg' }),
      fakeAsset({ uri: 'file:///2.jpg' }),
      fakeAsset({ uri: 'file:///3.jpg' }),
    );
    const result = await pickImages({ limit: 2, minSide: 128 });
    if (result.kind !== 'picked') throw new Error('expected a pick');
    expect(result.images).toHaveLength(2);
  });

  it('turns a picker failure into a plain message instead of crashing', async () => {
    launchImageLibraryAsync.mockRejectedValueOnce(new Error('permission denied'));
    const result = await pickImages(AVATAR);
    expect(result).toMatchObject({ kind: 'error' });
    expect(JSON.stringify(result)).not.toContain('permission denied');
  });
});
