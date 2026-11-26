'use client';

import { Button, buttonClasses } from '@nilzora/ui';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

export type CancelReturnFormViewProps = {
  csrf: CsrfField;
  returnId: string;
} & FormStatusProps;

/**
 * Cancelling takes two deliberate steps: opening the disclosure, then confirming. A native
 * <details> needs no JavaScript and is keyboard accessible, and it stays open after an
 * error so the message is seen. Only a request still waiting for a decision can be cancelled;
 * the page shows this form only then, and the API checks again.
 */
export function CancelReturnFormView({
  csrf,
  returnId,
  state,
  formAction,
  pending,
}: CancelReturnFormViewProps) {
  return (
    <details open={state.status === 'error' || undefined}>
      <summary
        className={buttonClasses({
          variant: 'outline',
          className: 'w-full list-none [&::-webkit-details-marker]:hidden',
        })}
      >
        Cancel this return
      </summary>
      <form action={formAction} className="mt-4 grid gap-4">
        <FormMessage state={state} />
        <CsrfInput csrf={csrf} />
        <input type="hidden" name="returnId" value={returnId} />
        <Button type="submit" variant="danger" loading={pending}>
          Yes, cancel this return
        </Button>
      </form>
    </details>
  );
}

export function CancelReturnForm({
  action,
  ...fields
}: Omit<CancelReturnFormViewProps, keyof FormStatusProps> & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <CancelReturnFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
