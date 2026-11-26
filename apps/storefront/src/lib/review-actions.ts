'use server';

import { reviewSubmitRequestSchema } from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState } from '@nilzora/web-session';
import { revalidatePath } from 'next/cache';
import { uuidSchema } from '@nilzora/validation';
import { session } from '@/lib/session';

/*
 * Submitting a product review. The database decides whether this account may review the
 * product (it must have received it) and whether one already exists; this action only
 * shapes the form state. Messages are fixed strings, never the API's own text.
 */

const FIELDS = ['rating', 'title', 'body'] as const;

const MESSAGES: Record<string, string> = {
  review_duplicate: 'You have already reviewed this product.',
  review_not_eligible: 'Only customers who received this product can review it.',
  review_account_blocked: 'This account cannot post reviews.',
  review_invalid: 'Check the rating and the text of your review.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  forbidden: 'Only customers who received this product can review it.',
};

const UNAVAILABLE = 'Nilzora could not be reached. Please try again in a moment.';
const CHECK_FIELDS = 'Check the highlighted fields.';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function submitReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = uuidSchema.safeParse(text(formData, 'productId'));
  const slug = text(formData, 'slug');
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field] = text(formData, field);

  if (!productId.success || slug === '') {
    return { status: 'error', message: FORM_EXPIRED.message ?? 'Reload the page.', values };
  }

  const parsed = reviewSubmitRequestSchema.safeParse({
    rating: Number(values.rating),
    title: values.title,
    body: values.body,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      fieldErrors[field] ??= issue.message;
    }
    return { status: 'error', message: CHECK_FIELDS, fieldErrors, values };
  }

  let reviewId: string;
  try {
    const outcome = await session.act(formData, (api, accessToken) =>
      api.submitProductReview(accessToken, productId.data, parsed.data),
    );
    if (outcome.kind === 'untrusted') {
      return { status: 'error', message: FORM_EXPIRED.message ?? 'Reload the page.', values };
    }
    if (outcome.kind === 'signed_out') {
      return {
        status: 'error',
        message: 'Your session has ended. Sign in again to post your review.',
        values,
      };
    }
    if (outcome.kind === 'unavailable') {
      return { status: 'error', message: UNAVAILABLE, values };
    }
    reviewId = outcome.value.reviewId;
  } catch (error) {
    if (error instanceof ApiError) {
      const message = MESSAGES[error.code];
      if (message !== undefined) {
        return { status: 'error', message, values };
      }
      if (error.status >= 400 && error.status < 500) {
        return { status: 'error', message: CHECK_FIELDS, values };
      }
    }
    return { status: 'error', message: UNAVAILABLE, values };
  }

  // With photos on their way the page is refreshed once they have all been sent (the form asks for
  // that): refreshing now would swap the form for the published review and lose the photos.
  if (text(formData, 'deferRefresh') !== '1') revalidatePath(`/products/${slug}`);
  // The id lets the form attach the customer's photos to this review.
  return {
    status: 'success',
    message: 'Thank you. Your review is published.',
    values: { reviewId },
  };
}

/**
 * Helpful / not helpful on one review.
 *
 * One row per account per review, so pressing the same button twice withdraws the vote rather
 * than counting it twice. The whole thing is a plain form post, so it works with JavaScript off
 * and the button can be a real button rather than a click handler.
 */
export async function voteReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reviewId = uuidSchema.safeParse(text(formData, 'reviewId'));
  const slug = text(formData, 'slug');
  const verdict = text(formData, 'verdict');
  if (!reviewId.success || slug === '') {
    return { status: 'error', message: FORM_EXPIRED.message ?? 'Reload the page.' };
  }
  if (verdict !== 'helpful' && verdict !== 'not_helpful' && verdict !== 'clear') {
    return { status: 'error', message: 'That vote could not be read.' };
  }

  try {
    const outcome = await session.act(formData, (api, accessToken) =>
      api.voteProductReview(accessToken, reviewId.data, {
        verdict: verdict === 'clear' ? null : verdict,
      }),
    );
    if (outcome.kind === 'untrusted') {
      return { status: 'error', message: FORM_EXPIRED.message ?? 'Reload the page.' };
    }
    if (outcome.kind === 'signed_out') {
      return { status: 'error', message: 'Your session has ended. Sign in again to vote.' };
    }
    if (outcome.kind === 'unavailable') {
      return { status: 'error', message: UNAVAILABLE };
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'NZ465' || error.status === 403) {
        return { status: 'error', message: 'You cannot vote on your own review.' };
      }
      if (error.status === 404) {
        return { status: 'error', message: 'That review is no longer available.' };
      }
      if (error.status === 429) {
        return { status: 'error', message: MESSAGES['rate_limited'] ?? UNAVAILABLE };
      }
    }
    return { status: 'error', message: UNAVAILABLE };
  }

  revalidatePath(`/products/${slug}`);
  return { status: 'success', message: 'Thanks for the feedback.' };
}

/**
 * "Not now" on the account page's review prompt: the server records it, so the same product is
 * not asked about again on any device. A failure is not shown — a prompt is never worth an
 * error — and the dialog closes either way.
 */
export async function dismissReviewPromptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = uuidSchema.safeParse(text(formData, 'productId'));
  if (!productId.success)
    return { status: 'error', message: FORM_EXPIRED.message ?? 'Reload the page.' };
  try {
    const outcome = await session.act(formData, (api, accessToken) =>
      api.dismissReviewPrompt(accessToken, productId.data),
    );
    if (outcome.kind !== 'ok') return { status: 'error', message: UNAVAILABLE };
  } catch {
    return { status: 'error', message: UNAVAILABLE };
  }
  return { status: 'success', message: 'We will not ask about this product again.' };
}
