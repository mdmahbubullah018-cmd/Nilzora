'use server';

import { AVATAR_MAX_BYTES, checkImageFile, slugSchema } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { ApiError, FORM_EXPIRED, type ApiClient, type FormState } from '@nilzora/web-session';
import { revalidatePath } from 'next/cache';
import { session } from '@/lib/session';

/*
 * Pictures a customer adds: their own profile picture and the photos of their own review.
 * The form is checked for the person's benefit (size, and the file's first bytes rather than
 * its name); the API decodes the picture, checks that the account owns the review, that the
 * review was posted a moment ago and that it has room, and the database checks again.
 * Nothing here names an account: the API uses the session's. Only the fixed messages below
 * reach the browser, never the API's own text.
 */

const SESSION_ENDED = 'Your session has ended. Sign in again, then try again.';
const UNAVAILABLE =
  'Nilzora could not confirm the change. Reload the page to see what was saved before trying again.';
const GENERIC = 'The picture could not be saved. Please try again.';

const MESSAGES: Record<string, string> = {
  forbidden: 'This account cannot change its pictures right now.',
  not_found: 'This review or photo could not be found. Reload the page and try again.',
  media_unavailable: 'Picture uploads are not available right now. Please try again later.',
  image_invalid: 'This picture could not be used. Choose another JPEG, PNG or WebP.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
  payload_too_large: 'This picture is larger than 5 MB. Choose a smaller one.',
  review_photos_locked: 'Photos can only be added soon after a review is posted.',
  review_photo_limit: 'A review keeps at most 4 photos. Remove one to add another.',
  rate_limited: 'Too many changes in a short time. Wait a minute, then try again.',
};

type Run<T> = { ok: true; value: T } | { ok: false; state: FormState };

async function run<T>(
  formData: FormData,
  call: (api: ApiClient, accessToken: string) => Promise<T>,
): Promise<Run<T>> {
  try {
    const outcome = await session.act(formData, call);
    if (outcome.kind === 'untrusted') {
      return { ok: false, state: { status: 'error', message: FORM_EXPIRED.message ?? GENERIC } };
    }
    if (outcome.kind === 'signed_out') {
      return { ok: false, state: { status: 'signed_out', message: SESSION_ENDED } };
    }
    if (outcome.kind === 'unavailable') {
      return { ok: false, state: { status: 'error', message: UNAVAILABLE } };
    }
    return { ok: true, value: outcome.value };
  } catch (error) {
    if (error instanceof ApiError) {
      const message = MESSAGES[error.code];
      if (message !== undefined) return { ok: false, state: { status: 'error', message } };
      if (error.status >= 400 && error.status < 500) {
        return { ok: false, state: { status: 'error', message: GENERIC } };
      }
    }
    return { ok: false, state: { status: 'error', message: UNAVAILABLE } };
  }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Sets or replaces the signed-in customer's own profile picture. */
export async function uploadAvatarAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // A profile picture has its own 3 MB ceiling; review photos keep the shared 5 MB.
  const file = await checkImageFile(formData.get('image'), AVATAR_MAX_BYTES);
  if (!file.ok) {
    return { status: 'error', message: file.message, fieldErrors: { image: file.message } };
  }
  const result = await run(formData, (api, token) =>
    api.uploadMyAvatar(token, { bytes: file.bytes, contentType: file.contentType }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/account');
  return { status: 'success', message: 'Profile picture updated.' };
}

/** Removes the signed-in customer's own profile picture. */
export async function removeAvatarAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await run(formData, (api, token) => api.removeMyAvatar(token));
  if (!result.ok) return result.state;
  revalidatePath('/account');
  return { status: 'success', message: 'Profile picture removed.' };
}

/** Attaches one photo to the signed-in customer's own, still pending review. */
export async function uploadReviewPhotoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reviewId = uuidSchema.safeParse(field(formData, 'reviewId'));
  const slug = slugSchema.safeParse(field(formData, 'slug'));
  if (!reviewId.success || !slug.success) {
    return { status: 'error', message: FORM_EXPIRED.message ?? GENERIC };
  }
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) {
    return { status: 'error', message: file.message, fieldErrors: { image: file.message } };
  }
  const result = await run(formData, (api, token) =>
    api.uploadReviewImage(token, reviewId.data, {
      bytes: file.bytes,
      contentType: file.contentType,
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath(`/products/${slug.data}`);
  return {
    status: 'success',
    message: 'Photo added.',
    values: { imageId: result.value.image.id, thumbUrl: result.value.image.thumbUrl },
  };
}

/**
 * Refreshes a product page once a review's photos have all been sent. It changes nothing: it only
 * makes the page show the review (and its photos) the customer has just posted.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- a Server Action has to be an async function
export async function refreshReviewsAction(slug: string): Promise<void> {
  const parsed = slugSchema.safeParse(slug);
  if (parsed.success) revalidatePath(`/products/${parsed.data}`);
}

/** Removes one of the signed-in customer's own review photos. */
export async function removeReviewPhotoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const imageId = uuidSchema.safeParse(field(formData, 'imageId'));
  const slug = slugSchema.safeParse(field(formData, 'slug'));
  if (!imageId.success || !slug.success) {
    return { status: 'error', message: FORM_EXPIRED.message ?? GENERIC };
  }
  const result = await run(formData, (api, token) => api.removeReviewImage(token, imageId.data));
  if (!result.ok) return result.state;
  revalidatePath(`/products/${slug.data}`);
  return { status: 'success', message: 'Photo removed.' };
}
