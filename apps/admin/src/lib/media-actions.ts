'use server';

import {
  mediaListQuerySchema,
  mediaUploadQuerySchema,
  updateMediaRequestSchema,
  type ApiErrorCode,
  type MediaAsset,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';

/*
 * Media library Server Actions. adminAct() refuses a form without this app's Origin and
 * CSRF token before any API call; the API then checks settings.manage (uploads, alt text
 * and deletes) and decodes every picture itself. The browser's file name is sent only as
 * a label; the server chooses the storage key. Only the fixed messages below return to
 * the browser.
 */

const MEDIA_PATH = '/admin/media' as Route;

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const ALT_TOO_LONG = 'Keep the description under 250 characters.';

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'Changing the media library needs the “Manage store settings” permission.',
  not_found: 'This picture no longer exists. Reload the page to see the library.',
  in_use:
    'This picture is still used by the store profile, SEO, onboarding or a banner. Replace it there first, then delete it.',
  media_unavailable:
    'Picture storage is not set up on this server yet. The store owner needs to add the Cloudflare R2 settings to the API and restart it.',
  image_invalid: 'This picture was refused: use a JPEG, PNG or WebP of at least 400 px.',
  payload_too_large: 'This image is larger than 5 MB. Choose a smaller one.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
  bad_request: 'Check the description and try again.',
};

/** How many pictures a picker shows at once; the library page itself paginates. */
const PICKER_PAGE_SIZE = 48;

export type MediaSearchResult =
  | { ok: true; assets: MediaAsset[]; total: number }
  /** A fixed message: the API's own text never reaches the browser. */
  | { ok: false; message: string };

/**
 * What the media picker next to an image field shows: the library, newest first, filtered by
 * the same text the library page searches. It is a Server Action so the browser needs no API
 * token, and it is refused like any other form when the Origin or CSRF token is wrong.
 */
export async function searchMediaAction(formData: FormData): Promise<MediaSearchResult> {
  const query = formText(formData, 'q').trim();
  const parsed = mediaListQuerySchema.safeParse({
    ...(query === '' ? {} : { q: query }),
    page: 1,
    pageSize: PICKER_PAGE_SIZE,
  });
  if (!parsed.success) return { ok: false, message: 'That search text is too long.' };

  const result = await adminAct(formData, (api, token) => api.adminListMedia(token, parsed.data), {
    returnTo: MEDIA_PATH,
    label: 'media search',
    messages: MESSAGES,
  });
  if (!result.ok) {
    return { ok: false, message: result.state.message ?? 'The media library could not be read.' };
  }
  return { ok: true, assets: result.value.assets, total: result.value.total };
}

function mediaId(formData: FormData): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, 'mediaId'));
  return parsed.success ? parsed.data : undefined;
}

/** Adds one picture to the library. */
export async function uploadMediaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const alt = formText(formData, 'alt').trim();
  const picked = formData.get('image');
  const query = mediaUploadQuerySchema.safeParse({
    alt: alt === '' ? undefined : alt,
    name: picked instanceof File && picked.name !== '' ? picked.name : undefined,
  });
  if (!query.success) return invalid(ALT_TOO_LONG, { alt: ALT_TOO_LONG }, { alt });

  const file = await checkImageFile(picked);
  if (!file.ok) return invalid(file.message, { image: file.message }, { alt });

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadMedia(token, {
        bytes: file.bytes,
        contentType: file.contentType,
        ...(query.data.alt ? { alt: query.data.alt } : {}),
        ...(query.data.name ? { name: query.data.name } : {}),
      }),
    {
      returnTo: MEDIA_PATH,
      label: 'media upload',
      messages: {
        ...MESSAGES,
        // An upload is not idempotent: a lost answer may hide a stored picture.
        service_unavailable:
          'Nilzora could not confirm the upload. Reload the page and check the library before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { alt } };
  revalidatePath(MEDIA_PATH);
  // The new picture's own addresses, so a picker can select it without another round trip.
  const asset = result.value.asset;
  return {
    status: 'success',
    message: 'Picture added to the library.',
    values: { alt, mediaKey: asset.key, mediaUrl: asset.url, mediaThumbUrl: asset.thumbUrl },
  };
}

/** Sets or clears a library picture's description (an empty one removes it). */
export async function updateMediaAltAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = mediaId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const alt = formText(formData, 'alt').trim();
  const parsed = updateMediaRequestSchema.safeParse({ alt: alt === '' ? null : alt });
  if (!parsed.success) return invalid(ALT_TOO_LONG, { alt: ALT_TOO_LONG }, { alt });

  const result = await adminAct(
    formData,
    (api, token) => api.adminUpdateMedia(token, id, parsed.data),
    { returnTo: MEDIA_PATH, label: 'media description', messages: MESSAGES },
  );
  if (!result.ok) return { ...result.state, values: { alt } };
  revalidatePath(MEDIA_PATH);
  return { status: 'success', message: 'Description saved.' };
}

/** Deletes a library picture; the API refuses (409 in_use) while something still uses it. */
export async function deleteMediaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = mediaId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteMedia(token, id), {
    returnTo: MEDIA_PATH,
    label: 'media delete',
    messages: MESSAGES,
  });
  if (!result.ok) return result.state;
  revalidatePath(MEDIA_PATH);
  return { status: 'success', message: 'Picture deleted.' };
}
