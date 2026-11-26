import { randomUUID } from 'node:crypto';
import { MAX_REVIEW_IMAGES } from '@nilzora/contracts';
import {
  AttachmentRefusalError,
  type AttachmentStore,
  type Caller,
  type StoredImage,
} from '../modules/attachments/store';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface FakeReview {
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
}

interface FakeImage extends StoredImage {
  reviewId: string;
  userId: string;
  position: number;
}

/**
 * The avatars-and-review-images database functions, in memory, with the same rules: only the
 * caller's own profile or review, pending reviews only, a photo limit, and keys that must sit
 * under the caller's (or the review's) own folder. It never trusts the route above it, so a
 * route that forgot a check would fail the tests.
 */
/** A rejected promise that always carries an Error, whatever was thrown. */
function rejection(error: unknown): Promise<never> {
  return Promise.reject(error instanceof Error ? error : new Error(String(error)));
}

export class FakeAttachments implements AttachmentStore {
  readonly avatars = new Map<string, string>();
  readonly reviews = new Map<string, FakeReview>();
  readonly images: FakeImage[] = [];
  readonly calls: string[] = [];
  /** When set, the next write fails like a database outage (nothing is saved). */
  failWrites: Error | null = null;
  /** When set, avatarKey fails (as it does while the migration is not applied). */
  failReads: Error | null = null;

  addReview(userId: string, status: FakeReview['status'] = 'pending'): string {
    const id = randomUUID();
    this.reviews.set(id, { userId, status });
    return id;
  }

  private write(call: string): void {
    this.calls.push(call);
    if (this.failWrites) throw this.failWrites;
  }

  avatarKey(caller: Caller): Promise<string | null> {
    this.calls.push('avatarKey');
    if (this.failReads) return Promise.reject(this.failReads);
    return Promise.resolve(this.avatars.get(caller.userId) ?? null);
  }

  setAvatar(caller: Caller, key: string): Promise<string | null> {
    try {
      this.write('setAvatar');
      if (!new RegExp(`^avatars/${caller.userId}/${UUID}$`).test(key)) {
        throw new AttachmentRefusalError('invalid_key');
      }
      const previous = this.avatars.get(caller.userId) ?? null;
      this.avatars.set(caller.userId, key);
      return Promise.resolve(previous);
    } catch (error) {
      return rejection(error);
    }
  }

  clearAvatar(caller: Caller): Promise<string | null> {
    try {
      this.write('clearAvatar');
      const previous = this.avatars.get(caller.userId) ?? null;
      this.avatars.delete(caller.userId);
      return Promise.resolve(previous);
    } catch (error) {
      return rejection(error);
    }
  }

  private imagesOf(reviewId: string): StoredImage[] {
    return this.images
      .filter((image) => image.reviewId === reviewId)
      .sort((a, b) => a.position - b.position)
      .map(({ id, key }) => ({ id, key }));
  }

  addReviewImage(
    caller: Caller,
    reviewId: string,
    image: { key: string; width: number; height: number },
  ): Promise<{ id: string; images: StoredImage[] }> {
    try {
      this.write('addReviewImage');
      const review = this.reviews.get(reviewId);
      // Someone else's review looks exactly like a missing one.
      if (!review || review.userId !== caller.userId) throw new AttachmentRefusalError('not_found');
      if (review.status !== 'pending') throw new AttachmentRefusalError('review_locked');
      if (!new RegExp(`^review-images/${reviewId}/${UUID}$`).test(image.key)) {
        throw new AttachmentRefusalError('invalid_key');
      }
      const existing = this.images.filter((candidate) => candidate.reviewId === reviewId);
      if (existing.length >= MAX_REVIEW_IMAGES)
        throw new AttachmentRefusalError('review_image_limit');
      const id = randomUUID();
      this.images.push({
        id,
        key: image.key,
        reviewId,
        userId: caller.userId,
        position: existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.position)) + 1,
      });
      return Promise.resolve({ id, images: this.imagesOf(reviewId) });
    } catch (error) {
      return rejection(error);
    }
  }

  removeReviewImage(
    caller: Caller,
    imageId: string,
  ): Promise<{ key: string; images: StoredImage[] }> {
    try {
      this.write('removeReviewImage');
      const index = this.images.findIndex(
        (image) => image.id === imageId && image.userId === caller.userId,
      );
      const found = this.images[index];
      if (index < 0 || !found) throw new AttachmentRefusalError('not_found');
      this.images.splice(index, 1);
      return Promise.resolve({ key: found.key, images: this.imagesOf(found.reviewId) });
    } catch (error) {
      return rejection(error);
    }
  }

  adminReviewImages(
    _caller: Caller,
    reviewIds: readonly string[],
  ): Promise<{ reviewId: string; id: string; key: string }[]> {
    return Promise.resolve(
      this.images
        .filter((image) => reviewIds.includes(image.reviewId))
        .map(({ reviewId, id, key }) => ({ reviewId, id, key })),
    );
  }
}
