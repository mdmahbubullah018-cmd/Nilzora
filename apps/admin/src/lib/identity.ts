import type { AppRole, Permission } from '@nilzora/contracts';
import type { SessionUser } from '@nilzora/web-session';

/*
 * How the signed-in account is described in the workspaces. Display only: nothing
 * here grants or withholds anything.
 */

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
  moderator: 'Moderator',
  customer: 'Customer',
};

export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role];
}

/** The account's name, else its email address. */
export function displayName(user: Pick<SessionUser, 'email' | 'profile'>): string {
  const name = user.profile.fullName?.trim();
  if (name) return name;
  return user.email ?? 'Signed-in account';
}

/** A Record over every Permission, so a new permission fails typecheck until labelled. */
const PERMISSION_LABELS: Record<Permission, string> = {
  'products.read': 'View products',
  'products.create': 'Create products',
  'products.update': 'Edit products',
  'products.publish': 'Publish products',
  'orders.read': 'View orders',
  'checkouts.recover': 'Recover abandoned checkouts',
  'orders.update_status': 'Update order status',
  'orders.cancel': 'Cancel orders',
  'inventory.adjust': 'Adjust stock',
  'zones.manage': 'Manage shopping zones',
  'payments.collect': 'Record cash collection',
  'moderation.assign': 'Assign content reviews',
  'customers.read': 'View customers',
  'customers.update': 'Edit customers',
  'coupons.create': 'Create coupons',
  'coupons.update': 'Edit coupons',
  'reviews.moderate': 'Moderate customer reviews',
  'reviews.view': 'Read customer reviews and photos',
  'reviews.reply': 'Answer a customer review',
  'content.approve': 'Approve product content',
  'finance.read': 'View sales and finance',
  'refunds.request': 'Request refunds',
  'refunds.approve': 'Approve refunds',
  'staff.invite': 'Invite staff',
  'staff.roles.assign': 'Assign staff roles',
  'staff.permissions.manage': 'Manage staff permissions',
  'settings.manage': 'Manage store settings',
  'image_search.manage': 'Manage image search',
  'audit_logs.read': 'View the audit log',
  'admin_workspace.access': 'Use the admin workspace',
  'moderator_workspace.access': 'Use the moderator workspace',
  'chat.templates.manage': 'Manage message templates',
  'chat.automation.manage': 'Manage chat automation',
  'chat.analytics.read': 'Read communication analytics',
  'notifications.broadcast': 'Send push broadcasts',
  'chat.reports.review': 'Review reported messages',
  'chat.internal.use': 'Use internal team chat',
  'discounts.view': 'View discount campaigns',
  'discounts.create': 'Create discount campaigns',
  'discounts.edit': 'Edit discount campaigns',
  'discounts.schedule': 'Schedule discount campaigns',
  'discounts.activate': 'Activate discount campaigns',
  'discounts.pause': 'Pause discount campaigns',
  'discounts.end': 'End discount campaigns',
  'discounts.archive': 'Archive discount campaigns',
  'discounts.manage_priority': 'Set campaign priority',
  'discounts.manage_coupon_policy': 'Set campaign coupon policy',
  'couriers.read': 'View couriers and rate cards',
  'couriers.configure': 'Enable and configure couriers',
  'couriers.pricing.manage': 'Manage courier rate cards',
  'shipments.read': 'View shipments and tracking',
  'shipments.create': 'Compare couriers and book shipments',
  'shipments.cancel': 'Cancel shipments',
  'shipments.track': 'Refresh tracking and record courier status',
  'shipments.returns.manage': 'Book return pickups and exchanges',
  'couriers.cod.read': 'View courier COD and settlements',
  'couriers.cod.reconcile': 'Record settlements and reconcile COD',
};

export function permissionLabel(permission: Permission): string {
  return PERMISSION_LABELS[permission];
}
