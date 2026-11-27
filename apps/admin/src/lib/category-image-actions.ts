'use server';

import type { ApiErrorCode } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';

/*
 * A category's cover picture. Same shape as the brand and banner pictures: the form is checked
 * for the person's benefit (size, and the file's first bytes rather than its name), then the API
 * decodes the picture, authorises the change (products.read and products.publish) and stores it
 * under a key it builds from the category id. Only the fixed messages below reach the browser.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'Your account does not have permission to change category pictures.',
  not_found: 'This category no longer exists. Reload the page to see the current list.',
  media_unavailable: 'Image uploads are not configured yet (media storage is off).',
  image_invalid: 'This picture was refused: use a JPEG, PNG or WebP of at least 400 px.',
  payload_too_large: 'The picture is too large: keep it under 5 MB.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
};

function categoryId(formData: FormData): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, 'categoryId'));
  return parsed.success ? parsed.data : undefined;
}

function categoryPath(id: string): Route {
  return `/admin/categories/${id}` as Route;
}

function refresh(id: string): void {
  revalidatePath('/admin/categories');
  revalidatePath(`/admin/categories/${id}`);
}

/** Sets or replaces the category's cover picture. */
export async function uploadCategoryImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = categoryId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadCategoryImage(token, id, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: categoryPath(id), label: 'category picture upload', messages: MESSAGES },
  );
  if (!result.ok) return result.state;
  refresh(id);
  return { status: 'success', message: 'Picture updated.' };
}

/** Removes the category's cover picture. */
export async function removeCategoryImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = categoryId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminRemoveCategoryImage(token, id), {
    returnTo: categoryPath(id),
    label: 'category picture removal',
    messages: MESSAGES,
  });
  if (!result.ok) return result.state;
  refresh(id);
  return { status: 'success', message: 'Picture removed.' };
}

/**
 * A category's page banner: wide artwork at the top of the category's screen in the app. The same
 * checks, key derivation and permission as the cover picture; it never touches the cover.
 */
export async function uploadCategoryBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = categoryId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadCategoryBanner(token, id, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: categoryPath(id), label: 'category banner upload', messages: MESSAGES },
  );
  if (!result.ok) return result.state;
  refresh(id);
  return { status: 'success', message: 'Banner updated.' };
}

/** Removes the category's page banner. */
export async function removeCategoryBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = categoryId(formData);
  if (id === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveCategoryBanner(token, id),
    {
      returnTo: categoryPath(id),
      label: 'category banner removal',
      messages: MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refresh(id);
  return { status: 'success', message: 'Banner removed.' };
}
