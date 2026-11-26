'use server';

import type { ApiErrorCode } from '@nilzora/contracts';
import { revalidatePath } from 'next/cache';
import { adminAct, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';

/*
 * The signed-in account's own profile picture. There is no id in these forms and none is read:
 * the API changes the picture of the account the session belongs to, so a staff member cannot
 * point it at anyone else. The form is checked for the person's benefit (size and the file's
 * first bytes); the API decodes the picture and decides again.
 */

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'This account cannot change its picture right now.',
  media_unavailable: 'Image uploads are not configured yet (media storage is off).',
  image_invalid: 'This picture was refused: use a JPEG, PNG or WebP of at least 128 px.',
  payload_too_large: 'The picture is too large: keep it under 5 MB.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
  service_unavailable:
    'Nilzora could not confirm the change. Reload the page to see your current picture before trying again.',
};

const PROFILE_PATH = '/admin/profile';

function refresh(): void {
  // The picture is in the top bar of every page.
  revalidatePath('/admin', 'layout');
}

export async function uploadAvatarAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) => api.uploadMyAvatar(token, { bytes: file.bytes, contentType: file.contentType }),
    { returnTo: PROFILE_PATH, label: 'profile picture upload', messages: MESSAGES },
  );
  if (!result.ok) return result.state;
  refresh();
  return { status: 'success', message: 'Profile picture updated.' };
}

export async function removeAvatarAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await adminAct(formData, (api, token) => api.removeMyAvatar(token), {
    returnTo: PROFILE_PATH,
    label: 'profile picture removal',
    messages: MESSAGES,
  });
  if (!result.ok) return result.state;
  refresh();
  return { status: 'success', message: 'Profile picture removed.' };
}
