import { PERMISSIONS, type AppRole } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { testUser } from '@/test/fixtures';
import {
  canManageTeam,
  groupPermissions,
  invitableRoles,
  permissionCellLock,
  permissionLock,
  roleChange,
} from './staff-rules';

const member = (
  role: Exclude<AppRole, 'customer'>,
  id = '00000000-0000-4000-8000-0000000000aa',
) => ({
  id,
  role,
});

describe('invitableRoles', () => {
  it('lets only the owner invite admins, staff and moderators', () => {
    expect(invitableRoles(testUser('super_admin'))).toEqual(['admin', 'staff', 'moderator']);
    expect(invitableRoles(testUser('admin'))).toEqual([]);
  });

  it('offers nothing without staff.invite, or to other roles', () => {
    expect(invitableRoles(testUser('staff'))).toEqual([]);
    expect(
      invitableRoles(
        testUser('staff', { permissions: ['admin_workspace.access', 'staff.invite'] }),
      ),
    ).toEqual([]);
  });
});

describe('roleChange', () => {
  it('never lets anyone change their own role', () => {
    const owner = testUser('super_admin');
    expect(roleChange(owner, member('super_admin', owner.id))).toMatchObject({ locked: true });
  });

  it('lets owners move anyone else to any other role except owner', () => {
    expect(roleChange(testUser('super_admin'), member('admin')).roles).toEqual([
      'staff',
      'moderator',
      'customer',
    ]);
  });

  it('never lets an admin change roles', () => {
    const admin = testUser('admin');
    expect(roleChange(admin, member('admin'))).toMatchObject({ locked: true });
    expect(roleChange(admin, member('super_admin'))).toMatchObject({ locked: true });
    expect(roleChange(admin, member('staff'))).toMatchObject({ locked: true, roles: [] });
  });

  it('needs staff.roles.assign', () => {
    expect(roleChange(testUser('staff'), member('moderator'))).toMatchObject({ locked: true });
  });
});

describe('permission overrides', () => {
  it('are locked for self, for admins unless the caller is an owner, and without the permission', () => {
    const admin = testUser('admin');
    expect(permissionLock(admin, member('staff', admin.id))).toMatchObject({ locked: true });
    expect(permissionLock(admin, member('admin'))).toMatchObject({ locked: true });
    expect(permissionLock(admin, member('staff'))).toEqual({ locked: false });
    expect(permissionLock(testUser('super_admin'), member('admin'))).toEqual({ locked: false });
    expect(permissionLock(testUser('staff'), member('moderator'))).toMatchObject({ locked: true });
  });

  it('only for permissions the caller holds', () => {
    const admin = testUser('admin');
    expect(permissionCellLock(admin, 'orders.cancel')).toEqual({ locked: false });
    // Admins do not hold settings.manage, so they can neither grant nor deny it.
    expect(permissionCellLock(admin, 'settings.manage')).toMatchObject({ locked: true });
  });

  it('group every permission into exactly one area', () => {
    const groups = groupPermissions(PERMISSIONS.map((name) => ({ name })));
    expect(groups.flatMap((group) => group.permissions).length).toBe(PERMISSIONS.length);
  });
});

describe('canManageTeam', () => {
  it('matches the API: roles or permission management', () => {
    expect(canManageTeam(testUser('admin'))).toBe(true);
    expect(canManageTeam(testUser('staff'))).toBe(false);
    expect(
      canManageTeam({ permissions: ['admin_workspace.access', 'staff.permissions.manage'] }),
    ).toBe(true);
  });
});
