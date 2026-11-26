import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  FULL_MAX_SIZE,
  ImageRejectedError,
  processProductImage,
  THUMB_MAX_SIZE,
} from '../modules/media/pipeline';
import { makeAnimatedWebp, makeImage } from './media-fakes';

async function reasonFor(input: Buffer): Promise<string> {
  try {
    await processProductImage(input);
  } catch (error) {
    if (error instanceof ImageRejectedError) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('processProductImage', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'turns a %s into full and thumb WebP files',
    async (format) => {
      const { full, thumb } = await processProductImage(await makeImage(format, 2400, 1800));

      expect((await sharp(full.data).metadata()).format).toBe('webp');
      expect((await sharp(thumb.data).metadata()).format).toBe('webp');
      expect(full).toMatchObject({ width: FULL_MAX_SIZE, height: 1200 });
      expect(thumb).toMatchObject({ width: THUMB_MAX_SIZE, height: 360 });
      expect(thumb.data.length).toBeLessThan(full.data.length);
    },
  );

  it('never enlarges a picture smaller than the variant sizes', async () => {
    const { full, thumb } = await processProductImage(await makeImage('png', 450, 420));

    expect(full).toMatchObject({ width: 450, height: 420 });
    expect(thumb).toMatchObject({ width: 450, height: 420 });
  });

  it('fits tall pictures inside the same bounds', async () => {
    const { full, thumb } = await processProductImage(await makeImage('jpeg', 900, 3000));

    expect(full).toMatchObject({ width: 480, height: FULL_MAX_SIZE });
    expect(thumb).toMatchObject({ width: 144, height: THUMB_MAX_SIZE });
  });

  it('strips EXIF and GPS data and applies the orientation to the pixels', async () => {
    const source = await makeImage('jpeg', 800, 600, { exif: true });
    const before = await sharp(source).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const { full, thumb } = await processProductImage(source);

    for (const variant of [full, thumb]) {
      const after = await sharp(variant.data).metadata();
      expect(after.exif).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.orientation).toBeUndefined();
      // Orientation 6 turns a landscape 800x600 into a portrait 600x800.
      expect(after.width).toBeLessThan(after.height ?? 0);
    }
    expect(full).toMatchObject({ width: 600, height: 800 });
    expect(full.data.includes(Buffer.from('Nilzora test'))).toBe(false);
  });

  it('refuses pictures that are too small on the shorter side', async () => {
    expect(await reasonFor(await makeImage('jpeg', 399, 900))).toBe('too_small');
    expect(await reasonFor(await makeImage('png', 900, 300))).toBe('too_small');
  });

  it('accepts the minimum size', async () => {
    expect(await reasonFor(await makeImage('png', 400, 400))).toBe('accepted');
  });

  it('refuses pictures beyond the pixel limit before decoding them', async () => {
    const huge = await sharp({
      create: { width: 8001, height: 500, channels: 3, background: '#223344' },
    })
      .png()
      .toBuffer();

    expect(await reasonFor(huge)).toBe('too_large');
  });

  it('refuses animated images', async () => {
    expect(await reasonFor(await makeAnimatedWebp())).toBe('animated');
  });

  it('refuses a GIF even though it is a real picture (the formats are fixed)', async () => {
    const gif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#aa3300' },
    })
      .gif()
      .toBuffer();

    expect(await reasonFor(gif)).toBe('unsupported_format');
  });

  it('refuses text, HTML and script bytes whatever they claim to be', async () => {
    expect(await reasonFor(Buffer.from('<html><script>alert(1)</script></html>'))).toBe(
      'unsupported_format',
    );
    expect(await reasonFor(Buffer.from('GIF89a<svg onload=alert(1)>'))).toBe('unsupported_format');
    expect(
      await reasonFor(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>'),
      ),
    ).toBe('unsupported_format');
    expect(await reasonFor(Buffer.alloc(0))).toBe('unsupported_format');
  });

  it('refuses a polyglot whose picture bytes are followed by script, by re-encoding only the picture', async () => {
    const picture = await makeImage('jpeg', 800, 600);
    const polyglot = Buffer.concat([picture, Buffer.from('<script>alert(1)</script>')]);

    const { full, thumb } = await processProductImage(polyglot);

    expect(full.data.includes(Buffer.from('<script>'))).toBe(false);
    expect(thumb.data.includes(Buffer.from('<script>'))).toBe(false);
  });

  it('refuses a truncated picture', async () => {
    const picture = await makeImage('png', 800, 600);

    expect(await reasonFor(picture.subarray(0, Math.floor(picture.length / 2)))).toBe('corrupt');
  });

  it('trusts the bytes, not a claimed type: a PNG is processed as a PNG', async () => {
    const png = await makeImage('png', 700, 700);

    expect(await reasonFor(png)).toBe('accepted');
  });
});
