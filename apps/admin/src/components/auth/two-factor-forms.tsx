'use client';

import { Alert, Button, buttonClasses, Field, Input } from '@nilzora/ui';
import type { Route } from 'next';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { Check, Copy, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  activateTwoFactorAction,
  enrollTwoFactorAction,
  recoverTwoFactorAction,
  replaceRecoveryCodesAction,
  resetTwoFactorAction,
  verifyTwoFactorAction,
} from '@/lib/two-factor-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { CsrfField, type CsrfInput } from './csrf-field';

const IDLE: FormState = { status: 'idle' };

function ErrorAlert({ state }: { state: FormState }) {
  if (state.status !== 'error' || !state.message) return null;
  return (
    <Alert tone="danger">
      <AutoText value={state.message} />
    </Alert>
  );
}

/** A six-digit code field tuned for authenticator apps and phone keyboards. */
function CodeField({
  error,
  autoFocus = true,
}: {
  error?: string | undefined;
  autoFocus?: boolean;
}) {
  const tx = useTx();
  return (
    <Field id="code" label={tx('6-digit code')} error={error} required>
      {(control) => (
        <Input
          {...control}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus={autoFocus}
          placeholder="123 456"
          className="h-12 rounded-xl text-center font-mono text-xl tracking-[0.35em]"
        />
      )}
    </Field>
  );
}

function StepBadge({ step, of }: { step: number; of: number }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <AutoText>{`Step ${String(step)} of ${String(of)}`}</AutoText>
    </p>
  );
}

