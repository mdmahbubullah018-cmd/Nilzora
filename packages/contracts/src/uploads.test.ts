import { describe, expect, it } from 'vitest';
import { meResponseSchema, profileSchema } from './auth';
import { PRODUCT_IMAGE_MAX_BYTES } from './media';
import { productReviewsResponseSchema, myReviewSchema } from './reviews';
import {
  avatarResponseSchema,
  checkImageFile,
  checkReportedFile,
  IMAGE_NOT_SUPPORTED,
  IMAGE_TOO_BIG,
  MAX_REVIEW_IMAGES,
  reviewImageUploadResponseSchema,
  sniffImageType,
} from './uploads';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2];

/** The bytes of a plain ASCII string (this package has no TextEncoder or Buffer). */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function fileOf(bytes: readonly number[], type = 'image/png', size = bytes.length) {
  return { size, type, arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer) };
}

describe('sniffImageType', () => {
  it('reads the type from the first bytes, whatever the name or label says', () => {
    expect(sniffImageType(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImageType(new Uint8Array(JPEG))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array(WEBP))).toBe('image/webp');
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(ascii('GIF89a......'))).toBeNull();
  });
});

describe('checkReportedFile and checkImageFile', () => {
  it('refuses empty, oversized and wrongly typed files before reading them', () => {
    expect(checkReportedFile({ size: 0, type: 'image/png' })).not.toBeNull();
    expect(checkReportedFile({ size: PRODUCT_IMAGE_MAX_BYTES + 1, type: 'image/png' })).toBe(
      IMAGE_TOO_BIG,
    );
    expect(checkReportedFile({ size: 10, type: 'application/pdf' })).toBe(IMAGE_NOT_SUPPORTED);
    expect(checkReportedFile({ size: 10, type: 'image/png' })).toBeNull();
    // Some browsers report no type at all; the bytes are checked later.
    expect(checkReportedFile({ size: 10, type: '' })).toBeNull();
  });

  it('accepts a picture by its bytes and rejects a renamed non-picture', async () => {
    await expect(checkImageFile(fileOf(JPEG, 'image/png'))).resolves.toMatchObject({
      ok: true,
      contentType: 'image/jpeg',
    });
    await expect(checkImageFile(fileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).resolves.toEqual({
      ok: false,
      message: IMAGE_NOT_SUPPORTED,
    });
    await expect(checkImageFile(null)).resolves.toMatchObject({ ok: false });
    await expect(checkImageFile('a string field')).resolves.toMatchObject({ ok: false });
  });

  it('does not trust a reported size: the real bytes are measured too', async () => {
    const honest = fileOf(PNG, 'image/png', 100);
    const liar = {
      size: 100,
      type: 'image/png',
      arrayBuffer: () => Promise.resolve(new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1).buffer),
    };
    await expect(checkImageFile(honest)).resolves.toMatchObject({ ok: true });
    await expect(checkImageFile(liar)).resolves.toEqual({ ok: false, message: IMAGE_TOO_BIG });
  });
});

describe('upload contracts', () => {
  const picture = {
    url: 'https://media.example.com/a/full.webp',
    thumbUrl: 'https://media.example.com/a/thumb.webp',
  };
  const id = '0a000000-0000-4000-8000-000000000001';

  it('answers an avatar change with a picture or null', () => {
    expect(avatarResponseSchema.parse({ avatar: picture }).avatar).toEqual(picture);
    expect(avatarResponseSchema.parse({ avatar: null }).avatar).toBeNull();
    expect(avatarResponseSchema.safeParse({ avatar: { url: 'javascript:alert(1)' } }).success).toBe(
      false,
    );
  });

  it('keeps a review to the shared photo limit', () => {
    const photo = { id, ...picture };
    expect(
      reviewImageUploadResponseSchema.safeParse({ image: photo, images: [photo] }).success,
    ).toBe(true);
    const tooMany = Array.from({ length: MAX_REVIEW_IMAGES + 1 }, () => photo);
    expect(
      reviewImageUploadResponseSchema.safeParse({ image: photo, images: tooMany }).success,
    ).toBe(false);
  });

  it('adds photos and the avatar without breaking older answers that lack them', () => {
    const review = {
      id,
      rating: 5,
      title: null,
      body: 'Lovely, would buy again.',
      authorName: 'Ana R.',
      verified: true,
      createdAt: '2026-10-30T10:00:00.000Z',
    };
    const listing = {
      summary: {
        averageRating: 5,
        reviewCount: 1,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
      },
      reviews: [review],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    };
    expect(productReviewsResponseSchema.parse(listing).reviews[0]?.images).toEqual([]);
    expect(
      myReviewSchema.parse({
        eligible: true,
        review: {
          id,
          rating: 5,
          title: null,
          body: 'Lovely, would buy again.',
          status: 'pending',
          moderationNote: null,
          createdAt: review.createdAt,
          updatedAt: review.createdAt,
        },
      }).review?.images,
    ).toEqual([]);
    expect(
      profileSchema.parse({
        fullName: null,
        phone: null,
        status: 'active',
        createdAt: review.createdAt,
        updatedAt: review.createdAt,
      }).avatar,
    ).toBeNull();
    expect(meResponseSchema.shape.user.shape.profile).toBe(profileSchema);
  });
});
