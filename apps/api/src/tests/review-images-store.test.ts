import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ownedPicture } from '../modules/media/public-url';
import { createSupabaseReviewStore } from '../modules/reviews/store';
import type { SupabaseClients } from '../supabase/clients';
import { FakeAttachments } from './attachment-fakes';

const BASE = 'https://media.example.com';

function keyFor(folder: 'avatars' | 'review-images'): string {
  return `${folder}/${randomUUID()}/${randomUUID()}`;
}

/** A Supabase client whose RPCs answer with the given payloads, by function name. */
function clientsAnswering(answers: Record<string, unknown>): SupabaseClients {
  const rpc = (name: string) => Promise.resolve({ data: answers[name], error: null });
  return { public: () => ({ rpc }), asUser: () => ({ rpc }) } as unknown as SupabaseClients;
}

const summary = {
  averageRating: 5,
  reviewCount: 1,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
};
const page = { page: 1, pageSize: 10, total: 1, totalPages: 1 };

function publicReview(images?: { id: string; key: string }[]) {
  return {
    id: randomUUID(),
    rating: 5,
    title: null,
    body: 'A thoroughly good product.',
    authorName: 'Ana R.',
    verified: true,
    createdAt: '2026-10-30T10:00:00.000Z',
    ...(images === undefined ? {} : { images }),
  };
}

describe('ownedPicture', () => {
  it('resolves only keys the API itself generates', () => {
    const avatar = keyFor('avatars');
    expect(ownedPicture(avatar, BASE)).toEqual({
      url: `${BASE}/${avatar}/full.webp`,
      thumbUrl: `${BASE}/${avatar}/thumb.webp`,
    });
    for (const bad of [
      'products/abc/def',
      'avatars/not-a-uuid/also-not',
      `avatars/${randomUUID()}/${randomUUID()}/../../secrets`,
      `https://evil.example/${keyFor('avatars')}`,
      null,
    ]) {
      expect(ownedPicture(bad, BASE)).toBeNull();
    }
  });

  it('has nothing to show without a media address', () => {
    expect(ownedPicture(keyFor('avatars'), undefined)).toBeNull();
  });
});

describe('review photos in the review store', () => {
  it('turns stored keys into public URLs on approved reviews', async () => {
    const key = keyFor('review-images');
    const id = randomUUID();
    const store = createSupabaseReviewStore(
      clientsAnswering({
        catalog_product_reviews: { summary, reviews: [publicReview([{ id, key }])], ...page },
      }),
      { mediaBaseUrl: BASE },
    );

    const result = await store.publicForProduct('lamp', { limit: 10, offset: 0 });

    expect(result.reviews[0]?.images).toEqual([
      { id, url: `${BASE}/${key}/full.webp`, thumbUrl: `${BASE}/${key}/thumb.webp` },
    ]);
  });

  it('keeps working before the migration, when the database sends no images at all', async () => {
    const store = createSupabaseReviewStore(
      clientsAnswering({
        catalog_product_reviews: { summary, reviews: [publicReview()], ...page },
        my_product_review: {
          eligible: true,
          review: {
            id: randomUUID(),
            rating: 4,
            title: null,
            body: 'Good enough overall.',
            status: 'pending',
            moderationNote: null,
            createdAt: '2026-10-30T10:00:00.000Z',
            updatedAt: '2026-10-30T10:00:00.000Z',
          },
        },
      }),
      { mediaBaseUrl: BASE },
    );

    expect(
      (await store.publicForProduct('lamp', { limit: 10, offset: 0 })).reviews[0]?.images,
    ).toEqual([]);
    expect((await store.myReview('token', randomUUID(), randomUUID())).review?.images).toEqual([]);
  });

  it('drops a photo whose key is not one the API generated', async () => {
    const store = createSupabaseReviewStore(
      clientsAnswering({
        catalog_product_reviews: {
          summary,
          reviews: [publicReview([{ id: randomUUID(), key: 'products/x/y' }])],
          ...page,
        },
      }),
      { mediaBaseUrl: BASE },
    );

    const result = await store.publicForProduct('lamp', { limit: 10, offset: 0 });

    expect(result.reviews[0]?.images).toEqual([]);
  });

  it('shows the customer their own photos, with the review status the moderation uses', async () => {
    const key = keyFor('review-images');
    const id = randomUUID();
    const store = createSupabaseReviewStore(
      clientsAnswering({
        my_product_review: {
          eligible: true,
          review: {
            id: randomUUID(),
            rating: 4,
            title: null,
            body: 'Good enough overall.',
            status: 'pending',
            moderationNote: null,
            images: [{ id, key }],
            createdAt: '2026-10-30T10:00:00.000Z',
            updatedAt: '2026-10-30T10:00:00.000Z',
          },
        },
      }),
      { mediaBaseUrl: BASE },
    );

    const mine = await store.myReview('token', randomUUID(), randomUUID());

    expect(mine.review?.status).toBe('pending');
    expect(mine.review?.images.map((image) => image.id)).toEqual([id]);
  });

  it('gives moderators the photos of each review in the queue, and none if they cannot be read', async () => {
    const reviewId = randomUUID();
    const queue = {
      reviews: [
        {
          ...publicReview(),
          id: reviewId,
          productId: randomUUID(),
          productName: 'Lamp',
          productSlug: 'lamp',
          authorId: randomUUID(),
          authorName: 'Ana',
          authorEmail: null,
          status: 'pending',
          moderatedAt: null,
          moderationNote: null,
        },
      ],
      ...page,
    };
    const attachments = new FakeAttachments();
    const key = keyFor('review-images');
    attachments.images.push({ id: randomUUID(), key, reviewId, userId: randomUUID(), position: 0 });
    const clients = clientsAnswering({ admin_list_product_reviews: queue });

    const withPhotos = await createSupabaseReviewStore(clients, {
      mediaBaseUrl: BASE,
      attachments,
    }).list('token', randomUUID(), { status: 'pending' }, { limit: 25, offset: 0 });
    expect(withPhotos.reviews[0]?.images[0]?.url).toBe(`${BASE}/${key}/full.webp`);

    // Before the migration the photo function is missing: the queue still loads, without photos.
    attachments.failReads = null;
    attachments.adminReviewImages = () => Promise.reject(new Error('function does not exist'));
    const without = await createSupabaseReviewStore(clients, {
      mediaBaseUrl: BASE,
      attachments,
    }).list('token', randomUUID(), { status: 'pending' }, { limit: 25, offset: 0 });
    expect(without.reviews[0]?.images).toEqual([]);
  });
});
