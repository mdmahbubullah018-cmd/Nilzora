'use client';

import type { StaffInvitationPreview } from '@nilzora/contracts';
import { Alert, Button, buttonClasses, Field, Input } from '@nilzora/ui';
import type { FormState } from '@nilzora/web-session';
import Link from 'next/link';
import { useActionState } from 'react';
import { AutoText } from '@/components/i18n/translate';
import { acceptStaffInvitationAction } from '@/lib/invite-actions';
import { roleLabel } from '@/lib/identity';
import { useTx } from '@/lib/i18n/provider';
import { PASSWORD_RULES } from './accept-invite-form';

const INITIAL_STATE: FormState = { status: 'idle' };

/**
 * Accepting an invitation: who invited you, the role, and one small form. A new address chooses a
 * password; an address that already has an account enters that account's own password. The
 * invitation's token travels only in a hidden field and the role is never a field.
 */
export function AcceptStaffInvitationForm({
  token,
  invitation,
}: {
  token: string;
  invitation: StaffInvitationPreview;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(acceptStaffInvitationAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  if (state.status === 'success') {
    return (
      <div className="grid gap-4">
        <Alert tone="success" title={tx('You are all set')}>
          {state.message}
        </Alert>
        <Link href="/login" className={buttonClasses({ size: 'lg', className: 'w-full' })}>
          <AutoText>Sign in</AutoText>
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="accountExists" value={String(invitation.accountExists)} />
      <dl className="grid gap-2 rounded-xl border border-hairline bg-neutral-soft/50 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            <AutoText>Email</AutoText>
          </dt>
          <dd className="font-medium text-foreground">{invitation.email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            <AutoText>Role</AutoText>
          </dt>
          <dd className="font-medium text-foreground">{roleLabel(invitation.role)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            <AutoText>Invited by</AutoText>
          </dt>
          <dd className="font-medium text-foreground">{invitation.inviterName}</dd>
        </div>
      </dl>
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">
          <AutoText value={state.message} />
        </Alert>
      ) : null}
      {invitation.accountExists ? (
        <Field
          id="password"
          label={tx('Your existing password')}
          error={errors.password}
          hint={tx(
            'This address already has a Nilzora account. Enter its password to add the role to it.',
          )}
          required
        >
          {(control) => (
            <Input {...control} name="password" type="password" autoComplete="current-password" />
          )}
        </Field>
      ) : (
        <>
          <Field
            id="fullName"
            label={tx('Your name')}
            hint={tx('Optional')}
            error={errors.fullName}
          >
            {(control) => (
              <Input
                {...control}
                name="fullName"
                autoComplete="name"
                defaultValue={invitation.fullName ?? ''}
                maxLength={120}
              />
            )}
          </Field>
          <Field
            id="password"
            label={tx('Choose a password')}
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
          <Field
            id="confirmPassword"
            label={tx('Confirm password')}
            error={errors.confirmPassword}
            required
          >
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
        </>
      )}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        <AutoText>Accept invitation</AutoText>
      </Button>
    </form>
  );
}
