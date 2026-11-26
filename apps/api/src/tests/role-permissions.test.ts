import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@nilzora/contracts';
import { permissionsFor, ROLE_PERMISSIONS } from './role-permissions';

/*
 * The in-memory role defaults the API fakes use. They mirror the database's
 * role_permissions rows, and `admin.integration.test.ts` compares them with the real table;
 * these unit assertions pin the decisions that table encodes, so a change to the copy is
 * deliberate rather than accidental when the database cannot be reached.
 *
 * The reviews pair comes from 20261208090000_verified_reviews.sql, which grants
 * `reviews.view` and `reviews.reply` to the owner, admins and moderators - not to staff.
 */

describe('the role defaults the fakes grant', () => {
  it('gives the owner every permission, including the newest ones', () => {
    expect([...ROLE_PERMISSIONS.super_admin].sort()).toStrictEqual([...PERMISSIONS].sort());
    expect(ROLE_PERMISSIONS.super_admin).toContain('reviews.view');
    expect(ROLE_PERMISSIONS.super_admin).toContain('reviews.reply');
  });

  it('withholds only settings.manage and couriers.configure from an admin', () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toStrictEqual(
      PERMISSIONS.filter(
        (permission) => permission !== 'settings.manage' && permission !== 'couriers.configure',
      ).sort(),
    );
    expect(ROLE_PERMISSIONS.admin).toContain('reviews.reply');
  });

  it('lets a moderator read and answer reviews, as the migration grants', () => {
    const moderator = permissionsFor('moderator');
    expect(moderator.has('reviews.view')).toBe(true);
    expect(moderator.has('reviews.reply')).toBe(true);
    // Deciding a review is a different permission and it keeps working.
    expect(moderator.has('reviews.moderate')).toBe(true);
  });

  it('keeps review decisions away from staff and customers', () => {
    for (const role of ['staff', 'customer'] as const) {
      const permissions = permissionsFor(role);
      expect(permissions.has('reviews.view')).toBe(false);
      expect(permissions.has('reviews.reply')).toBe(false);
      expect(permissions.has('reviews.moderate')).toBe(false);
    }
  });

  it('gives staff no courier permission by default (an admin grants them per account)', () => {
    const staff = [...permissionsFor('staff')];
    expect(staff.filter((p) => p.startsWith('shipments.') || p.startsWith('couriers.'))).toEqual(
      [],
    );
  });

  it('names the reviews permissions the database defines', () => {
    expect(PERMISSIONS).toContain('reviews.view');
    expect(PERMISSIONS).toContain('reviews.reply');
  });
});
