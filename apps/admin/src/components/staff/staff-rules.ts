import {
  APP_ROLES,
  type AppRole,
  type InvitableRole,
  type Permission,
  type PermissionEffect,
  type StaffMember,
} from '@nilzora/contracts';
import type { SessionUser } from '@nilzora/web-session';

/*
 * What the staff screens offer, mirroring the database's rules (assign_user_role,
 * admin_set_permission) and the API's invitation rule. Display only: the API and the
 * database decide every change again, so a stale or edited page can never widen access.
 */

export type Actor = Pick<SessionUser, 'id' | 'role' | 'permissions'>;

export const STAFF_PATH = '/admin/staff' as const;

/** Roles each role may invite (the API's rule): nobody invites owners. */
const INVITABLE_BY: Partial<Record<AppRole, readonly InvitableRole[]>> = {
  // Only the owner creates system users; the API and assign_user_role enforce it again.
  super_admin: ['admin', 'staff', 'moderator'],
};

export function invitableRoles(actor: Actor): readonly InvitableRole[] {
  if (!actor.permissions.includes('staff.invite')) return [];
  return INVITABLE_BY[actor.role] ?? [];
}

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  super_admin: 'Full control of the store, including settings and admins.',
  admin: 'Runs the store day to day. Only the owner adds team members or changes roles.',
  staff: 'Handles products and orders.',
  moderator: 'Reviews product content in the moderator workspace.',
  customer: 'No workspace access: removes the account from the team.',
};

export type Lock = { locked: false } | { locked: true; reason: string };

const OPEN: Lock = { locked: false };

function isPrivileged(role: AppRole): boolean {
  return role === 'super_admin' || role === 'admin';
}

/** Whether the actor may change this member's role, and to which roles. */
export function roleChange(
  actor: Actor,
  member: Pick<StaffMember, 'id' | 'role'>,
): Lock & { roles: AppRole[] } {
  const none = (reason: string) => ({ locked: true as const, reason, roles: [] });
  if (!actor.permissions.includes('staff.roles.assign')) {
    return none('Changing roles needs the “Assign staff roles” permission.');
  }
  if (actor.id === member.id) return none('You cannot change your own role.');
  if (actor.role !== 'super_admin') return none('Only the owner assigns roles.');
  // The owner role is never handed out from the admin interface.
  return {
    locked: false,
    roles: APP_ROLES.filter((role) => role !== member.role && role !== 'super_admin'),
  };
}

/** Whether the actor may change this member's permission overrides at all. */
export function permissionLock(actor: Actor, member: Pick<StaffMember, 'id' | 'role'>): Lock {
  if (!actor.permissions.includes('staff.permissions.manage')) {
    return {
      locked: true,
      reason: 'Changing permissions needs the “Manage staff permissions” permission.',
    };
  }
  if (actor.id === member.id) {
    return { locked: true, reason: 'You cannot change your own permissions.' };
  }
  if (isPrivileged(member.role) && actor.role !== 'super_admin') {
    return { locked: true, reason: 'Only an owner changes an owner’s or admin’s permissions.' };
  }
  return OPEN;
}

/** One permission: nobody grants or denies what they do not hold themselves. */
export function permissionCellLock(actor: Actor, permission: Permission): Lock {
  return actor.permissions.includes(permission)
    ? OPEN
    : { locked: true, reason: 'You can only grant or deny permissions you hold yourself.' };
}

export function overrideOf(
  member: Pick<StaffMember, 'overrides'>,
  permission: Permission,
): PermissionEffect | undefined {
  return member.overrides.find((override) => override.permission === permission)?.effect;
}

export function overrideCounts(member: Pick<StaffMember, 'overrides'>): {
  grants: number;
  denials: number;
} {
  return {
    grants: member.overrides.filter((override) => override.effect === 'grant').length,
    denials: member.overrides.filter((override) => override.effect === 'deny').length,
  };
}

