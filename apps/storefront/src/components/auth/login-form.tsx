'use client';

import { Alert, Button, Field, Input } from '@nilzora/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import type { LoginNotice } from '@/lib/auth-params';
import { authLinkClasses } from './auth-card';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from './form-kit';

interface LoginFormFields {
  csrf: CsrfField;
  /** Already validated by the page; the action validates it again. */
  next: string;
  /** Fixed message chosen by the page, e.g. after signing out. */
  notice?: LoginNotice;
}

export type LoginFormViewProps = LoginFormFields & FormStatusProps;

export function LoginFormView({
  csrf,
  next,
  notice,
  state,
  formAction,
  pending,
}: LoginFormViewProps) {
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid gap-5">
      {state.message ? (
        <FormMessage state={state} />
      ) : notice ? (
        <Alert tone={notice.tone}>{notice.message}</Alert>
      ) : null}
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="next" value={next} />

      <Field id="login-email" label="Email address" error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={state.values?.email}
          />
        )}
      </Field>
      {/* The password is never echoed back, so it is empty after a failed attempt. */}
      <Field id="login-password" label="Password" error={errors.password} required>
        {(control) => (
          <Input {...control} name="password" type="password" autoComplete="current-password" />
        )}
      </Field>

      <Link href="/forgot-password" className={`${authLinkClasses} justify-self-start text-sm`}>
        Forgot your password?
      </Link>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}

export function LoginForm({ action, ...fields }: LoginFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <LoginFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
