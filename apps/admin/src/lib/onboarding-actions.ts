'use server';

import type { ApiErrorCode, OnboardingIcon } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import { adminAct, formText } from '@/components/admin-kit/act';

/*
 * Onboarding management.
 *
 * The database is the authority for every rule: it checks `settings.manage` again, refuses
 * a second active campaign of the same kind, refuses to activate a campaign with no enabled
 * slide, and refuses to delete one that is still live. These actions only shape the request
 * and refresh the pages a change is visible on.
 */

const LIST_PATH = '/admin/marketing/onboarding' as Route;

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  onboarding_not_found: 'That campaign or slide no longer exists. Reload the page.',
  onboarding_invalid: 'Check the campaign details and try again.',
  onboarding_conflict:
    'Another campaign of this kind is already active. Switch the other one off first.',
  bad_request: 'Check the details and try again.',
  forbidden: 'Your account does not have permission for this action.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

function optional(formData: FormData, name: string): string | null {
  const value = formText(formData, name).trim();
  return value === '' ? null : value;
}

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function editorPath(campaignId: string): Route {
  return `/admin/marketing/onboarding/${campaignId}` as Route;
}

/** `datetime-local` sends a wall-clock value; a stored window needs an instant. */
function instant(formData: FormData, name: string): string | null {
  const value = formText(formData, name).trim();
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

const ICONS: readonly OnboardingIcon[] = [
  'shop',
  'search',
  'wishlist',
  'cart',
  'cash',
  'delivery',
  'success',
  'verified',
  'location',
  'orders',
  'returns',
  'help',
];

function iconOf(value: string): OnboardingIcon | null {
  return (ICONS as readonly string[]).includes(value) ? (value as OnboardingIcon) : null;
}

function daysOf(value: string): number | null {
  const days = Number.parseInt(value, 10);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

function secondsOf(value: string): 3 | 5 | 10 {
  return value === '3' ? 3 : value === '10' ? 10 : 5;
}

/** Creates or updates one campaign, then opens its editor. */
export async function saveOnboardingCampaignAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  const input: Record<string, unknown> = {
    internalName: formText(formData, 'internalName').trim(),
    kind: formText(formData, 'kind'),
    audience: formText(formData, 'audience'),
    frequency: formText(formData, 'frequency'),
    repeatDays:
      formText(formData, 'frequency') === 'interval'
        ? daysOf(formText(formData, 'repeatDays'))
        : null,
    slideSeconds: secondsOf(formText(formData, 'slideSeconds')),
    startsAt: instant(formData, 'startsAt'),
    endsAt: instant(formData, 'endsAt'),
    isActive: formText(formData, 'isActive') === 'on',
  };

  const result = await adminAct(
    formData,
    async (api, token) => {
      const response = campaignId
        ? await api.updateOnboardingCampaign(token, campaignId, input as never)
        : await api.createOnboardingCampaign(token, input as never);
      return response.campaign;
    },
    {
      returnTo: campaignId ? editorPath(campaignId) : LIST_PATH,
      label: campaignId ? 'onboarding campaign update' : 'onboarding campaign create',
      messages: MESSAGES,
    },
  );

  if (result.ok) {
    revalidatePath(LIST_PATH);
    revalidatePath(editorPath(result.value.id));
  }
}

/** The list's one-click switch. */
export async function setOnboardingActiveAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  if (campaignId === undefined) return;

  const result = await adminAct(
    formData,
    (api, token) =>
      api.setOnboardingCampaignActive(token, campaignId, formText(formData, 'active') === 'true'),
    { returnTo: LIST_PATH, label: 'onboarding activation', messages: MESSAGES },
  );

  if (result.ok) {
    revalidatePath(LIST_PATH);
    revalidatePath(editorPath(campaignId));
  }
}

