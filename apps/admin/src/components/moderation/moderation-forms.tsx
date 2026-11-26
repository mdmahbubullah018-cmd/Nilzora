'use client';

import type { ModerationReviewer } from '@nilzora/contracts';
import { Button, NativeSelect } from '@nilzora/ui';
import { Undo2 } from 'lucide-react';
import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { assignReviewAction, withdrawReviewAction } from '@/lib/moderation-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

function AssignButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" loading={pending}>
      {label}
    </Button>
  );
}

function reviewerLabel(reviewer: ModerationReviewer): string {
  const name = reviewer.name ?? reviewer.email ?? 'Reviewer';
  const load = reviewer.openReviews === 1 ? '1 open' : `${String(reviewer.openReviews)} open`;
  return `${name} (${load})`;
}

export interface AssignReviewFormProps {
  taskId: string;
  productName: string;
  /** Accounts that can review content, the submitter already left out. */
  reviewers: readonly ModerationReviewer[];
  assignedToId?: string | undefined;
  /** The page to come back to with a notice: this list (with its filters) or the review. */
  returnTo: string;
  csrf: CsrfInput;
}

/** Assigns or reassigns an open review: a reviewer list with their open review counts. */
export function AssignReviewForm({
  taskId,
  productName,
  reviewers,
  assignedToId,
  returnTo,
  csrf,
}: AssignReviewFormProps) {
  const [state, action] = useActionState(assignReviewAction, IDLE_STATE);
  const id = useId();
  const choices = reviewers.filter((reviewer) => reviewer.id !== assignedToId);

  if (choices.length === 0) {
    return (
      <p className="text-xs whitespace-normal text-muted-foreground">
        {assignedToId ? 'No other reviewer is available.' : 'No reviewer is available.'}
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-1">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {`Reviewer for ${productName}`}
        </label>
        <NativeSelect id={id} name="moderatorId" required defaultValue="" className="h-8 w-52">
          <option value="" disabled>
            <AutoText>Choose a reviewer</AutoText>
          </option>
          {choices.map((reviewer) => (
            <option key={reviewer.id} value={reviewer.id}>
              {reviewerLabel(reviewer)}
            </option>
          ))}
        </NativeSelect>
        <AssignButton label={assignedToId ? 'Reassign' : 'Assign'} />
      </div>
      <ActionFeedback state={state} inline className="max-w-72" />
    </form>
  );
}

/** Withdraws an open review after confirmation. */
export function WithdrawReviewForm({
  taskId,
  productName,
  csrf,
}: {
  taskId: string;
  productName: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(withdrawReviewAction, IDLE_STATE);
  return (
    <div className="grid justify-items-start gap-1">
      <ConfirmForm
        action={action}
        csrf={csrf}
        align="start"
        trigger={
          <>
            <Undo2 aria-hidden="true" />
            Withdraw
          </>
        }
        triggerVariant="outline"
        title={`Withdraw the review of ${productName}?`}
        description={tx(
          "The review closes without a decision and the product's content can be edited again. It must be resubmitted to be reviewed.",
        )}
        confirmLabel={tx('Yes, withdraw')}
        hiddenFields={{ taskId }}
        error={state.status === 'error' ? state.message : undefined}
      />
    </div>
  );
}
