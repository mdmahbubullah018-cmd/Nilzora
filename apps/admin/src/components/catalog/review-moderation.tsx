'use client';

import type { ReviewStatus } from '@nilzora/contracts';
import { CircleCheck, CircleX } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { setReviewStatusAction } from '@/lib/review-actions';
import { useTx } from '@/lib/i18n/provider';

/**
 * Publish and reject for one customer review, each confirmed first. A refusal is shown in
 * the confirmation; a success says so under the buttons (the API decides either way).
 */
export function ReviewModerationActions({
  reviewId,
  status,
  csrf,
}: {
  reviewId: string;
  status: ReviewStatus;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [approveState, approve] = useActionState(setReviewStatusAction, IDLE_STATE);
  const [rejectState, reject] = useActionState(setReviewStatusAction, IDLE_STATE);
  const success = approveState.status === 'success' ? approveState : rejectState;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== 'approved' ? (
          <ConfirmForm
            action={approve}
            csrf={csrf}
            align="start"
            trigger={
              <>
                <CircleCheck aria-hidden="true" strokeWidth={1.75} />
                Publish
              </>
            }
            triggerVariant="primary"
            title={tx('Publish this review?')}
            description={tx(
              'It becomes visible on the product page, and its rating counts towards the average.',
            )}
            confirmLabel={tx('Yes, publish it')}
            tone="primary"
            hiddenFields={{ reviewId, status: 'approved' }}
            error={approveState.status === 'error' ? approveState.message : undefined}
          />
        ) : null}
        {status !== 'rejected' ? (
          <ConfirmForm
            action={reject}
            csrf={csrf}
            align="start"
            trigger={
              <>
                <CircleX aria-hidden="true" strokeWidth={1.75} />
                Reject
              </>
            }
            title={tx('Reject this review?')}
            description={tx('It stays hidden. The customer sees your reason in their account.')}
            confirmLabel={tx('Yes, reject it')}
            tone="danger"
            hiddenFields={{ reviewId, status: 'rejected' }}
            error={rejectState.status === 'error' ? rejectState.message : undefined}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Reason (required)</span>
              <textarea
                name="note"
                rows={2}
                minLength={3}
                maxLength={300}
                required
                className="w-full rounded-xl border border-input-border bg-surface px-3 py-2 text-sm text-foreground"
              />
            </label>
          </ConfirmForm>
        ) : null}
      </div>
      <ActionFeedback state={success} successOnly inline />
    </div>
  );
}
