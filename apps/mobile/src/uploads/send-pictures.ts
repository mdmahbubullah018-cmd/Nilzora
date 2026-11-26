import { ApiError } from '@nilzora/api-client';
import {
  API_V1_PREFIX,
  avatarResponseSchema,
  reviewImageUploadResponseSchema,
  type AvatarResponse,
  type ReviewImageUploadResponse,
} from '@nilzora/contracts';
import type { SessionManager } from '@/auth/session-manager';
import { getMobileApiBaseUrl } from '@/auth/api';
import { uploadPictureNative } from './native-upload';
import type { PickedImage } from './pick-images';
import type { UploadControls } from './use-upload';

/*
 * The two pictures the app sends. Each goes to an endpoint that names no account: the API takes
 * the owner from the signed-in session, so the app cannot upload "as" anyone else. A review's id
 * is in the address only to say which of the caller's own reviews the photo belongs to; the API
 * and the database refuse any review that is not theirs.
 */

type Session = Pick<SessionManager, 'authorized'>;

function addressOf(path: string): string {
  const base = getMobileApiBaseUrl();
  if (base === null) {
    throw new ApiError(0, 'media_unavailable', 'This build has no valid API address.');
  }
  return `${base}${API_V1_PREFIX}${path}`;
}

/** Sets the signed-in customer's profile picture. */
export function sendAvatar(
  session: Session,
  image: PickedImage,
  controls: UploadControls,
): Promise<AvatarResponse> {
  const url = addressOf('/me/avatar');
  return session.authorized((accessToken) =>
    uploadPictureNative({
      url,
      accessToken,
      uri: image.uri,
      contentType: image.contentType,
      parse: (body) => {
        const parsed = avatarResponseSchema.safeParse(body);
        return parsed.success ? parsed.data : null;
      },
      ...controls,
    }),
  );
}

/** Attaches a photo to one of the signed-in customer's own pending reviews. */
export function sendReviewPhoto(
  session: Session,
  reviewId: string,
  image: PickedImage,
  controls: UploadControls,
): Promise<ReviewImageUploadResponse> {
  const url = addressOf(`/me/reviews/${encodeURIComponent(reviewId)}/images`);
  return session.authorized((accessToken) =>
    uploadPictureNative({
      url,
      accessToken,
      uri: image.uri,
      contentType: image.contentType,
      parse: (body) => {
        const parsed = reviewImageUploadResponseSchema.safeParse(body);
        return parsed.success ? parsed.data : null;
      },
      ...controls,
    }),
  );
}
