'use server';

import { checkoutRecoveryChannelSchema, checkoutRecoveryStateSchema } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import { adminAct, formText, type ActionState } from '@/components/admin-kit/act';

/*
 * Working an abandoned checkout. Every action is authorised twice: the Server Action needs
 * this app's CSRF token, and the API checks `checkouts.recover` before its database function
 * runs. Nothing here decides a rule — what counts as abandoned, whether a link still works,
 * whether a checkout may be dismissed all live in SQL.
 */

const CHECKOUTS: Route = '/admin/checkouts';

const RECOVERY_MESSAGES: Partial<Record<string, string>> = {
  recovery_invalid: 'That is not possible for this checkout. Reload the page and check its stage.',
  recovery_link_invalid: 'That recovery link has already been used, replaced or has expired.',
  recovery_not_owner: 'That recovery link belongs to another customer.',
};

function pageExpired(): ActionState {
  return { status: 'error', message: 'This page is out of date. Reload it and try again.' };
}

function checkoutIdOf(formData: FormData): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, 'checkoutId'));
  return parsed.success ? parsed.data : undefined;
}

/** Records that a human contacted the customer. Nothing is sent by Nilzora. */
export async function recordCheckoutAttemptAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const checkoutId = checkoutIdOf(formData);
  const channel = checkoutRecoveryChannelSchema.safeParse(formText(formData, 'channel'));
  if (checkoutId === undefined || !channel.success) return pageExpired();
  const note = formText(formData, 'note').trim();

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminRecordCheckoutAttempt(token, checkoutId, {
        channel: channel.data,
        ...(note === '' ? {} : { note }),
      }),
    {
      returnTo: `${CHECKOUTS}/${checkoutId}` as Route,
      label: 'checkout contact attempt',
      messages: RECOVERY_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CHECKOUTS}/${checkoutId}`);
  revalidatePath(CHECKOUTS);
  return { status: 'success', message: 'Contact attempt recorded.' };
}

/** Moves the record between open, contacted and dismissed. */
export async function setCheckoutRecoveryStateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const checkoutId = checkoutIdOf(formData);
  const state = checkoutRecoveryStateSchema.safeParse(formText(formData, 'state'));
  if (checkoutId === undefined || !state.success) return pageExpired();

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCheckoutRecoveryState(token, checkoutId, state.data),
    {
      returnTo: `${CHECKOUTS}/${checkoutId}` as Route,
      label: 'checkout recovery state',
      messages: RECOVERY_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CHECKOUTS}/${checkoutId}`);
  revalidatePath(CHECKOUTS);
  const labels = { open: 'Open again', contacted: 'Marked as contacted', dismissed: 'Dismissed' };
  return { status: 'success', message: `${labels[state.data]}.` };
}

/**
 * Mints a single-use recovery link. The token comes back exactly once, so the success message
 * *is* the link: it is never stored in a page, a log or the database in a readable form.
 */
export async function createCheckoutRecoveryLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const checkoutId = checkoutIdOf(formData);
  if (checkoutId === undefined) return pageExpired();
  const base = formText(formData, 'storefrontUrl').replace(/\/+$/, '');

  const result = await adminAct(
    formData,
    (api, token) => api.adminCreateCheckoutRecoveryLink(token, checkoutId),
    {
      returnTo: `${CHECKOUTS}/${checkoutId}` as Route,
      label: 'checkout recovery link',
      messages: RECOVERY_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CHECKOUTS}/${checkoutId}`);
  return { status: 'success', message: `${base}/recover/${result.value.token}` };
}

export async function revokeCheckoutRecoveryLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const checkoutId = checkoutIdOf(formData);
  if (checkoutId === undefined) return pageExpired();

  const result = await adminAct(
    formData,
    (api, token) => api.adminRevokeCheckoutRecoveryLink(token, checkoutId),
    {
      returnTo: `${CHECKOUTS}/${checkoutId}` as Route,
      label: 'checkout recovery link revoke',
      messages: RECOVERY_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CHECKOUTS}/${checkoutId}`);
  return { status: 'success', message: 'The link no longer works.' };
}
