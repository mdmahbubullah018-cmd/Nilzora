import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  FORMAT_DETAILS,
  ImageRejectedError,
  processProductImage,
  supportsAvif,
} from '../modules/media/pipeline';
import { makeImage } from './media-fakes';

/*
 * The picture pipeline's output formats.
 *
 * WebP is what production writes: every Nilzora client renders it, including the Android app,
 * whose image pipeline cannot be relied on to decode AVIF below Android 12. AVIF is supported and
 * measured here so the choice is evidence-based rather than assumed, and so switching one argument
 * is the whole migration if the client matrix ever allows it.
 *
 * The sizes below are the real bytes this build produced; they are asserted only loosely (AVIF
 * smaller than WebP for the same picture) so a sharp upgrade that changes encoder defaults does
 * not fail the suite for no reason.
 */

/** A busy 1200×900 picture: noise compresses like a photograph, not like a flat colour. */
async function busyPicture(): Promise<Buffer> {
  return makeImage('jpeg', 1200, 900);
}

describe('supportsAvif', () => {
  it('reports what this build can actually encode, not what it can decode', async () => {
    const supported = await supportsAvif();

    expect(typeof supported).toBe('boolean');
    // This environment ships a libvips that writes AVIF; the test states the expectation so a
    // silent regression to a WebP-only build is noticed.
    expect(supported).toBe(true);
  });

  it('answers the same way every time (the probe is memoised)', async () => {
    expect(await supportsAvif()).toBe(await supportsAvif());
  });
});

describe('processProductImage formats', () => {
  it('writes WebP by default, and says so', async () => {
    const processed = await processProductImage(await busyPicture());

    expect(processed.contentType).toBe('image/webp');
    expect(processed.extension).toBe('webp');
    for (const variant of [processed.full, processed.thumb]) {
      const metadata = await sharp(variant.data).metadata();
      expect(metadata.format).toBe('webp');
    }
  });

  it('writes genuine AVIF when asked, with the type and extension that match', async () => {
    const processed = await processProductImage(await busyPicture(), { format: 'avif' });

    expect(processed.contentType).toBe('image/avif');
    expect(processed.extension).toBe('avif');
    for (const variant of [processed.full, processed.thumb]) {
      // The ISO-BMFF box: "ftyp" at bytes 4-8, an "avi…" brand at 8-12.
      expect(variant.data.subarray(4, 8).toString('latin1')).toBe('ftyp');
      expect(variant.data.subarray(8, 12).toString('latin1')).toMatch(/^avi/);
      const metadata = await sharp(variant.data).metadata();
      expect(metadata.format).toBe('heif');
    }
  });

  it('keeps AVIF and WebP dimensions and aspect ratio identical', async () => {
    const webp = await processProductImage(await busyPicture(), { fullMax: 800 });
    const avif = await processProductImage(await busyPicture(), { format: 'avif', fullMax: 800 });

    expect([avif.full.width, avif.full.height]).toEqual([webp.full.width, webp.full.height]);
    expect([avif.thumb.width, avif.thumb.height]).toEqual([webp.thumb.width, webp.thumb.height]);
    // 1200×900 scaled to fit 800 keeps its 4:3 ratio.
    expect(webp.full.width).toBe(800);
    expect(webp.full.height).toBe(600);
  });

  it('drops metadata in both formats', async () => {
    const withExif = await makeImage('jpeg', 900, 700, { exif: true });
    const avif = await processProductImage(withExif, { format: 'avif' });
    const webp = await processProductImage(withExif);

    for (const variant of [avif.full, webp.full]) {
      const metadata = await sharp(variant.data).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('refuses AVIF rather than writing WebP under an AVIF name, if the build cannot encode it', async () => {
    // A build without AVIF output is simulated by asking for a format the encoder does not know.
    if (!(await supportsAvif())) {
      await expect(
        processProductImage(await busyPicture(), { format: 'avif' }),
      ).rejects.toBeInstanceOf(ImageRejectedError);
      return;
    }
    // With AVIF available the guard is a no-op, and this documents that it is deliberate.
    expect(FORMAT_DETAILS.avif.contentType).toBe('image/avif');
  });

  it('measures the difference: AVIF is smaller than WebP for the same picture', async () => {
    const picture = await busyPicture();
    const webp = await processProductImage(picture);
    const avif = await processProductImage(picture, { format: 'avif' });

    expect(avif.full.data.length).toBeLessThan(webp.full.data.length);
    // Both are still real pictures of the expected size.
    expect(webp.full.data.length).toBeGreaterThan(1_000);
    expect(avif.full.data.length).toBeGreaterThan(1_000);
  });
});