/** The ten recovery codes, once, with copy and download. The owner must confirm saving them. */
export function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref?: string }) {
  const tx = useTx();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const blob = new Blob(
      [
        `Nilzora recovery codes\nEach code works once. Keep them somewhere safe and private.\n\n${text}\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nilzora-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-5">
      <Alert tone="warning" title={tx('Save these recovery codes now')}>
        <AutoText>
          They are shown only once. Each code signs you in a single time if you lose your phone.
          Store them in a password manager or print them, and never share them.
        </AutoText>
      </Alert>
      <ol
        aria-label={tx('Recovery codes')}
        className="grid grid-cols-1 gap-2 rounded-xl border bg-soft p-4 font-mono text-sm sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-lg bg-surface px-3 py-2 text-center tracking-wider text-foreground"
          >
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {tx(copied ? 'Copied' : 'Copy codes')}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden="true" />
          {tx('Download')}
        </Button>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-body select-none">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="size-4 rounded border-input-border accent-primary-action"
        />
        <AutoText>I have saved my recovery codes somewhere safe</AutoText>
      </label>
      {continueHref ? (
        saved ? (
          <Link
            href={continueHref as Route}
            className={buttonClasses({ size: 'lg', className: 'w-full rounded-xl' })}
          >
            {tx('Continue to the workspace')}
          </Link>
        ) : (
          <Button type="button" size="lg" disabled className="w-full rounded-xl">
            {tx('Continue to the workspace')}
          </Button>
        )
      ) : null}
    </div>
  );
}

/** First-time setup: password, QR code + first code, then the recovery codes. */
export function TwoFactorSetup({ csrf, next }: { csrf: CsrfInput; next: string }) {
  const tx = useTx();
  const [enrolled, enroll, enrolling] = useActionState(enrollTwoFactorAction, IDLE);
  const [activated, activate, activating] = useActionState(activateTwoFactorAction, IDLE);

  const recoveryCodes =
    activated.status === 'success' ? (activated.values?.recoveryCodes ?? '').split(' ') : null;
  if (recoveryCodes && recoveryCodes.length === 10) {
    return (
      <div className="grid gap-4">
        <StepBadge step={3} of={3} />
        <div className="flex items-center gap-2 text-success">
          <ShieldCheck aria-hidden="true" className="size-5" />
          <p className="font-medium">
            <AutoText>Two-factor authentication is on.</AutoText>
          </p>
        </div>
        <RecoveryCodes codes={recoveryCodes} continueHref={next || '/'} />
      </div>
    );
  }

  const qr = enrolled.status === 'success' ? enrolled.values?.qr : undefined;
  const secret = enrolled.status === 'success' ? enrolled.values?.secret : undefined;
  if (qr && secret) {
    return (
      <form action={activate} className="grid gap-5">
        <CsrfField csrf={csrf} />
        <StepBadge step={2} of={3} />
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          {/* A data URI generated on the server from this enrollment; nothing is fetched. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt={tx('QR code for your authenticator app')}
            width={176}
            height={176}
            className="mx-auto size-44 rounded-xl border bg-white p-2"
          />
          <div className="grid gap-2 text-sm text-body">
            <p>
              <AutoText>
                Scan this code with an authenticator app (Google Authenticator, Microsoft
                Authenticator, 1Password and others), then enter the 6-digit code it shows.
              </AutoText>
            </p>
            <details className="rounded-lg border bg-soft px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                <AutoText>{'Can’t scan? Enter this key instead'}</AutoText>
              </summary>
              <p className="mt-2 font-mono text-sm break-all text-foreground select-all">
                {secret}
              </p>
            </details>
          </div>
        </div>
        <ErrorAlert state={activated} />
        <CodeField error={activated.fieldErrors?.code} />
        <Button type="submit" size="lg" loading={activating} className="w-full rounded-xl">
          {tx(activating ? 'Checking…' : 'Turn on two-factor authentication')}
        </Button>
      </form>
    );
  }

  return (
    <form action={enroll} className="grid gap-5">
      <CsrfField csrf={csrf} />
      <StepBadge step={1} of={3} />
      <div className="flex items-start gap-3 rounded-xl border bg-soft p-4 text-sm text-body">
        <Smartphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-action" />
        <AutoText>
          Owner accounts are protected with a second step at sign-in. You will need an authenticator
          app on your phone. Confirm your password to begin.
        </AutoText>
      </div>
      <ErrorAlert state={enrolled} />
      <Field id="password" label={tx('Password')} error={enrolled.fieldErrors?.password} required>
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="h-11 rounded-xl"
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={enrolling} className="w-full rounded-xl">
        {tx(enrolling ? 'Preparing…' : 'Set up two-factor authentication')}
      </Button>
    </form>
  );
}

/** Every sign-in: a code from the app, or one recovery code. */
export function TwoFactorVerify({ csrf, next }: { csrf: CsrfInput; next: string }) {
  const tx = useTx();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [verified, verify, verifying] = useActionState(verifyTwoFactorAction, IDLE);
  const [recovered, recover, recovering] = useActionState(recoverTwoFactorAction, IDLE);

  if (mode === 'recovery') {
    return (
      <form action={recover} className="grid gap-5">
        <CsrfField csrf={csrf} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <ErrorAlert state={recovered} />
        <Field
          id="recoveryCode"
          label={tx('Recovery code')}
          error={recovered.fieldErrors?.recoveryCode}
          hint={tx('Each recovery code works once.')}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              placeholder="ABCD-EFGH-JKMN"
              className="h-12 rounded-xl text-center font-mono text-lg tracking-widest"
            />
          )}
        </Field>
        <Button type="submit" size="lg" loading={recovering} className="w-full rounded-xl">
          {tx(recovering ? 'Checking…' : 'Use recovery code')}
        </Button>
        <button
          type="button"
          onClick={() => setMode('code')}
          className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          <AutoText>Use my authenticator app instead</AutoText>
        </button>
      </form>
    );
  }

  return (
    <form action={verify} className="grid gap-5">
      <CsrfField csrf={csrf} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <ErrorAlert state={verified} />
      <CodeField error={verified.fieldErrors?.code} />
      <Button type="submit" size="lg" loading={verifying} className="w-full rounded-xl">
        {tx(verifying ? 'Checking…' : 'Verify and continue')}
      </Button>
      <button
        type="button"
        onClick={() => setMode('recovery')}
        className="inline-flex min-h-11 items-center justify-center gap-2 text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        <KeyRound aria-hidden="true" className="size-4" />
        <AutoText>Lost your phone? Use a recovery code</AutoText>
      </button>
    </form>
  );
}

/** Profile: ten new recovery codes (the old ones stop working). */
export function ReplaceRecoveryCodesForm({ csrf }: { csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(replaceRecoveryCodesAction, IDLE);
  const codes = state.status === 'success' ? (state.values?.recoveryCodes ?? '').split(' ') : null;
  if (codes && codes.length === 10) return <RecoveryCodes codes={codes} />;
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <ErrorAlert state={state} />
      <CodeField error={state.fieldErrors?.code} autoFocus={false} />
      <Button type="submit" variant="outline" loading={pending}>
        {tx('Create new recovery codes')}
      </Button>
    </form>
  );
}

/** Profile: remove 2FA (for a new phone); setup starts again immediately. */
export function ResetTwoFactorForm({ csrf }: { csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(resetTwoFactorAction, IDLE);
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <ErrorAlert state={state} />
      <Field
        id="reset-password"
        label={tx('Password')}
        error={state.fieldErrors?.password}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-11 rounded-xl"
          />
        )}
      </Field>
      <Field
        id="reset-code"
        label={tx('Current code or recovery code')}
        error={state.fieldErrors?.code}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="code"
            autoComplete="one-time-code"
            spellCheck={false}
            className="h-11 rounded-xl font-mono"
          />
        )}
      </Field>
      <Button type="submit" variant="danger" loading={pending}>
        {tx('Reset two-factor authentication')}
      </Button>
    </form>
  );
}