/** The permission areas of the matrix, in display order. */
export const PERMISSION_AREAS = [
  'Workspaces',
  'Communication',
  'Catalog',
  'Orders and payments',
  'Shipping',
  'Customers',
  'Content and reviews',
  'Promotions',
  'Finance',
  'Team',
  'Store',
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

/** A Record over every permission, so a new permission fails typecheck until placed. */
const PERMISSION_AREA: Record<Permission, PermissionArea> = {
  'admin_workspace.access': 'Workspaces',
  'moderator_workspace.access': 'Workspaces',
  'chat.templates.manage': 'Communication',
  'chat.automation.manage': 'Communication',
  'chat.analytics.read': 'Communication',
  'notifications.broadcast': 'Communication',
  'chat.reports.review': 'Communication',
  'chat.internal.use': 'Communication',
  'products.read': 'Catalog',
  'products.create': 'Catalog',
  'products.update': 'Catalog',
  'products.publish': 'Catalog',
  'inventory.adjust': 'Catalog',
  'zones.manage': 'Catalog',
  'orders.read': 'Orders and payments',
  'checkouts.recover': 'Orders and payments',
  'orders.update_status': 'Orders and payments',
  'orders.cancel': 'Orders and payments',
  'payments.collect': 'Orders and payments',
  'couriers.read': 'Shipping',
  'couriers.configure': 'Shipping',
  'couriers.pricing.manage': 'Shipping',
  'shipments.read': 'Shipping',
  'shipments.create': 'Shipping',
  'shipments.cancel': 'Shipping',
  'shipments.track': 'Shipping',
  'shipments.returns.manage': 'Shipping',
  'couriers.cod.read': 'Shipping',
  'couriers.cod.reconcile': 'Shipping',
  'customers.read': 'Customers',
  'customers.update': 'Customers',
  'content.approve': 'Content and reviews',
  'moderation.assign': 'Content and reviews',
  'reviews.moderate': 'Content and reviews',
  'reviews.view': 'Content and reviews',
  'reviews.reply': 'Content and reviews',
  'coupons.create': 'Promotions',
  'coupons.update': 'Promotions',
  'discounts.view': 'Promotions',
  'discounts.create': 'Promotions',
  'discounts.edit': 'Promotions',
  'discounts.schedule': 'Promotions',
  'discounts.activate': 'Promotions',
  'discounts.pause': 'Promotions',
  'discounts.end': 'Promotions',
  'discounts.archive': 'Promotions',
  'discounts.manage_priority': 'Promotions',
  'discounts.manage_coupon_policy': 'Promotions',
  'finance.read': 'Finance',
  'refunds.request': 'Finance',
  'refunds.approve': 'Finance',
  'staff.invite': 'Team',
  'staff.roles.assign': 'Team',
  'staff.permissions.manage': 'Team',
  'settings.manage': 'Store',
  'image_search.manage': 'Store',
  'audit_logs.read': 'Store',
};

/** Permissions grouped by area, keeping the given order within each area. */
export function groupPermissions<T extends { name: Permission }>(
  permissions: readonly T[],
): { area: PermissionArea; permissions: T[] }[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    permissions: permissions.filter((permission) => PERMISSION_AREA[permission.name] === area),
  })).filter((group) => group.permissions.length > 0);
}

export function memberName(member: Pick<StaffMember, 'fullName' | 'email'>): string {
  return member.fullName?.trim() || member.email;
}

/** Who may open the staff screens (the API's rule for GET /admin/staff). */
export function canManageTeam(actor: Pick<Actor, 'permissions'>): boolean {
  return (
    actor.permissions.includes('staff.roles.assign') ||
    actor.permissions.includes('staff.permissions.manage')
  );
}

/** Notices of the staff pages after a change whose form disappears (see withNotice). */
export const STAFF_NOTICES = {
  removed: 'The account is now a customer account and has left the team.',
  invitation_resent: 'A new invitation email is on its way. The earlier link no longer works.',
} as const satisfies Record<string, string>;
export type StaffNotice = keyof typeof STAFF_NOTICES;

/** Whether the actor is offered "Resend invitation" (the API decides again). */
export function canResendInvitation(
  actor: Pick<Actor, 'id' | 'permissions'>,
  member: Pick<StaffMember, 'id' | 'invitationPending'>,
): boolean {
  return (
    member.invitationPending && member.id !== actor.id && actor.permissions.includes('staff.invite')
  );
}
