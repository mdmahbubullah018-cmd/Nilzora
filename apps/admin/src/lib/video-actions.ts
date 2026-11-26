'use server';

import {
  MAX_PRODUCT_VIDEOS,
  PRODUCT_VIDEO_MAX_BYTES,
  productVideoUploadQuerySchema,
  reorderProductVideosRequestSchema,
  sniffVideoType,
  type ApiErrorCode,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';

/*
 * Product video Server Actions. adminAct() refuses a form without this app's Origin and
 * CSRF token before any API call. A video is checked here by size and by its first bytes
 * (the browser's file type is never trusted); the API checks the bytes again and the
 * database checks the permission and the product's state. Only fixed messages return.
 */

const MISSING_PRODUCT: ActionState = {
  status: 'error',
  message: 'This product could not be identified. Reload the page and try again.',
};
const TITLE_TOO_LONG = 'Keep the title under 160 characters.';
const STALE = 'The videos changed since this page loaded. Reload the page and try again.';

const VIDEO_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'Your account does not have permission to change product videos.',
  not_found: 'This video or product no longer exists. Reload the page to see the current videos.',
  product_content_locked:
    'This product is on sale, so its videos cannot change. Unpublish it first, then edit and resubmit it.',
  product_under_review:
    'The product is under review, so its videos cannot change. Withdraw the review first.',
  video_limit_reached: `A product keeps at most ${String(MAX_PRODUCT_VIDEOS)} videos. Remove one to add another.`,
  video_invalid: 'This file is not an MP4 or WebM video. Choose another file.',
  media_unavailable:
    'Uploads are not set up on this server yet. The store owner needs to add the Cloudflare R2 settings to the API and restart it.',
  unsupported_media_type: 'Upload an MP4 or WebM video.',
  payload_too_large: 'This video is larger than 40 MB. Choose a shorter or smaller one.',
  rate_limited: 'Too many changes in a short time. Wait a minute, then try again.',
};

function productPath(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

function idFrom(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function refresh(productId: string): void {
  revalidatePath(productPath(productId));
}

type VideoFile =
  | { ok: true; bytes: Uint8Array; contentType: 'video/mp4' | 'video/webm' }
  | { ok: false; message: string };

async function checkVideoFile(value: FormDataEntryValue | null): Promise<VideoFile> {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: false, message: 'Choose a video to upload.' };
  }
  if (value.size > PRODUCT_VIDEO_MAX_BYTES) {
    return {
      ok: false,
      message: 'This video is larger than 40 MB. Choose a shorter or smaller one.',
    };
  }
  const bytes = new Uint8Array(await value.arrayBuffer());
  const contentType = sniffVideoType(bytes);
  if (contentType === null) {
    return { ok: false, message: 'Upload an MP4 or WebM video.' };
  }
  return { ok: true, bytes, contentType };
}

/** Adds one video to a product (last position). Answers with a state: it runs from the upload route. */
export async function uploadProductVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return MISSING_PRODUCT;

  const title = formText(formData, 'title').trim();
  const parsedTitle = productVideoUploadQuerySchema.safeParse({
    title: title === '' ? undefined : title,
  });
  if (!parsedTitle.success) return invalid(TITLE_TOO_LONG, { title: TITLE_TOO_LONG }, { title });

  const file = await checkVideoFile(formData.get('video'));
  if (!file.ok) return invalid(file.message, { video: file.message }, { title });

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadProductVideo(token, productId, {
        bytes: file.bytes,
        contentType: file.contentType,
        ...(parsedTitle.data.title ? { title: parsedTitle.data.title } : {}),
      }),
    {
      returnTo: productPath(productId),
      label: 'product video upload',
      messages: {
        ...VIDEO_MESSAGES,
        service_unavailable:
          'Nilzora could not confirm the upload. Reload the page and check the videos before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { title } };

  refresh(productId);
  return {
    status: 'success',
    message:
      formData.get(RESPOND_AS_STATE) === '1'
        ? 'Video added to the product.'
        : 'Video added to the product. The product goes back for review before it is published.',
  };
}

/** Moves one video a place earlier or later. The form carries the order it was rendered with. */
export async function moveProductVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  const videoId = idFrom(formData, 'videoId');
  if (productId === undefined || videoId === undefined) return MISSING_PRODUCT;

  const order = formText(formData, 'order').split(',');
  const index = order.indexOf(videoId);
  const target = formText(formData, 'direction') === 'earlier' ? index - 1 : index + 1;
  if (new Set(order).size !== order.length || index < 0 || target < 0 || target >= order.length) {
    return { status: 'error', message: STALE };
  }
  const moved = [...order];
  [moved[index], moved[target]] = [moved[target] as string, moved[index] as string];
  const parsed = reorderProductVideosRequestSchema.safeParse({ videoIds: moved });
  if (!parsed.success) return { status: 'error', message: STALE };

  const result = await adminAct(
    formData,
    (api, token) => api.adminReorderProductVideos(token, productId, parsed.data),
    {
      returnTo: productPath(productId),
      label: 'product video order',
      messages: { ...VIDEO_MESSAGES, bad_request: STALE },
    },
  );
  if (!result.ok) return result.state;
  refresh(productId);
  return { status: 'success', message: 'Video order saved.' };
}

/** Removes one video; its file is deleted from storage after the database change commits. */
export async function deleteProductVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  const videoId = idFrom(formData, 'videoId');
  if (productId === undefined || videoId === undefined) return MISSING_PRODUCT;

  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteProductVideo(token, videoId),
    { returnTo: productPath(productId), label: 'product video removal', messages: VIDEO_MESSAGES },
  );
  if (!result.ok) return result.state;
  refresh(productId);
  return { status: 'success', message: 'Video removed.' };
}
