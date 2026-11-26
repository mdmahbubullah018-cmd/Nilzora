'use client';

import { Button, Field, Input } from '@nilzora/ui';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { authLinkClasses } from './auth-card';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from './form-kit';

interface VerifyOtpFormFields {
  csrf: CsrfField;
  /** The address being verified, already validated by the page. */
  email: string;
  /** Where to go after the code is accepted. */
  next: string;
  /** A second action that emails a fresh code to the same address. */
  resendAction: FormAction;
}

export type VerifyOtpFormViewProps = VerifyOtpFormFields & FormStatusProps;

/**
 * The six-digit code that completes registration. Verifying the address is what makes
 * the account usable, so a correct code signs the visitor in.
 */
export function VerifyOtpFormView({
  csrf,
  email,
  next,
  resendAction,
  state,
  formAction,
  pending,
}: VerifyOtpFormViewProps) {
  const errors = state.fieldErrors ?? {};
  const [resendState, resendFormAction, resendPending] = useActionState(resendAction, IDLE_STATE);
  const remaining = useResendCooldown();
  const waiting = remaining.seconds === null || remaining.seconds > 0;

  return (
    <div className="grid gap-5">
      <form action={formAction} className="grid gap-5">
        <FormMessage state={state} />
        <CsrfInput csrf={csrf} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />

        <p className="text-sm text-slate-600">
          We sent a six-digit code to <span className="font-medium text-navy">{email}</span>. It
          expires in 10 minutes.
        </p>

        <Field id="verify-otp-code" label="Verification code" error={errors.code} required>
          {(control) => (
            <Input
              {...control}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              autoFocus
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={pending} className="w-full">
          Verify and continue
        </Button>
      </form>

      <form
        action={(formData: FormData) => {
          remaining.restart();
          resendFormAction(formData);
        }}
        className="grid gap-3"
      >
        <CsrfInput csrf={csrf} />
        <input type="hidden" name="email" value={email} />
        <FormMessage state={resendState} />
        <Button
          type="submit"
          variant="secondary"
          loading={resendPending}
          disabled={waiting}
          className="w-full"
        >
          {remaining.seconds !== null && remaining.seconds > 0
            ? `Send a new code in ${String(remaining.seconds)}s`
            : 'Send a new code'}
        </Button>
      </form>

      <p className="text-sm text-slate-600">
        Wrong address?{' '}
        <Link href="/register" className={authLinkClasses}>
          Start again
        </Link>{' '}
        or{' '}
        <Link href="/login" className={authLinkClasses}>
          sign in
        </Link>
        .
      </p>
    </div>
  );
}

/** The server sends at most one code a minute per address; the button waits as long. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Seconds until "Send a new code" may be pressed: counting from when the page opened (a code
 * was just sent) and again after each resend. `null` until the page is hydrated, so the server
 * render and the first client render agree; the button stays disabled meanwhile.
 */
function useResendCooldown(): { seconds: number | null; restart: () => void } {
  const [deadline, setDeadline] = useState(() => Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return {
    seconds: now === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000)),
    restart: () => {
      const start = Date.now();
      setDeadline(start + RESEND_COOLDOWN_SECONDS * 1000);
      setNow(start);
    },
  };
}

export function VerifyOtpForm({
  action,
  resendAction,
  ...fields
}: VerifyOtpFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <VerifyOtpFormView
      {...fields}
      resendAction={resendAction}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}
