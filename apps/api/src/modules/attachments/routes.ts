import {
  AVATAR_MIN_SIZE,
  MAX_REVIEW_IMAGES,
  REVIEW_IMAGE_MIN_SIZE,
  type AvatarResponse,
  type ReviewImage,
  type ReviewImageListResponse,
  type ReviewImageUploadResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import type { MediaStorage } from '../media/routes';
import { ownedPicture } from '../media/public-url';
import {
  createPictureUploads,
  imageContentType,
  readAvatarBody,
  readImageBody,
  requireStorage,
} from '../media/upload';
import { AttachmentRefusalError, type AttachmentStore, type StoredImage } from './store';

/*
 * Avatars and review photos
 * -------------------------
 * Four customer-facing routes, each with its own explicit rule. Every one needs a signed-in
 * account, and none accepts an id for "whose" picture it is: the avatar is always the caller's
 * own, and a review photo can only be added to or removed from a review the database finds
 * under the caller's id.
 *
 *   POST   /me/avatar                       own account            (any signed-in account, staff too)
 *   DELETE /me/avatar                       own account
 *   POST   /me/reviews/:reviewId/images     own review, pending, below the photo limit
 *   DELETE /me/review-images/:imageId       own photo
 *
 * The picture is decoded and re-encoded here from its real bytes; the key it is stored under is
 * generated here and checked again by the database. The old object of a replaced or removed
 * picture is deleted only after the database change succeeded, and a picture whose record could
 * not be saved is deleted again, so a failure never leaves the account pointing at nothing or
 * leaves a stray object behind where it can be avoided.
 */

/** Largest side kept for an avatar: it is only ever shown small. */
const AVATAR_FULL_MAX = 512;

export interface AttachmentRouteDependencies extends AuthDependencies {
  store: AttachmentStore;
  /** Undefined when R2 is not configured: the routes then answer 503 media_unavailable. */
  storage: MediaStorage | undefined;
  /** Per-IP limit for picture changes (a separate bucket from the admin's). */
  limiter: RequestHandler;
  logger: Logger;
}

const reviewParams = { params: z.object({ reviewId: uuidSchema }) };
const imageParams = { params: z.object({ imageId: uuidSchema }) };

const ANSWERS: Readonly<
  Record<AttachmentRefusalError['refusal'], readonly [number, string, string]>
> = {
  not_found: [404, 'not_found', 'Review or photo not found'],
  account_blocked: [403, 'forbidden', 'This account cannot change its pictures'],
  review_locked: [
    409,
    'review_photos_locked',
    'Photos can only be added soon after a review is posted',
  ],
  review_image_limit: [
    409,
    'review_photo_limit',
    `A review keeps at most ${String(MAX_REVIEW_IMAGES)} photos`,
  ],
  invalid_key: [400, 'bad_request', 'The picture could not be attached'],
};

/** Answers a database refusal with fixed wording; anything else goes to the error handler. */
function refuse(res: Response, error: unknown): void {
  if (!(error instanceof AttachmentRefusalError)) throw error;
  const [status, code, message] = ANSWERS[error.refusal];
  sendError(res, status, code as Parameters<typeof sendError>[2], message);
}

export function attachmentsRouter(deps: AttachmentRouteDependencies): Router {
  const router = Router();
  const { store, storage, limiter, logger } = deps;
  const requireUser = authenticate(deps);
  const needStorage = requireStorage(storage);
  const { storePicture, storePictureWithSize, removePicture } = createPictureUploads(
    storage,
    logger,
  );
  const base = storage?.publicBaseUrl;

  function toImages(rows: readonly StoredImage[]): ReviewImage[] {
    return rows.flatMap((row) => {
      const picture = ownedPicture(row.key, base);
      return picture === null ? [] : [{ id: row.id, ...picture }];
    });
  }

  // ------------------------------------------------------------------ avatar

  router.post(
    '/me/avatar',
    noStore,
    limiter,
    requireUser,
    imageContentType,
    needStorage,
    readAvatarBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const caller = { accessToken: identity.accessToken, userId: identity.userId };
      // The folder is the caller's own id, taken from the verified token.
      const key = await storePicture(req.body as unknown, res, `avatars/${identity.userId}`, {
        minSize: AVATAR_MIN_SIZE,
        fullMax: AVATAR_FULL_MAX,
      });
      if (key === null) return;
      let previous: string | null;
      try {
        previous = await store.setAvatar(caller, key);
      } catch (error) {
        await removePicture(key, res);
        refuse(res, error);
        return;
      }
      // The new picture is saved; only now is the old one's storage released.
      if (previous !== null && previous !== key) await removePicture(previous, res);
      const body: AvatarResponse = { avatar: ownedPicture(key, base) };
      res.status(201).json(body);
    },
  );

  router.delete('/me/avatar', noStore, limiter, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const previous = await store.clearAvatar({
        accessToken: identity.accessToken,
        userId: identity.userId,
      });
      await removePicture(previous, res);
    } catch (error) {
      refuse(res, error);
      return;
    }
    const body: AvatarResponse = { avatar: null };
    res.json(body);
  });

  // ------------------------------------------------------------ review photos

  router.post(
    '/me/reviews/:reviewId/images',
    noStore,
    limiter,
    requireUser,
    validate(reviewParams),
    imageContentType,
    needStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof reviewParams>(res);
      const stored = await storePictureWithSize(
        req.body as unknown,
        res,
        `review-images/${params.reviewId}`,
        { minSize: REVIEW_IMAGE_MIN_SIZE },
      );
      if (stored === null) return;
      try {
        const saved = await store.addReviewImage(
          { accessToken: identity.accessToken, userId: identity.userId },
          params.reviewId,
          stored,
        );
        const images = toImages(saved.images);
        const image = images.find((candidate) => candidate.id === saved.id);
        if (image === undefined) {
          // Saved, but there is no public address to show it at (media base not configured).
          sendError(res, 503, 'media_unavailable', 'Image uploads are not available right now');
          return;
        }
        const body: ReviewImageUploadResponse = { image, images };
        res.status(201).json(body);
      } catch (error) {
        // Not attached to the review (someone else's, locked, full): the object goes too.
        await removePicture(stored.key, res);
        refuse(res, error);
      }
    },
  );

  router.delete(
    '/me/review-images/:imageId',
    noStore,
    limiter,
    requireUser,
    validate(imageParams),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof imageParams>(res);
      try {
        const removed = await store.removeReviewImage(
          { accessToken: identity.accessToken, userId: identity.userId },
          params.imageId,
        );
        await removePicture(removed.key, res);
        const body: ReviewImageListResponse = { images: toImages(removed.images) };
        res.json(body);
      } catch (error) {
        refuse(res, error);
      }
    },
  );

  return router;
}
