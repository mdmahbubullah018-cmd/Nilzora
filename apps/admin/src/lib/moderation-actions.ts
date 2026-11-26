'use server';

import {
  moderationAssignmentRequestSchema,
  moderationDecisionRequestSchema,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { uuidParam } from '@/components/customers/customer-query';
import {
  moderationReturnPath,
  type MODERATION_NOTICES,
} from '@/components/moderation/moderation-query';
import { withNotice } from '@/components/orders/order-query';

const ASSIGNED: keyof typeof MODERATION_NOTICES = 'assigned';
const WITHDRAWN: keyof typeof MODERATION_NOTICES = 'withdrawn';

/*
 * Content reviews: assigning (moderation.assign), withdrawing (the submitter or an
 * assigner) and the
 * assigned moderator's decision (content.approve). The database enforces who may
 * decide which review; a review assigned to someone else answers 404.
 */

const MODERATION_PATH: Route = '/admin/moderation';

const MISSING_REVIEW: ActionState = {
  status: 'error',
  message: 'This review could not be identified. Reload the page and try again.',
};

const CLOSED = 'This review is already decided or withdrawn. Reload to see where it stands.';

function refreshAdmin(taskId: string): void {
  revalidatePath(MODERATION_PATH);
  revalidatePath(`/admin/moderation/${taskId}`);
  revalidatePath('/admin');
}

/** Hands an open review to a reviewer (never its submitter). */
export async function assignReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const taskId = uuidParam(formText(formData, 'taskId'));
  if (!taskId) return MISSING_REVIEW;
  const parsed = moderationAssignmentRequestSchema.safeParse({
    moderatorId: formText(formData, 'moderatorId'),
  });
  if (!parsed.success) return invalid('Choose a reviewer.', { moderatorId: 'Choose a reviewer.' });

  const result = await adminAct(
    formData,
    (api, token) => api.adminAssignModeration(token, taskId, parsed.data),
    {
      returnTo: MODERATION_PATH,
      label: 'review assignment',
      messages: {
        review_not_assignable:
          'This review is closed, or the chosen account can no longer review content.',
        // The database refuses the submitter, the content's last editor, and (for anyone
        // but an owner) the assigner themselves.
        own_submission:
          'This account cannot review it: nobody reviews content they submitted or last edited, and only an owner assigns reviews to themselves.',
        not_found: 'This review no longer exists.',
      },
    },
  );
  if (!result.ok) return result.state;

  refreshAdmin(taskId);
  // A row can leave the list it was assigned from, so the confirmation travels with the page.
  redirect(withNotice(moderationReturnPath(formText(formData, 'returnTo')), ASSIGNED));
}

/** Withdraws an open review; the product goes back to draft and must be resubmitted. */
export async function withdrawReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const taskId = uuidParam(formText(formData, 'taskId'));
  if (!taskId) return MISSING_REVIEW;

  const result = await adminAct(
    formData,
    (api, token) => api.adminWithdrawModeration(token, taskId),
    {
      returnTo: MODERATION_PATH,
      label: 'review withdrawal',
      messages: {
        review_closed: CLOSED,
        not_found: 'This review no longer exists.',
        forbidden:
          'Only the person who submitted the review, or someone who assigns reviews, can withdraw it.',
      },
    },
  );
  if (!result.ok) return result.state;

  refreshAdmin(taskId);
  redirect(withNotice(`/admin/moderation/${taskId}`, WITHDRAWN));
}

/** The assigned moderator's decision; anything but approval needs a 10-character note. */
export async function decideReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const taskId = uuidParam(formText(formData, 'taskId'));
  if (!taskId) return MISSING_REVIEW;
  const decision = formText(formData, 'decision');
  const note = formText(formData, 'note');
  const parsed = moderationDecisionRequestSchema.safeParse({ decision, note });
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.some((issue) => issue.path[0] === 'note');
    const message =
      decision === 'approved'
        ? 'Keep the note under 1,000 characters.'
        : 'Explain the decision in 10 to 1,000 characters.';
    return noteIssue
      ? invalid(message, { note: message }, { note, decision })
      : invalid('Choose a decision.');
  }

  const path = `/moderator/tasks/${taskId}` as Route;
  const result = await adminAct(
    formData,
    (api, token) => api.moderatorDecide(token, taskId, parsed.data),
    {
      returnTo: path,
      label: 'review decision',
      messages: {
        review_closed: CLOSED,
        own_submission: 'You cannot decide a review of content you submitted yourself.',
        not_found: 'This review is not assigned to you, or no longer exists.',
        forbidden: 'Deciding reviews needs the “Approve product content” permission.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { note, decision } };

  revalidatePath(path);
  revalidatePath('/moderator');
  revalidatePath('/moderator/tasks');
  revalidatePath('/moderator/history');
  // The decision form is gone once the review is decided (keys: DECISION_NOTICES).
  redirect(withNotice(path, result.value.task.status));
}