/** Deleting is refused by the database while the campaign is live. */
export async function deleteOnboardingCampaignAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  if (campaignId === undefined) return;

  await adminAct(formData, (api, token) => api.deleteOnboardingCampaign(token, campaignId), {
    returnTo: LIST_PATH,
    label: 'onboarding campaign delete',
    messages: MESSAGES,
  });
  revalidatePath(LIST_PATH);
}

/** Creates or updates one slide. */
export async function saveOnboardingSlideAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  const slideId = idOf(formData, 'slideId');
  if (campaignId === undefined) return;

  const input = {
    internalName: formText(formData, 'internalName').trim(),
    heading: formText(formData, 'heading').trim(),
    description: formText(formData, 'description').trim(),
    imageKey: optional(formData, 'imageKey'),
    icon: iconOf(formText(formData, 'icon')),
    ctaLabel: optional(formData, 'ctaLabel'),
    ctaPath: optional(formData, 'ctaPath'),
    altText: optional(formData, 'altText'),
    isActive: formText(formData, 'isActive') === 'on',
  };

  await adminAct(
    formData,
    (api, token) =>
      slideId
        ? api.updateOnboardingSlide(token, campaignId, slideId, input)
        : api.createOnboardingSlide(token, campaignId, input),
    { returnTo: editorPath(campaignId), label: 'onboarding slide save', messages: MESSAGES },
  );
  revalidatePath(editorPath(campaignId));
  revalidatePath(LIST_PATH);
}

export async function deleteOnboardingSlideAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  const slideId = idOf(formData, 'slideId');
  if (campaignId === undefined || slideId === undefined) return;

  await adminAct(formData, (api, token) => api.deleteOnboardingSlide(token, campaignId, slideId), {
    returnTo: editorPath(campaignId),
    label: 'onboarding slide delete',
    messages: MESSAGES,
  });
  revalidatePath(editorPath(campaignId));
}

/**
 * Moves one slide up or down.
 *
 * The page sends the order it rendered, so the action never has to guess it. If someone
 * else reordered the slides in the meantime the database refuses the list, which is the
 * right outcome: the admin sees the fresh order rather than a surprise.
 */
export async function moveOnboardingSlideAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  const slideId = idOf(formData, 'slideId');
  const direction = formText(formData, 'direction');
  const order = formText(formData, 'order')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  if (campaignId === undefined || slideId === undefined) return;
  if (!order.includes(slideId)) return;

  const index = order.indexOf(slideId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return;

  const next = [...order];
  const moved = next[index];
  const displaced = next[target];
  if (moved === undefined || displaced === undefined) return;
  next[index] = displaced;
  next[target] = moved;

  await adminAct(formData, (api, token) => api.reorderOnboardingSlides(token, campaignId, next), {
    returnTo: editorPath(campaignId),
    label: 'onboarding slide reorder',
    messages: MESSAGES,
  });
  revalidatePath(editorPath(campaignId));
}

/**
 * Saves a new slide order from drag-and-drop. The page sends the complete list of slide ids in
 * the order they were dropped; the database refuses a list that is not exactly the campaign's
 * slides, so a stale page is told to reload instead of scrambling the order.
 */
export async function reorderOnboardingSlidesAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const campaignId = idOf(formData, 'campaignId');
  const order = formText(formData, 'order')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (
    campaignId === undefined ||
    order.length === 0 ||
    order.some((id) => idOfText(id) === undefined)
  ) {
    return { ok: false, message: 'This page is out of date. Reload it and try again.' };
  }
  const result = await adminAct(
    formData,
    (api, token) => api.reorderOnboardingSlides(token, campaignId, order),
    { returnTo: editorPath(campaignId), label: 'onboarding slide reorder', messages: MESSAGES },
  );
  if (!result.ok) {
    return {
      ok: false,
      message: 'The order could not be saved. The slides may have changed: reload the page.',
    };
  }
  revalidatePath(editorPath(campaignId));
  return { ok: true };
}

function idOfText(value: string): string | undefined {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
