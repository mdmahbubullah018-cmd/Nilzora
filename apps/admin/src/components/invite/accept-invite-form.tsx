'use client';

import { Alert, Button, buttonClasses, Field, Input } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import Link from 'next/link';
import { useActionState } from 'react';
import { acceptInvitationAction } from '@/lib/invite-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const INITIAL_STATE: FormState = { status: 'idle' };

export const PASSWORD_RULES = [
  'At least 8 characters',
  'Both letters and numbers',
  'At most 72 bytes (about 72 plain letters)',
] as const;

/**
 * Chooses the invitee's password. The token travels only in this hidden field and is
 * never displayed; after success the form is gone and only the sign-in link remains.
 */
export function AcceptInviteForm({ tokenHash }: { tokenHash: string }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(acceptInvitationAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  if (state.status === 'success') {
    return (
      <div className="grid gap-4">
        <Alert tone="success" title={tx("You are all set")}>
          {state.message}
        </Alert>
        <Link href="/login" className={buttonClasses({ size: 'lg', className: 'w-full' })}><AutoText>Sign in</AutoText></Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="tokenHash" value={tokenHash} />
      {state.status === 'error' && state.message ? (
        <Alert tone="danger"><AutoText value={state.message} /></Alert>
      ) : null}
      <Field
        id="password"
        label={tx("New password")}
        error={errors.password}
        hint={
          <span className="grid gap-0.5">
            {PASSWORD_RULES.map((rule) => (
              <span key={rule}>• {rule}</span>
            ))}
          </span>
        }
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
      <Field id="confirmPassword" label={tx("Confirm password")} error={errors.confirmPassword} required>
        {(control) => (
          <Input
            {...control}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="w-full"><AutoText>Set password and join</AutoText></Button>
    </form>
  );
}
