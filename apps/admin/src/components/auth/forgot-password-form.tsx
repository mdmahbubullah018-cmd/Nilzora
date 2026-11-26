'use client';

import { Alert, Button, Field, Input } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import Link from 'next/link';
import type { Route } from 'next';
import { useActionState } from 'react';
import { forgotPasswordAction } from '@/lib/actions';
import { CsrfField, type CsrfInput } from './csrf-field';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const INITIAL_STATE: FormState = { status: 'idle' };

/** Asks for a reset code. The answer never reveals whether the address has an account. */
export function ForgotPasswordForm({ csrf }: { csrf: CsrfInput }) {
  const tx = useTx();
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  if (state.status === 'success') {
    const address = state.values?.email ?? '';
    return (
      <div className="grid gap-4">
        <Alert tone="success"><AutoText value={state.message} /></Alert>
        <Link
          href={`/reset-password?email=${encodeURIComponent(address)}` as Route}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        ><AutoText>I have the code</AutoText></Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-5">
      <CsrfField csrf={csrf} />
      {state.status === 'error' && state.message ? (
        <Alert tone="danger"><AutoText value={state.message} /></Alert>
      ) : null}

      <Field id="forgot-email" label={tx("Email address")} error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.email}
          />
        )}
      </Field>

      <Button type="submit" size="lg" loading={pending} className="w-full"><AutoText>Email me a code</AutoText></Button>
    </form>
  );
}
