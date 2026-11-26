'use client';

import { Button, buttonClasses, Field, Textarea } from '@nilzora/ui';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

const MAX_REASON_LENGTH = 300;

interface CancelOrderFields {
  csrf: CsrfField;
  orderNumber: string;
}

export type CancelOrderFormViewProps = CancelOrderFields & FormStatusProps;

/**
 * Cancelling takes two deliberate steps: opening the disclosure, then confirming. A
 * native <details> needs no JavaScript and is keyboard accessible. It stays open after
 * an error so the message is seen.
 */
export function CancelOrderFormView({
  csrf,
  orderNumber,
  state,
  formAction,
  pending,
}: CancelOrderFormViewProps) {
  const errors = state.fieldErrors ?? {};
  return (
    <details open={state.status === 'error' || undefined}>
      <summary
        className={buttonClasses({
          variant: 'outline',
          className: 'w-full list-none [&::-webkit-details-marker]:hidden',
        })}
      >
        Cancel this order
      </summary>
      <form action={formAction} className="mt-4 grid gap-4">
        <FormMessage state={state} />
        <CsrfInput csrf={csrf} />
        <input type="hidden" name="orderNumber" value={orderNumber} />
        <Field
          id="cancel-reason"
          label="Reason (optional)"
          hint={`Helps us improve. Up to ${MAX_REASON_LENGTH} characters.`}
          error={errors.reason}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              rows={3}
              maxLength={MAX_REASON_LENGTH}
              defaultValue={state.values?.reason ?? ''}
            />
          )}
        </Field>
        <Button type="submit" variant="danger" loading={pending}>
          Yes, cancel order {orderNumber}
        </Button>
      </form>
    </details>
  );
}

export function CancelOrderForm({ action, ...fields }: CancelOrderFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <CancelOrderFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
