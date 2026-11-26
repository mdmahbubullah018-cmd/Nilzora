import { PERMISSIONS, type AppRole, type Permission } from '@nilzora/contracts';
import type { SessionUser } from '@nilzora/web-session';

/**
 * Role permissions as the API grants them by default (its auth/permissions module),
 * copied so these tests describe real accounts. The app itself never derives access from
 * a role name: it only reads the permission list GET /me returns.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  // Admins get everything except store settings and enabling couriers (owner only).
  admin: PERMISSIONS.filter(
    (permission) => permission !== 'settings.manage' && permission !== 'couriers.configure',
  ),
  staff: [
    'admin_workspace.access',
    'products.read',
    'products.create',
    'products.update',
    'orders.read',
    'orders.update_status',
    'customers.read',
    'refunds.request',
  ],
  moderator: ['moderator_workspace.access', 'products.read', 'reviews.moderate', 'content.approve'],
  customer: [],
};

/** A verified user as GET /me would describe it. Test data only. */
export function testUser(role: AppRole, overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: `${role}@example.test`,
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
    profile: {
      fullName: null,
      avatar: null,
      googleAvatar: null,
      phone: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}
