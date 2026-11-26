import { PERMISSIONS, type AppRole, type Permission } from '@nilzora/contracts';

/*
 * The database's role defaults (the role_permissions rows of the
 * admin_permissions_moderation migration, plus the review permissions added by
 * verified_reviews), for the in-memory test fakes only. The API reads every account's
 * effective permissions from the database on each request; an integration test checks that
 * this copy still matches the real table.
 */
export const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly Permission[]>> = {
  super_admin: PERMISSIONS,
  // Admins get everything except store settings and enabling couriers
  // (20261223091000_courier_foundation.sql leaves couriers.configure to the owner).
  admin: PERMISSIONS.filter(
    (permission) => permission !== 'settings.manage' && permission !== 'couriers.configure',
  ),
  staff: [
    'admin_workspace.access',
    'products.read',
    'products.create',
    'products.update',
    'inventory.adjust',
    'orders.read',
    'orders.update_status',
    // Contacting customers about an incomplete checkout (20261231090000 migration).
    'checkouts.recover',
    'payments.collect',
    'customers.read',
    'refunds.request',
    'chat.internal.use',
  ],
  moderator: [
    'moderator_workspace.access',
    'products.read',
    'reviews.moderate',
    // The verified-reviews migration gives the moderator queue both of these: reading the
    // list it already decides on, and answering in public where the store allows it.
    'reviews.view',
    'reviews.reply',
    'content.approve',
    'chat.reports.review',
    'chat.internal.use',
  ],
  customer: [],
};

/** The default permissions of a role, as the fakes grant them. */
export function permissionsFor(role: AppRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}
