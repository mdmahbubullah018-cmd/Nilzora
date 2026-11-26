'use client';

import { Button, Field, Input } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { useActionState } from 'react';
import { resetPasswordAction } from '@/lib/actions';
import { CsrfField, type CsrfInput } from './csrf-field';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const INITIAL_STATE: FormState = { status: 'idle' };

export interface ResetPasswordFormProps {
  csrf: CsrfInput;
  /** The address the code was sent to, already validated by the page. */
  email: string;
}

/**
 * Sets a new password from a reset code. Every session for the account ends, so a
 * successful reset returns the visitor to sign in with the new password.
 */
export function ResetPasswordForm({ csrf, email }: ResetPasswordFormProps) {
  const tx = useTx();
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-5">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="email" value={email} />
      {state.status === 'error' && state.message ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Enter the six-digit code we sent to <span className="font-medium"><AutoText value={email} /></span>.
      </p>

      <Field id="reset-code" label={tx("Reset code")} error={errors.code} required>
        {(control) => (
          <Input
            {...control}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
          />
        )}
      </Field>

      <Field
        id="reset-password"
        label={tx("New password")}
        hint={tx("At least 8 characters, with letters and numbers.")}
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

      <Button type="submit" size="lg" loading={pending} className="w-full"><AutoText>Set new password</AutoText></Button>
    </form>
  );
}
