'use client';

import { Button, Field, Input } from '@nilzora/ui';
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

interface ResetPasswordFormFields {
  csrf: CsrfField;
  /** The address the code was sent to, already validated by the page. */
  email: string;
}

export type ResetPasswordFormViewProps = ResetPasswordFormFields & FormStatusProps;

/**
 * Sets a new password from a reset code. The API ends every session for the account, so
 * a successful reset sends the visitor back to sign in with the new password.
 */
export function ResetPasswordFormView({
  csrf,
  email,
  state,
  formAction,
  pending,
}: ResetPasswordFormViewProps) {
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="email" value={email} />

      <p className="text-sm text-slate-600">
        Enter the six-digit code we sent to <span className="font-medium text-navy">{email}</span>{' '}
        and choose a new password.
      </p>

      <Field id="reset-code" label="Reset code" error={errors.code} required>
        {(control) => (
          <Input
            {...control}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            defaultValue={state.values?.code}
          />
        )}
      </Field>
      <Field
        id="reset-password"
        label="New password"
        hint="At least 8 characters, with letters and numbers."
        error={errors.password}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
          />
        )}
      </Field>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Set new password
      </Button>

      <p className="text-sm text-slate-600">
        Need a new code?{' '}
        <Link
          href={`/forgot-password?email=${encodeURIComponent(email)}` as Route}
          className={authLinkClasses}
        >
          Send another
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({
  action,
  ...fields
}: ResetPasswordFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <ResetPasswordFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
