'use client';

import { Alert, Button, Field, Input } from '@nilzora/ui';
import Link from 'next/link';
import type { Route } from 'next';
import { useActionState } from 'react';
import { authLinkClasses } from './auth-card';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from './form-kit';

interface ForgotPasswordFormFields {
  csrf: CsrfField;
  /** Where the reset form should prefill the address from, if the page knows it. */
  email?: string;
}

export type ForgotPasswordFormViewProps = ForgotPasswordFormFields & FormStatusProps;

/**
 * Asks for a reset code. The answer is the same whether or not the address has an
 * account, so this form cannot be used to discover registered emails.
 */
export function ForgotPasswordFormView({
  csrf,
  email,
  state,
  formAction,
  pending,
}: ForgotPasswordFormViewProps) {
  const errors = state.fieldErrors ?? {};
  if (state.status === 'success') {
    const address = state.values?.email ?? email ?? '';
    return (
      <div className="grid gap-5">
        <Alert tone="success" title="Check your inbox">
          {state.message}
        </Alert>
        <Link
          href={`/reset-password?email=${encodeURIComponent(address)}` as Route}
          className={`${authLinkClasses} justify-self-start`}
        >
          I have the code
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />

      <Field id="forgot-email" label="Email address" error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={state.values?.email ?? email}
          />
        )}
      </Field>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Email me a code
      </Button>

      <p className="text-sm text-slate-600">
        Remembered it?{' '}
        <Link href="/login" className={authLinkClasses}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm({
  action,
  ...fields
}: ForgotPasswordFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <ForgotPasswordFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
