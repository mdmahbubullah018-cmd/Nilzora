'use server';

import {
  assignRoleRequestSchema,
  permissionOverrideRequestSchema,
  staffInvitationRequestSchema,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { uuidParam } from '@/components/customers/customer-query';
import { withNotice } from '@/components/orders/order-query';
import type { StaffNotice } from '@/components/staff/staff-rules';
import { roleLabel } from './identity';

/*
 * Staff invitations, role changes and permission overrides. Who may do what is
 * decided by the API and the database; these actions shape requests and map refusals.
 */

const STAFF_PATH: Route = '/admin/staff';
const REMOVED: StaffNotice = 'removed';
const RESENT: StaffNotice = 'invitation_resent';

const MISSING_ACCOUNT: ActionState = {
  status: 'error',
  message: 'This account could not be identified. Reload the page and try again.',
};

function memberPath(userId: string): Route {
  return `/admin/staff/${userId}` as Route;
}

/** Emails a one-time link to /accept-invite, where the invitee chooses a password. */
export async function inviteStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    email: formText(formData, 'email').trim(),
    fullName: formText(formData, 'fullName').trim(),
    role: formText(formData, 'role'),
  };
  const parsed = staffInvitationRequestSchema.safeParse({
    email: values.email,
    role: values.role,
    fullName: values.fullName || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'email') fieldErrors.email = 'Enter a valid email address.';
      if (field === 'role') fieldErrors.role = 'Choose a role.';
      if (field === 'fullName') fieldErrors.fullName = 'Keep the name to 120 characters or fewer.';
    }
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminInviteStaff(token, parsed.data),
    {
      returnTo: STAFF_PATH,
      label: 'staff invitation',
      messages: {
        forbidden: 'Your account cannot invite someone with this role.',
        // The API answers both a pending duplicate and an address that already holds a role.
        invitation_accepted:
          'This person already has a team account, or an invitation for this role is already waiting. Resend or revoke it from the invitations list.',
        account_exists:
          'An account already uses this email address. Change its role from the team list instead.',
        auth_unavailable:
          'The invitation email could not be sent right now. Try again in a moment.',
        validation_failed: 'Check the email address, name and role, then try again.',
      },
    },
  );
  if (!result.ok) {
    const exists = result.code === 'account_exists';
    return {
      ...result.state,
      values,
      ...(exists ? { fieldErrors: { email: 'This address already has an account.' } } : {}),
    };
  }

  revalidatePath(STAFF_PATH);
  const { invitation, emailSent } = result.value;
  if (!emailSent) {
    // Saved, but the mail server refused: it stays pending and can be sent again from the list.
    return {
      status: 'error',
      message: `The invitation for ${invitation.email} was saved, but the email could not be sent right now. Use Resend in the invitations list to try again.`,
    };
  }
  return {
    status: 'success',
    message: `Invitation sent to ${invitation.email} as ${roleLabel(invitation.role)}. No account or role is created until they accept it from the link in the email.`,
  };
}

