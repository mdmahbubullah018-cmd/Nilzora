'use client';

import { Button } from '@nilzora/ui';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from './form-kit';

interface ConfirmEmailFormFields {
  csrf: CsrfField;
  /** From the confirmation link; already checked for the expected shape. */
  tokenHash: string;
}

export type ConfirmEmailFormViewProps = ConfirmEmailFormFields & FormStatusProps;

/**
 * Confirmation happens on an explicit POST, not when the link is opened, so mail
 * scanners that prefetch links cannot use up the one-time token.
 */
export function ConfirmEmailFormView({
  csrf,
  tokenHash,
  state,
  formAction,
  pending,
}: ConfirmEmailFormViewProps) {
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="tokenHash" value={tokenHash} />
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Confirm my email
      </Button>
    </form>
  );
}

export function ConfirmEmailForm({
  action,
  ...fields
}: ConfirmEmailFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <ConfirmEmailFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
