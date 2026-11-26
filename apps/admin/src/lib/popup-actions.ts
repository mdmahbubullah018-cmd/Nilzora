'use server';

import {
  savePopupSchema,
  POPUP_ARTWORK_CONTENT_TYPES,
  POPUP_ARTWORK_MAX_BYTES,
  type ApiErrorCode,
  type PopupAudience,
  type PopupFrequency,
  type PopupPlatform,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';

/*
 * Promotional popup changes. Each action checks the form for the person's benefit, then the API
 * decides: it authorises the change, checks everything again and stores the artwork itself.
 *
 * Popup artwork is not a product picture: it accepts an animated GIF and keeps it byte for byte,
 * so the upload is checked here only for the obvious refusals (type, size) and the API decides
 * the rest from the bytes.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const POPUP_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  popup_not_found: 'That popup has been deleted. Reload the page.',
  popup_invalid: 'The popup was refused: check the copy, the artwork and the timing.',
  popup_conflict: 'That popup could not be switched on right now. Reload and try again.',
  media_unavailable: 'Artwork uploads are not configured yet (media storage is off).',
  unsupported_media_type: 'Upload a JPEG, PNG, WebP or animated GIF picture.',
  payload_too_large: 'The picture is too large: keep it under 5 MB.',
  image_invalid: 'This picture was refused: use at least 320 px on its shorter side.',
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

/** "2026-11-01T09:00" from a datetime-local field, read as Bangladesh time (UTC+6). */
function bdTime(text: string): string | null | undefined {
  if (text.trim() === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text.trim());
  return match ? new Date(`${match[1]}T${match[2]}:00+06:00`).toISOString() : undefined;
}

export async function savePopupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A create posts an empty id; an edit posts one. Anything else is a page that has gone stale.
  const editing = formText(formData, 'popupId') !== '';
  const popupId = idOf(formData, 'popupId');
  if (editing && popupId === undefined) return PAGE_EXPIRED;

  const values = {
    internalName: formText(formData, 'internalName'),
    displayMode: formText(formData, 'displayMode'),
    title: formText(formData, 'title'),
    subtitle: formText(formData, 'subtitle'),
    description: formText(formData, 'description'),
    buttonLabel: formText(formData, 'buttonLabel'),
    buttonHref: formText(formData, 'buttonHref'),
    imageAlt: formText(formData, 'imageAlt'),
    delaySeconds: formText(formData, 'delaySeconds'),
    frequency: formText(formData, 'frequency'),
    platform: formText(formData, 'platform') || 'both',
    audience: formText(formData, 'audience') || 'all',
    priority: formText(formData, 'priority') || '0',
    startsAt: formText(formData, 'startsAt'),
    endsAt: formText(formData, 'endsAt'),
  };
  const errors: Record<string, string> = {};
  const startsAt = bdTime(values.startsAt);
  const endsAt = bdTime(values.endsAt);
  if (startsAt === undefined) errors.startsAt = 'Enter a valid date and time.';
  if (endsAt === undefined) errors.endsAt = 'Enter a valid date and time.';

  const parsed = savePopupSchema.safeParse({
    internalName: values.internalName,
    displayMode: values.displayMode,
    title: values.title,
    subtitle: values.subtitle,
    description: values.description,
    buttonLabel: values.buttonLabel,
    // An empty field means no link (an image-only popup): null, never an empty string.
    buttonHref: values.buttonHref.trim() === '' ? null : values.buttonHref.trim(),
    imageAlt: values.imageAlt,
    delaySeconds: Number(values.delaySeconds),
    frequency: values.frequency as PopupFrequency,
    platform: values.platform as PopupPlatform,
    audience: values.audience as PopupAudience,
    priority: Number(values.priority),
    isActive: formData.get('isActive') === 'on',
    startsAt: startsAt ?? null,
    endsAt: endsAt ?? null,
  });
  if (!parsed.success || Object.keys(errors).length > 0) {
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      errors[field] ??= issue.message;
    }
    return invalid('Check the highlighted fields.', errors, values);
  }

  const result = await adminAct(
    formData,
    (api, token) => api.savePopup(token, popupId ?? null, parsed.data),
    { returnTo: '/admin/popups', label: 'popup save', messages: POPUP_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  revalidatePath('/admin/popups');
  return {
    status: 'success',
    message: editing ? 'Saved.' : 'Popup created. Add its artwork below.',
  };
}

/**
 * Uploads or replaces the artwork. The API sniffs the real format from the bytes, so a file
 * renamed to `.gif` is refused there rather than trusted here; only the size and the declared
 * type are worth refusing before the upload is spent.
 */
export async function uploadPopupArtworkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const popupId = idOf(formData, 'popupId');
  if (popupId === undefined) return PAGE_EXPIRED;
  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return invalid('Choose a picture to upload.', { image: 'Choose a picture to upload.' });
  }
  const contentType = file.type.toLowerCase();
  if (!(POPUP_ARTWORK_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    const message = 'Use a JPEG, PNG, WebP or animated GIF picture.';
    return invalid(message, { image: message });
  }
  if (file.size > POPUP_ARTWORK_MAX_BYTES) {
    const message = 'The picture is too large: keep it under 5 MB.';
    return invalid(message, { image: message });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await adminAct(
    formData,
    (api, token) =>
      api.uploadPopupArtwork(token, popupId, {
        bytes,
        contentType: contentType as (typeof POPUP_ARTWORK_CONTENT_TYPES)[number],
      }),
    { returnTo: '/admin/popups', label: 'popup artwork upload', messages: POPUP_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/popups');
  return { status: 'success', message: 'Artwork updated.' };
}

export async function removePopupArtworkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const popupId = idOf(formData, 'popupId');
  if (popupId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.removePopupArtwork(token, popupId), {
    returnTo: '/admin/popups',
    label: 'popup artwork removal',
    // The API refuses to take the picture away from a popup that is on screen.
    messages: {
      ...POPUP_MESSAGES,
      popup_invalid: 'Switch the popup off before removing its artwork.',
    },
  });
  if (!result.ok) return result.state;
  revalidatePath('/admin/popups');
  return {
    status: 'success',
    message: 'Artwork removed. The popup cannot be shown until new artwork is uploaded.',
  };
}

export async function setPopupActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const popupId = idOf(formData, 'popupId');
  if (popupId === undefined) return PAGE_EXPIRED;
  const active = formText(formData, 'active') === 'true';
  const result = await adminAct(
    formData,
    (api, token) => api.setPopupActive(token, popupId, active),
    { returnTo: '/admin/popups', label: 'popup activation', messages: POPUP_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/popups');
  return { status: 'success', message: active ? 'Popup is live.' : 'Popup switched off.' };
}

export async function deletePopupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const popupId = idOf(formData, 'popupId');
  if (popupId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.deletePopup(token, popupId), {
    returnTo: '/admin/popups',
    label: 'popup delete',
    messages: POPUP_MESSAGES,
  });
  if (!result.ok) return result.state;
  revalidatePath('/admin/popups');
  return { status: 'success', message: 'Popup deleted.' };
}

/**
 * Copies a popup's settings and words into a new, switched-off popup named "Copy of …". The
 * artwork is not copied (two popups must never share one stored file, because deleting one would
 * delete the other's picture): the copy opens ready for its own upload.
 */
export async function duplicatePopupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const popupId = idOf(formData, 'popupId');
  if (popupId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    async (api, token) => {
      const { popup } = await api.adminPopup(token, popupId);
      const name = `Copy of ${popup.internalName}`.slice(0, 80);
      return api.savePopup(token, null, {
        internalName: name,
        displayMode: popup.displayMode,
        title: popup.title,
        subtitle: popup.subtitle,
        description: popup.description,
        buttonLabel: popup.buttonLabel,
        buttonHref: popup.buttonHref,
        imageAlt: popup.imageAlt,
        delaySeconds: popup.delaySeconds,
        frequency: popup.frequency,
        platform: popup.platform,
        audience: popup.audience,
        priority: popup.priority,
        isActive: false,
        startsAt: popup.startsAt,
        endsAt: popup.endsAt,
      });
    },
    { returnTo: '/admin/popups', label: 'popup duplicate', messages: POPUP_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/popups');
  return { status: 'success', message: 'Duplicated as a switched-off copy. Add its artwork.' };
}
