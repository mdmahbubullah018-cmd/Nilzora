'use client';

import type { AppRole, InvitableRole, Permission, PermissionEffect } from '@nilzora/contracts';
import { Button, cn, Field, Input, NativeSelect } from '@nilzora/ui';
import { Check, MailPlus, Minus, Send, UserCog, X } from 'lucide-react';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { roleLabel } from '@/lib/identity';
import {
  changeRoleAction,
  inviteStaffAction,
  resendInvitationAction,
  resendStaffInvitationAction,
  revokeStaffInvitationAction,
  setPermissionAction,
} from '@/lib/staff-actions';
import { ROLE_DESCRIPTION } from './staff-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="max-sm:min-h-11">
      {pending ? null : <Send aria-hidden="true" strokeWidth={1.75} />}
      {children}
    </Button>
  );
}

/** Invites a new team member by email, with only the roles this account may grant. */
export function InviteForm({ roles, csrf }: { roles: readonly InvitableRole[]; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(inviteStaffAction, IDLE_STATE);
  const errors = state.fieldErrors ?? {};
  const form = useRef<HTMLFormElement>(null);

  // A sent invitation clears the form for the next one.
  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <ActionFeedback state={state} />
      <Field id="invite-email" label={tx("Email address")} error={errors.email} required>
        {(control) => (
          <Input
            {...control}
            className="max-sm:h-11"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            defaultValue={state.status === 'success' ? '' : state.values?.email}
          />
        )}
      </Field>
      <Field id="invite-name" label={tx("Full name")} hint={tx("Optional")} error={errors.fullName}>
        {(control) => (
          <Input
            {...control}
            className="max-sm:h-11"
            name="fullName"
            autoComplete="off"
            maxLength={120}
            defaultValue={state.status === 'success' ? '' : state.values?.fullName}
          />
        )}
      </Field>
      <Field
        id="invite-role"
        label={tx("Role")}
        hint={tx("You can adjust their permissions after they join.")}
        error={errors.role}
        required
      >
        {(control) => (
          <NativeSelect
            {...control}
            className="max-sm:h-11"
            name="role"
            defaultValue={state.values?.role ?? roles.at(-1) ?? ''}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}: {ROLE_DESCRIPTION[role]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <div>
        <SubmitButton><AutoText>Send invitation</AutoText></SubmitButton>
      </div>
    </form>
  );
}

export interface RoleChangeProps {
  userId: string;
  name: string;
  currentRole: AppRole;
  roles: readonly AppRole[];
  csrf: CsrfInput;
}

/** Changes a member's role after a confirmation that names the consequence. */
export function RoleChange({ userId, name, currentRole, roles, csrf }: RoleChangeProps) {
  const tx = useTx();
  const [state, action] = useActionState(changeRoleAction, IDLE_STATE);
  return (
    <div className="grid gap-3">
      <ConfirmForm
        // Remounts closed once the role has changed.
        key={currentRole}
        action={action}
        csrf={csrf}
        align="start"
        trigger={
          <>
            <UserCog aria-hidden="true" strokeWidth={1.75} />
            Change role
          </>
        }
        tone="primary"
        title={`Change ${name}’s role?`}
        description={`They are ${roleLabel(currentRole)} now. The new role’s default permissions apply at once; their overrides are kept unless they become a customer.`}
        confirmLabel={tx("Change role")}
        hiddenFields={{ userId }}
        error={state.status === 'error' ? state.message : undefined}
      >
        <Field id={`role-${userId}`} label={tx("New role")} required>
          {(control) => (
            <NativeSelect {...control} name="role" defaultValue={roles[0]}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role === 'customer' ? 'Customer (remove from the team)' : roleLabel(role)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </ConfirmForm>
      <ActionFeedback state={state} successOnly />
    </div>
  );
}

const choices = [
  { value: 'default', label: 'Default', icon: Minus },
  { value: 'grant', label: 'Grant', icon: Check },
  { value: 'deny', label: 'Deny', icon: X },
] as const;

const choiceTone = {
  default: 'bg-surface text-foreground ring-hairline',
  grant: 'bg-success-soft text-success-ink ring-success-line',
  deny: 'bg-danger-soft text-danger-ink ring-danger-line',
} as const;

export interface PermissionOverrideFormProps {
  userId: string;
  permission: Permission;
  label: string;
  override: PermissionEffect | undefined;
  csrf: CsrfInput;
}

/**
 * Role default, grant or deny for one permission: one submit button per choice (works
 * without JavaScript); the choice in effect is marked as pressed.
 */
export function PermissionOverrideForm({
  userId,
  permission,
  label,
  override,
  csrf,
}: PermissionOverrideFormProps) {
  const [state, action, pending] = useActionState(setPermissionAction, IDLE_STATE);
  const current = override ?? 'default';
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="permission" value={permission} />
      <div
        role="group"
        aria-label={`${label}: override`}
        className="inline-flex rounded-xl bg-neutral-soft p-0.5 ring-1 ring-hairline"
      >
        {choices.map((choice) => {
          const active = current === choice.value;
          const Icon = choice.icon;
          return (
            <button
              key={choice.value}
              type="submit"
              name="effect"
              value={choice.value}
              aria-pressed={active}
              disabled={pending}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 max-sm:h-11 max-sm:px-3',
                active
                  ? cn('shadow-xs ring-1', choiceTone[choice.value])
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              {choice.label}
            </button>
          );
        })}
      </div>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** Sends a pending invitee a new link; success returns to the page with a notice. */
export function ResendInvitationForm({
  userId,
  email,
  csrf,
}: {
  userId: string;
  email: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(resendInvitationAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      trigger={
        <>
          <MailPlus aria-hidden="true" strokeWidth={1.75} />
          Resend invitation
        </>
      }
      tone="primary"
      title={`Send a new invitation to ${email}?`}
      description={tx("They get a new one-time link to choose a password. The link in the earlier email stops working.")}
      confirmLabel={tx("Send new invitation")}
      hiddenFields={{ userId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}

/** Sends an invitation again from the invitations list: a fresh link and a fresh expiry. */
export function ResendInvitationByIdForm({
  invitationId,
  email,
  csrf,
}: {
  invitationId: string;
  email: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(resendStaffInvitationAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      trigger={
        <>
          <MailPlus aria-hidden="true" strokeWidth={1.75} />
          <AutoText>Resend</AutoText>
        </>
      }
      tone="primary"
      title={`Send a new invitation to ${email}?`}
      description={tx(
        'They get a new one-time link and a new expiry. The link in the earlier email stops working.',
      )}
      confirmLabel={tx('Send new invitation')}
      hiddenFields={{ invitationId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}

/** Withdraws a pending invitation. */
export function RevokeInvitationForm({
  invitationId,
  email,
  csrf,
}: {
  invitationId: string;
  email: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(revokeStaffInvitationAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      trigger={
        <>
          <X aria-hidden="true" strokeWidth={1.75} />
          <AutoText>Revoke</AutoText>
        </>
      }
      triggerVariant="ghost"
      tone="danger"
      title={`Revoke the invitation to ${email}?`}
      description={tx('The link stops working at once. You can invite them again later.')}
      confirmLabel={tx('Revoke invitation')}
      hiddenFields={{ invitationId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}
