'use client';

import type { ReviewReply, ReviewVoteVerdict } from '@nilzora/contracts';
import { BadgeCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useActionState } from 'react';
import type { FormState } from '@nilzora/web-session';
import type { CsrfField } from '../auth/form-kit';
import { voteReviewAction } from '@/lib/review-actions';

/*
 * The two things a customer can do with somebody else's review: read the shop's answer, and say
 * whether it helped.
 *
 * The answer is rendered as the shop, never as a person — a review is answered by Nilzora, and
 * the account that typed it stays in the audit trail.
 *
 * The vote is a real form: two submit buttons, one value each. Pressing the button that already
 * matches the caller's vote sends "clear" instead, which is how a vote is taken back. That keeps
 * the whole interaction working without JavaScript, and it means a repeated press can never
 * inflate a tally — the database keeps one row per account per review either way.
 */

const INITIAL: FormState = { status: 'idle' };

export function BusinessReply({ reply }: { reply: ReviewReply }) {
  return (
    <div className="rounded-lg border-l-2 border-primary bg-surface-muted/70 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <BadgeCheck aria-hidden="true" className="size-3.5 text-primary" />
        {reply.authorName}
        <span className="font-normal text-muted-foreground">replied</span>
      </p>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line wrap-break-word text-body">
        {reply.body}
      </p>
    </div>
  );
}

export function ReviewVoteControl({
  reviewId,
  slug,
  csrf,
  helpfulCount,
  notHelpfulCount,
  viewerVote,
  enabled,
}: {
  reviewId: string;
  slug: string;
  csrf: CsrfField | undefined;
  helpfulCount: number;
  notHelpfulCount: number;
  viewerVote: ReviewVoteVerdict | null;
  /** False for a visitor who is not signed in: the counts still show, the buttons do not. */
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(voteReviewAction, INITIAL);

  if (!enabled || csrf === undefined) {
    return (
      <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp aria-hidden="true" className="size-3.5" />
          {helpfulCount} found this helpful
        </span>
        {notHelpfulCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ThumbsDown aria-hidden="true" className="size-3.5" />
            {notHelpfulCount}
          </span>
        ) : null}
      </p>
    );
  }

  const helpful = viewerVote === 'helpful';
  const notHelpful = viewerVote === 'not_helpful';

  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name={csrf.name} value={csrf.token} />
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="slug" value={slug} />
      <span className="text-muted-foreground">Was this helpful?</span>
      <button
        type="submit"
        name="verdict"
        value={helpful ? 'clear' : 'helpful'}
        disabled={pending}
        aria-pressed={helpful}
        aria-label={helpful ? 'Remove your helpful vote' : 'Mark this review helpful'}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${
          helpful
            ? 'border-primary bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground'
        }`}
      >
        <ThumbsUp aria-hidden="true" className="size-3.5" />
        Yes · {helpfulCount}
      </button>
      <button
        type="submit"
        name="verdict"
        value={notHelpful ? 'clear' : 'not_helpful'}
        disabled={pending}
        aria-pressed={notHelpful}
        aria-label={notHelpful ? 'Remove your not-helpful vote' : 'Mark this review not helpful'}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${
          notHelpful
            ? 'border-primary bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground'
        }`}
      >
        <ThumbsDown aria-hidden="true" className="size-3.5" />
        No · {notHelpfulCount}
      </button>
      {state.status === 'error' ? (
        <span role="alert" className="text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
