'use client';

import { Button, type ButtonVariant } from '@nilzora/ui';
import { LogOut } from 'lucide-react';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

interface SignOutFormFields {
  csrf: CsrfField;
  variant?: ButtonVariant;
}

export type SignOutFormViewProps = SignOutFormFields & FormStatusProps;

/** Signing out is a POST with a CSRF token, so another site cannot sign a visitor out. */
export function SignOutFormView({
  csrf,
  variant = 'outline',
  state,
  formAction,
  pending,
}: SignOutFormViewProps) {
  return (
    <form action={formAction} className="grid justify-items-start gap-3">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <Button type="submit" variant={variant} loading={pending}>
        {pending ? null : <LogOut aria-hidden="true" />}
        Sign out
      </Button>
    </form>
  );
}

export function SignOutForm({ action, ...fields }: SignOutFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <SignOutFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
