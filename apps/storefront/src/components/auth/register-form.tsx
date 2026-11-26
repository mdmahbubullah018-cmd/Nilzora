'use client';

import { Alert, buttonClasses, Button, Field, Input } from '@nilzora/ui';
import Link from 'next/link';
import type { Route } from 'next';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from './form-kit';

interface RegisterFormFields {
  csrf: CsrfField;
}

export type RegisterFormViewProps = RegisterFormFields & FormStatusProps;

/**
 * Customer registration. It collects only name, email, phone and password: there is
 * no role or permission input, and the server ignores any such field if one is posted.
 */
export function RegisterFormView({ csrf, state, formAction, pending }: RegisterFormViewProps) {
  if (state.status === 'success') {
    // The same message whether or not the address already has an account.
    return (
      <div className="grid gap-5">
        <Alert tone="success" title="Check your inbox">
          {state.message}
        </Alert>
        <Link
          href={`/verify-otp?email=${encodeURIComponent(state.values?.email ?? '')}` as Route}
          className={buttonClasses({ size: 'lg', className: 'w-full' })}
        >
          Enter my code
        </Link>
      </div>
    );
  }

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />

      <Field id="register-full-name" label="Full name" error={errors.fullName}>
        {(control) => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            maxLength={120}
            defaultValue={values.fullName}
          />
        )}
      </Field>
      <Field id="register-email" label="Email address" error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={values.email}
          />
        )}
      </Field>
      <Field
        id="register-phone"
        label="Mobile phone"
        hint="Optional. e.g. 01712-345678"
        error={errors.phone}
      >
        {(control) => (
          <Input
            {...control}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            defaultValue={values.phone}
          />
        )}
      </Field>
      <Field
        id="register-password"
        label="Password"
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
        Create account
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        By creating an account you agree to the{' '}
        <Link href="/terms" className="font-medium text-link underline-offset-4 hover:underline">
          Terms of service
        </Link>{' '}
        and confirm you have read the{' '}
        <Link href="/privacy" className="font-medium text-link underline-offset-4 hover:underline">
          Privacy policy
        </Link>
        .
      </p>
    </form>
  );
}

export function RegisterForm({ action, ...fields }: RegisterFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <RegisterFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
