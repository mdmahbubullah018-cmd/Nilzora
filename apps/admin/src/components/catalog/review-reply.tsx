'use client';

import type { ReviewReply, ReviewStatus } from '@nilzora/contracts';
import { MessageSquareQuote, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { buttonClasses } from '@nilzora/ui';
import { clearReviewReplyAction, replyToReviewAction } from '@/lib/review-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/**
 * The shop's public answer to one review, and the way to write, replace or withdraw it.
 *
 * Answering is its own permission (`reviews.reply`), so an account that may publish a review is
 * not automatically allowed to speak for the shop. A review that has been rejected cannot be
 * answered until it is published again — the database refuses, and the note says why.
 *
 * The panel is collapsed until it is wanted: the queue is a list of judgements, and an editor
 * open under every review would bury them.
 */
export function ReviewReplyEditor({
  reviewId,
  reply,
  status,
  csrf,
}: {
  reviewId: string;
  reply: ReviewReply | null;
  status: ReviewStatus;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(reply?.body ?? '');
  const [state, action, pending] = useActionState(replyToReviewAction, IDLE_STATE);
  const [clearState, clear, clearing] = useActionState(clearReviewReplyAction, IDLE_STATE);

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-neutral-soft/40 p-3">
      {reply === null ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <MessageSquareQuote aria-hidden="true" />
          {open ? 'Cancel answer' : 'Answer this review'}
        </button>
      ) : (
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold text-foreground">
            <AutoText>Nilzora replied publicly</AutoText>
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-line wrap-break-word text-body">
            {reply.body}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(reply.body);
                setOpen((value) => !value);
              }}
              aria-expanded={open}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              {open ? 'Cancel' : 'Edit answer'}
            </button>
            <form action={clear}>
              <input type="hidden" name={csrf.name} value={csrf.token} />
              <input type="hidden" name="reviewId" value={reviewId} />
              <button
                type="submit"
                disabled={clearing}
                className={buttonClasses({ variant: 'ghost', size: 'sm' })}
              >
                <Trash2 aria-hidden="true" />
                {clearing ? 'Removing…' : 'Remove answer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {open ? (
        <form action={action} className="grid gap-2">
          <input type="hidden" name={csrf.name} value={csrf.token} />
          <input type="hidden" name="reviewId" value={reviewId} />
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-foreground">
              <AutoText>Public answer</AutoText>
            </span>
            <textarea
              name="body"
              rows={3}
              minLength={2}
              maxLength={1000}
              required
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={tx('Thank the customer, answer the point, and say what you will do.')}
              className="w-full rounded-xl border border-input-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Shown under the review on the product page and in the app, signed with the Nilzora name
            — never the name of the account that wrote it.
          </p>
          {status === 'rejected' ? (
            <p className="text-xs text-warning-ink">
              <AutoText>
                This review is hidden. Publish it before answering, or the answer will not be
                visible.
              </AutoText>
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className={buttonClasses({ variant: 'primary', size: 'sm' })}
            >
              {pending ? 'Saving…' : reply === null ? 'Publish answer' : 'Save answer'}
            </button>
          </div>
        </form>
      ) : null}

      <ActionFeedback state={state} successOnly inline />
      <ActionFeedback state={clearState} successOnly inline />
    </div>
  );
}