/** Changes a team member's role (owners manage admins; nobody changes their own). */
export async function changeRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = uuidParam(formText(formData, 'userId'));
  if (!userId) return MISSING_ACCOUNT;
  const parsed = assignRoleRequestSchema.safeParse({ role: formText(formData, 'role') });
  if (!parsed.success) return invalid('Choose a role.', { role: 'Choose a role.' });

  const result = await adminAct(
    formData,
    (api, token) => api.assignRole(token, userId, parsed.data),
    {
      returnTo: memberPath(userId),
      label: 'role change',
      messages: {
        // The API answers every hierarchy refusal as `forbidden`.
        forbidden:
          'This role change is not allowed: nobody changes their own role, only an owner manages admins, and the last owner stays an owner.',
        not_found: 'This account no longer exists.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(STAFF_PATH);
  revalidatePath(memberPath(userId));
  // A customer leaves the team, and with it this member's page.
  if (result.value.role === 'customer') redirect(withNotice(STAFF_PATH, REMOVED));
  return { status: 'success', message: `The role is now ${roleLabel(result.value.role)}.` };
}

/**
 * Emails a pending invitee a new one-time link (staff.invite). The earlier link stops
 * working; an accepted invitation answers 409.
 */
export async function resendInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = uuidParam(formText(formData, 'userId'));
  if (!userId) return MISSING_ACCOUNT;

  const result = await adminAct(
    formData,
    (api, token) => api.resendStaffInvitation(token, userId),
    {
      returnTo: memberPath(userId),
      label: 'invitation resend',
      messages: {
        invitation_accepted:
          'This invitation was already accepted: they can sign in with their own password.',
        not_found: 'There is no pending invitation for this account.',
        forbidden: 'Re-sending invitations needs the “Invite staff” permission.',
        rate_limited:
          'Too many invitations were sent just now. Wait a few minutes before sending another.',
        auth_unavailable:
          'The invitation email could not be sent right now. Try again in a moment.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(STAFF_PATH);
  revalidatePath(memberPath(userId));
  redirect(withNotice(memberPath(userId), RESENT));
}

/** Sends an invitation again with a fresh link (the earlier link stops working). */
export async function resendStaffInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const invitationId = uuidParam(formText(formData, 'invitationId'));
  if (!invitationId) return MISSING_ACCOUNT;

  const result = await adminAct(
    formData,
    (api, token) => api.adminResendStaffInvitation(token, invitationId),
    {
      returnTo: STAFF_PATH,
      label: 'invitation resend',
      messages: {
        invitation_invalid: 'This invitation was already accepted or revoked, so it cannot be sent again.',
        not_found: 'This invitation no longer exists.',
        forbidden: 'Only the store owner can send invitations.',
        rate_limited:
          'Too many invitations were sent just now. Wait a few minutes before sending another.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(STAFF_PATH);
  if (!result.value.emailSent) {
    return {
      status: 'error',
      message: 'A new link was created, but the email could not be sent right now. Try again in a moment.',
    };
  }
  return { status: 'success', message: `A new invitation was sent to ${result.value.invitation.email}.` };
}

/** Withdraws a pending invitation: its link stops working at once. */
export async function revokeStaffInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const invitationId = uuidParam(formText(formData, 'invitationId'));
  if (!invitationId) return MISSING_ACCOUNT;

  const result = await adminAct(
    formData,
    (api, token) => api.adminRevokeStaffInvitation(token, invitationId),
    {
      returnTo: STAFF_PATH,
      label: 'invitation revoke',
      messages: {
        invitation_invalid: 'Only a pending invitation can be revoked.',
        not_found: 'This invitation no longer exists.',
        forbidden: 'Only the store owner can revoke invitations.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(STAFF_PATH);
  return { status: 'success', message: 'The invitation was revoked.' };
}

const EFFECT_SUCCESS = {
  grant: 'Granted.',
  deny: 'Denied.',
  default: 'Back to the role default.',
} as const;

/** Grants, denies or clears (role default) one permission for one team member. */
export async function setPermissionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = uuidParam(formText(formData, 'userId'));
  if (!userId) return MISSING_ACCOUNT;
  const effect = formText(formData, 'effect');
  const parsed = permissionOverrideRequestSchema.safeParse({
    permission: formText(formData, 'permission'),
    effect: effect === 'default' ? null : effect,
  });
  if (!parsed.success) return invalid('This change is not available. Reload the page.');

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetPermission(token, userId, parsed.data),
    {
      returnTo: memberPath(userId),
      label: 'permission change',
      messages: {
        forbidden: 'You can only grant or deny permissions you hold yourself.',
        cannot_change_self: 'You cannot change your own permissions.',
        account_not_manageable:
          'Customers hold no permissions, and only an owner changes an admin’s permissions.',
        not_found: 'This account no longer exists.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath(STAFF_PATH);
  revalidatePath(memberPath(userId));
  return { status: 'success', message: EFFECT_SUCCESS[parsed.data.effect ?? 'default'] };
}
