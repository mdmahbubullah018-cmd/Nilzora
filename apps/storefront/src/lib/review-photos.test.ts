import { MAX_REVIEW_IMAGES, PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUEUE,
  isUploading,
  photoKey,
  photoReducer,
  photoTally,
  uploadStateOf,
  type PhotoAction,
  type PhotoQueue,
} from './review-photos';

function image(name: string, size = 2048, type = 'image/jpeg'): File {
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type, lastModified: 1 });
  // jsdom's File.size follows the content; the reported size is what the rules read.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function run(actions: PhotoAction[], from: PhotoQueue = EMPTY_QUEUE): PhotoQueue {
  return actions.reduce(photoReducer, from);
}

describe('choosing photos', () => {
  it('accepts valid pictures and keeps their order', () => {
    const queue = run([
      { type: 'choose', files: [image('a.jpg'), image('b.png', 100, 'image/png')] },
    ]);

    expect(queue.photos.map((photo) => photo.file.name)).toEqual(['a.jpg', 'b.png']);
    expect(queue.photos.every((photo) => photo.status === 'selected' && photo.percent === 0)).toBe(
      true,
    );
    expect(queue.notice).toBeNull();
  });

  it('applies the same size and type rules as the API and says which file was refused', () => {
    const queue = run([
      {
        type: 'choose',
        files: [
          image('big.jpg', PRODUCT_IMAGE_MAX_BYTES + 1),
          image('notes.pdf', 100, 'application/pdf'),
          image('ok.jpg'),
        ],
      },
    ]);

    expect(queue.photos.map((photo) => photo.file.name)).toEqual(['ok.jpg']);
    expect(queue.notice).toContain('big.jpg');
    expect(queue.notice).toContain('notes.pdf');
  });

  it(`never holds more than ${String(MAX_REVIEW_IMAGES)} photos`, () => {
    const files = Array.from({ length: MAX_REVIEW_IMAGES + 2 }, (_, index) =>
      image(`p${String(index)}.jpg`),
    );

    const queue = run([{ type: 'choose', files }]);

    expect(queue.photos).toHaveLength(MAX_REVIEW_IMAGES);
    expect(queue.notice).toContain(`at most ${String(MAX_REVIEW_IMAGES)}`);
  });

  it('ignores the same picture chosen twice', () => {
    const queue = run([
      { type: 'choose', files: [image('a.jpg')] },
      { type: 'choose', files: [image('a.jpg')] },
    ]);

    expect(queue.photos).toHaveLength(1);
    expect(photoKey(image('a.jpg'))).toBe(photoKey(image('a.jpg')));
  });

  it('removes a photo before it is sent', () => {
    const first = image('a.jpg');
    const queue = run([
      { type: 'choose', files: [first, image('b.jpg')] },
      { type: 'remove', key: photoKey(first) },
    ]);

    expect(queue.photos.map((photo) => photo.file.name)).toEqual(['b.jpg']);
  });
});

describe('uploading photos', () => {
  const file = image('a.jpg', 4096);
  const key = photoKey(file);
  const chosen = run([{ type: 'choose', files: [file] }]);

  it('records the browser-reported bytes, then waits for the server before saying done', () => {
    const sending = run([{ type: 'sending', key }], chosen);
    expect(uploadStateOf(sending.photos[0]!)).toMatchObject({ phase: 'transferring', percent: 0 });
    expect(isUploading(sending)).toBe(true);

    const halfway = run(
      [{ type: 'progress', key, loaded: 2100, total: 4200, percent: 50 }],
      sending,
    );
    expect(uploadStateOf(halfway.photos[0]!)).toMatchObject({
      phase: 'transferring',
      loaded: 2100,
      total: 4200,
      percent: 50,
    });

    const sent = run([{ type: 'processing', key }], halfway);
    // Every byte is sent, but the photo is not on the review until the server says so.
    expect(uploadStateOf(sent.photos[0]!).phase).toBe('processing');
    expect(photoTally(sent).done).toBe(0);
    expect(isUploading(sent)).toBe(true);

    const done = run([{ type: 'done', key, imageId: 'img-1' }], sent);
    expect(uploadStateOf(done.photos[0]!).phase).toBe('success');
    expect(done.photos[0]?.imageId).toBe('img-1');
    expect(photoTally(done)).toEqual({ done: 1, failed: 0, total: 1 });
    expect(isUploading(done)).toBe(false);
  });

  it('keeps a failed photo, with whether trying again is safe, beside the ones that worked', () => {
    const other = image('b.jpg', 4096);
    const queue = run(
      [
        { type: 'choose', files: [file, other] },
        { type: 'done', key, imageId: 'img-1' },
        { type: 'failed', key: photoKey(other), message: 'Lost the connection.', canRetry: true },
      ],
      EMPTY_QUEUE,
    );

    expect(photoTally(queue)).toEqual({ done: 1, failed: 1, total: 2 });
    expect(uploadStateOf(queue.photos[1]!)).toMatchObject({
      phase: 'error',
      message: 'Lost the connection.',
      canRetry: true,
    });
    // The successful photo is untouched by its neighbour's failure.
    expect(uploadStateOf(queue.photos[0]!).phase).toBe('success');
  });

  it('starts a retry from zero and clears the old failure', () => {
    const failed = run(
      [
        { type: 'progress', key, loaded: 900, total: 4200, percent: 21 },
        { type: 'failed', key, message: 'Lost.', canRetry: true },
      ],
      chosen,
    );

    const again = run([{ type: 'sending', key }], failed);

    expect(again.photos[0]).toMatchObject({
      status: 'sending',
      loaded: 0,
      percent: 0,
      canRetry: false,
    });
    expect(again.photos[0]?.message).toBeUndefined();
  });

  it('resets to an empty queue', () => {
    expect(run([{ type: 'reset' }], chosen)).toEqual(EMPTY_QUEUE);
  });
});
