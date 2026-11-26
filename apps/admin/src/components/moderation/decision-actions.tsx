'use client';

import type { ModerationDecision } from '@nilzora/contracts';
import { Field, Textarea } from '@nilzora/ui';
import { CircleCheck, CircleX, MessageSquareWarning } from 'lucide-react';
import { useActionState, type ReactNode } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { decideReviewAction } from '@/lib/moderation-actions';

const DECISIONS: Record<
  ModerationDecision,
  {
    trigger: string;
    icon: ReactNode;
    title: string;
    description: string;
    confirm: string;
    variant: 'primary' | 'outline';
    tone: 'primary' | 'danger';
    noteRequired: boolean;
  }
> = {
  approved: {
    trigger: 'Approve',
    icon: <CircleCheck aria-hidden="true" />,
    title: 'Approve this content?',
    description: 'The product can then be published by staff. This decision is final.',
    confirm: 'Yes, approve',
    variant: 'primary',
    tone: 'primary',
    noteRequired: false,
  },
  changes_requested: {
    trigger: 'Request changes',
    icon: <MessageSquareWarning aria-hidden="true" />,
    title: 'Request changes?',
    description: 'The submitter edits the content and submits it again. Explain what to change.',
    confirm: 'Request changes',
    variant: 'outline',
    tone: 'primary',
    noteRequired: true,
  },
  rejected: {
    trigger: 'Reject',
    icon: <CircleX aria-hidden="true" />,
    title: 'Reject this content?',
    description: 'The review closes as rejected. Explain why. This decision is final.',
    confirm: 'Yes, reject',
    variant: 'outline',
    tone: 'danger',
    noteRequired: true,
  },
};

const ORDER: readonly ModerationDecision[] = ['approved', 'changes_requested', 'rejected'];

/** The assigned moderator's three decisions, each confirmed with its note. */
export function DecisionActions({ taskId, csrf }: { taskId: string; csrf: CsrfInput }) {
  const [state, action] = useActionState(decideReviewAction, IDLE_STATE);
  const failedDecision = state.status === 'error' ? state.values?.decision : undefined;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {ORDER.map((decision) => {
          const copy = DECISIONS[decision];
          const failed = failedDecision === decision;
          return (
            <ConfirmForm
              key={decision}
              action={action}
              csrf={csrf}
              align="start"
              trigger={
                <>
                  {copy.icon}
                  {copy.trigger}
                </>
              }
              triggerVariant={copy.variant}
              tone={copy.tone}
              title={copy.title}
              description={copy.description}
              confirmLabel={copy.confirm}
              hiddenFields={{ taskId, decision }}
              error={failed ? state.message : undefined}
            >
              <Field
                id={`note-${decision}`}
                label={copy.noteRequired ? 'Note for the submitter' : 'Note'}
                hint={copy.noteRequired ? '10 to 1,000 characters.' : 'Optional.'}
                error={failed ? state.fieldErrors?.note : undefined}
                required={copy.noteRequired}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="note"
                    rows={4}
                    minLength={copy.noteRequired ? 10 : undefined}
                    maxLength={1000}
                    defaultValue={failed ? state.values?.note : undefined}
                  />
                )}
              </Field>
            </ConfirmForm>
          );
        })}
      </div>
      <ActionFeedback state={state} successOnly />
      {state.status === 'error' && !failedDecision ? <ActionFeedback state={state} /> : null}
    </div>
  );
}
