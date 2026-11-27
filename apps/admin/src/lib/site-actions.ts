'use server';

import type { ApiErrorCode, SeoKind } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import {
  checkSeo,
  checkStoreProfile,
  NEWER_STORE_FIELDS,
  seoEditorPath,
  SEO_FIELDS,
  STORE_LIMITS,
} from '@/components/site/site-rules';

/*
 * SEO, the store profile and the staff inbox.
 *
 * The database is the authority for every rule: it checks the permission again, rejects a
 * canonical path that points off-site, and refuses an image key the media service did not
 * produce. These actions only shape the request and refresh the page.
 */

const SEO_PATH = '/admin/seo' as Route;
const PROFILE_PATH = '/admin/store-profile' as Route;
const INBOX_PATH = '/admin/notifications' as Route;
/** The moderator workspace's own inbox: same component, its own route and permission. */
const MODERATOR_INBOX_PATH = '/moderator/notifications' as Route;

const SITE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  not_found: 'That record no longer exists. Reload the page.',
  seo_target_missing: 'That page no longer exists. Reload the list.',
  store_profile_invalid: 'Check the store details and try again.',
  notification_not_found: 'That notification is no longer available.',
  bad_request: 'Check the details and try again.',
  forbidden: 'Your account does not have permission for this action.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

function kindOf(value: string): SeoKind | undefined {
  return value === 'product' || value === 'category' ? value : undefined;
}

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

/** What was typed in the named fields, to show again after a refusal. */
function valuesOf(formData: FormData, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, formText(formData, field)]));
}

/** Saves one product's or category's search metadata. */
export async function saveSeoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const kind = kindOf(formText(formData, 'kind'));
  const targetId = idOf(formData, 'targetId');
  if (kind === undefined || targetId === undefined) return PAGE_EXPIRED;

  const noIndex = formText(formData, 'noIndex') === 'on';
  const values = { ...valuesOf(formData, SEO_FIELDS), noIndex: noIndex ? 'on' : '' };
  const checked = checkSeo(values, noIndex);
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, values);

  // The editor's own address: the route takes the singular kind (product | category).
  const path = seoEditorPath(kind, targetId) as Route;
  const result = await adminAct(
    formData,
    (api, token) =>
      kind === 'product'
        ? api.saveProductSeo(token, targetId, checked.value)
        : api.saveCategorySeo(token, targetId, checked.value),
    { returnTo: path, label: 'seo save', messages: SITE_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath(SEO_PATH);
  revalidatePath(path);
  return { status: 'success', message: 'Search metadata saved.' };
}

const PROFILE_TEXT_FIELDS = Object.keys(STORE_LIMITS);

/** Saves the store's public profile. Nothing private is part of this form. */
export async function saveStoreProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = valuesOf(formData, PROFILE_TEXT_FIELDS);
  // The newer fields the loaded profile did not carry: an empty one is kept, not cleared.
  const absent = formText(formData, 'absentFields')
    .split(',')
    .filter((field) => (NEWER_STORE_FIELDS as readonly string[]).includes(field));
  const checked = checkStoreProfile(values, absent);
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, values);

  const result = await adminAct(
    formData,
    (api, token) => api.saveStoreProfile(token, checked.value),
    {
      returnTo: PROFILE_PATH,
      label: 'store profile save',
      messages: SITE_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath(PROFILE_PATH);
  // The storefront footer and support pages read the same profile.
  revalidatePath('/', 'layout');
  return { status: 'success', message: 'Store profile saved.' };
}

/** Marks one inbox item as read. A hidden `surface` field decides which workspace's route. */
export async function markNotificationReadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const notificationId = idOf(formData, 'notificationId');
  if (notificationId === undefined) return PAGE_EXPIRED;
  const moderator = formData.get('surface') === 'moderator';
  const returnTo = moderator ? MODERATOR_INBOX_PATH : INBOX_PATH;

  const result = await adminAct(
    formData,
    (api, token) =>
      moderator
        ? api.markModeratorNotificationRead(token, notificationId)
        : api.markNotificationRead(token, notificationId),
    { returnTo, label: 'notification read', messages: SITE_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath(returnTo);
  return { status: 'success', message: 'Marked as read.' };
}

/** Marks every inbox item as read. */
export async function markAllNotificationsReadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const moderator = formData.get('surface') === 'moderator';
  const returnTo = moderator ? MODERATOR_INBOX_PATH : INBOX_PATH;
  const result = await adminAct(
    formData,
    (api, token) =>
      moderator
        ? api.markAllModeratorNotificationsRead(token)
        : api.markAllNotificationsRead(token),
    {
      returnTo,
      label: 'notifications read all',
      messages: SITE_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(returnTo);
  return { status: 'success', message: 'Everything is marked as read.' };
}
