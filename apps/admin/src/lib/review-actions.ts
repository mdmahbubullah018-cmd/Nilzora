'use server';

import type { ApiErrorCode } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, type ActionState } from '@/components/admin-kit/act';
import type { Route } from 'next';

/*
 * Approving or rejecting a customer product review. The API authorises the change and
 * the database checks `reviews.moderate` again; it also refuses a moderator's own
 * review, so this form cannot be used to approve what you wrote.
 */

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'You do not have permission to moderate reviews.',
  not_found: 'This review no longer exists.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

const REVIEWS_PATH = '/admin/reviews' as Route;

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

/** Publishes or rejects a review; a rejection needs a reason the customer will see. */
export async function setReviewStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reviewId = uuidSchema.safeParse(formText(formData, 'reviewId'));
  if (!reviewId.success) return PAGE_EXPIRED;
  const status = formText(formData, 'status');
  if (status !== 'approved' && status !== 'rejected') return PAGE_EXPIRED;
  const note = formText(formData, 'note').trim();
  if (status === 'rejected' && (note.length < 3 || note.length > 300)) {
    return {
      status: 'error',
      message: 'Give the customer a reason of 3 to 300 characters.',
      fieldErrors: { note: 'Give a reason of 3 to 300 characters.' },
    };
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSetReviewStatus(token, reviewId.data, {
        status,
        ...(note === '' ? {} : { note }),
      }),
    {
      returnTo: REVIEWS_PATH,
      label: 'review moderation',
      messages: {
        ...MESSAGES,
        own_submission: 'You cannot moderate a review you wrote yourself.',
      },
    },
  );
  if (!result.ok) return result.state;

  // An approved or rejected review changes the queue and the product's page.
  revalidatePath(REVIEWS_PATH);
  return {
    status: 'success',
    message: status === 'approved' ? 'Review published.' : 'Review rejected.',
  };
}

/**
 * Writing or replacing the shop's public answer to a review.
 *
 * Its own permission (`reviews.reply`): answering in public is not the same right as deciding
 * whether a review may be shown, and the database checks it again. The answer is shown under the
 * review on the product page, so the product's cached page is revalidated too.
 */
export async function replyToReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reviewId = uuidSchema.safeParse(formText(formData, 'reviewId'));
  if (!reviewId.success) return PAGE_EXPIRED;
  const body = formText(formData, 'body').trim();
  if (body.length < 2 || body.length > 1000) {
    return {
      status: 'error',
      message: 'Write an answer of 2 to 1000 characters.',
      fieldErrors: { body: 'Write an answer of 2 to 1000 characters.' },
    };
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminReplyToReview(token, reviewId.data, { body }),
    {
      returnTo: REVIEWS_PATH,
      label: 'review reply',
      messages: {
        ...MESSAGES,
        forbidden: 'You do not have permission to answer reviews.',
        bad_request: 'This review has to be published before it can be answered.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(REVIEWS_PATH);
  return { status: 'success', message: 'Your answer is published under the review.' };
}

/** Withdraws the shop's answer. */
export async function clearReviewReplyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reviewId = uuidSchema.safeParse(formText(formData, 'reviewId'));
  if (!reviewId.success) return PAGE_EXPIRED;

  const result = await adminAct(
    formData,
    (api, token) => api.adminClearReviewReply(token, reviewId.data),
    {
      returnTo: REVIEWS_PATH,
      label: 'review reply',
      messages: {
        ...MESSAGES,
        forbidden: 'You do not have permission to answer reviews.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(REVIEWS_PATH);
  return { status: 'success', message: 'Your answer has been removed.' };
}
