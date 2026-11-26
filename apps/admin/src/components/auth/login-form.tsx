'use client';

import { Alert, Button, Field, Input } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { signInAction } from '@/lib/actions';
import { SIGN_IN_RATE_LIMITED } from '@/lib/auth-messages';
import { CsrfField, type CsrfInput } from './csrf-field';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const INITIAL_STATE: FormState = { status: 'idle' };

/**
 * The email remembered on this device when the visitor asks for it. Only the address,
 * never a password or token, and only in this browser's storage.
 */
export const REMEMBERED_EMAIL_KEY = 'nza_login_email';

function readRememberedEmail(): string {
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeRememberedEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Storage may be refused (private windows); remembering is only a convenience.
  }
}

export interface LoginFormProps {
  csrf: CsrfInput;
  /** Already sanitised by the page; the action sanitises it again. Empty for none. */
  next: string;
}

export function LoginForm({ csrf, next }: LoginFormProps) {
  const tx = useTx();
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};
  const [showPassword, setShowPassword] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const remember = useRef<HTMLInputElement>(null);

  // Offer the remembered address once, without overriding anything already typed. The
  // fields stay uncontrolled, so this only fills the page in; nothing re-renders.
  useEffect(() => {
    const saved = readRememberedEmail();
    if (!saved) return;
    if (remember.current) remember.current.checked = true;
    if (email.current && email.current.value === '') {
      email.current.value = saved;
      password.current?.focus();
    }
  }, []);

  const rateLimited = state.status === 'error' && state.message === SIGN_IN_RATE_LIMITED;

  return (
    <form
      action={formAction}
      onSubmit={() =>
        writeRememberedEmail(
          remember.current?.checked === true ? (email.current?.value.trim() ?? '') : null,
        )
      }
      className="grid gap-5"
    >
      <CsrfField csrf={csrf} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {rateLimited ? (
        <Alert tone="warning" title={tx("Too many sign-in attempts")}><AutoText>To keep accounts safe, signing in is paused for a few minutes. Wait, then try again.</AutoText></Alert>
      ) : state.status === 'error' && state.message ? (
        <Alert tone="danger"><AutoText value={state.message} /></Alert>
      ) : null}

      <Field id="email" label={tx("Email address")} error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            ref={email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.email}
            className="h-11 rounded-xl"
          />
        )}
      </Field>

      <Field id="password" label={tx("Password")} error={errors.password} required>
        {(control) => (
          <div className="relative">
            <Input
              {...control}
              ref={password}
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="h-11 rounded-xl pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={tx("Show password")}
              aria-pressed={showPassword}
              aria-controls={control.id}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="size-4.5" />
              ) : (
                <Eye aria-hidden="true" className="size-4.5" />
              )}
            </button>
          </div>
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-body select-none">
          <input
            ref={remember}
            type="checkbox"
            className="size-4 rounded border-input-border accent-primary-action"
          /><AutoText>Remember my email on this device</AutoText></label>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          <AutoText>Forgot your password?</AutoText>
        </Link>
      </div>

      <Button type="submit" size="lg" loading={pending} className="w-full rounded-xl">
        {tx(pending ? 'Signing in…' : 'Sign in')}
      </Button>
    </form>
  );
}
