// @vitest-environment jsdom
import type { PermissionInfo, StaffMember } from '@nilzora/contracts';
import { PERMISSIONS } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StaffPage from '@/app/admin/staff/page';
import { ROLE_PERMISSIONS, testUser } from '@/test/fixtures';
import { MemberView, TeamView } from './staff-views';

const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/staff-actions', () => ({
  inviteStaffAction: vi.fn(),
  changeRoleAction: vi.fn(),
  setPermissionAction: vi.fn(),
  resendInvitationAction: vi.fn(),
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/session', () => ({ session: {} }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/' }));

afterEach(cleanup);

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const catalog: PermissionInfo[] = PERMISSIONS.map((name) => ({
  name,
  description: `Does ${name}`,
}));

function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'staff.member@example.test',
    fullName: 'Staff Member',
    role: 'staff',
    status: 'active',
    grantedAt: '2026-10-01T00:00:00.000Z',
    overrides: [{ permission: 'orders.cancel', effect: 'grant' }],
    invitationPending: false,
    permissions: [...ROLE_PERMISSIONS.staff, 'orders.cancel'],
    ...overrides,
  };
}

describe('StaffPage', () => {
  it('refuses accounts that manage neither roles nor permissions', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    render(
      await StaffPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ notice: '<script>' }),
      }),
    );
    // An unknown notice key shows nothing, and the query text never appears.
    expect(document.body.textContent).not.toContain('<script>');
    expect(screen.getByText(/“Assign staff roles” permission/)).toBeTruthy();
  });
});

describe('TeamView', () => {
  it('lists members with role, overrides and a link to manage each', () => {
    const owner = testUser('super_admin');
    render(
      <TeamView data={{ staff: [member()], permissions: catalog }} actor={owner} csrf={csrf} />,
    );
    const row = screen.getByRole('row', { name: /Staff Member/ });
    expect(within(row).getByText('1 granted')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Staff Member' }).getAttribute('href')).toBe(
      '/admin/staff/33333333-3333-4333-8333-333333333333',
    );
  });

  it('offers the owner the admin, staff and moderator roles to invite, never owner', () => {
    render(
      <TeamView
        data={{ staff: [], permissions: catalog }}
        actor={testUser('super_admin')}
        csrf={csrf}
      />,
    );
    const role = screen.getByLabelText(/^Role/);
    expect(
      within(role)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['admin', 'staff', 'moderator']);
  });

  it('gives an admin no invitation form: only the owner adds system users', () => {
    render(
      <TeamView data={{ staff: [], permissions: catalog }} actor={testUser('admin')} csrf={csrf} />,
    );
    expect(screen.getByText('Only the store owner can add system users.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send invitation/ })).toBeNull();
  });

  it('explains when the account cannot invite', () => {
    render(
      <TeamView
        data={{ staff: [], permissions: catalog }}
        actor={testUser('staff', {
          permissions: ['admin_workspace.access', 'staff.permissions.manage'],
        })}
        csrf={csrf}
      />,
    );
    expect(screen.getByText(/needs the “Invite staff” permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send invitation/ })).toBeNull();
  });
});

describe('MemberView', () => {
  it('lets an admin edit only the permissions they hold', () => {
    render(
      <MemberView member={member()} catalog={catalog} actor={testUser('admin')} csrf={csrf} />,
    );
    expect(screen.getByRole('group', { name: 'Cancel orders: override' })).toBeTruthy();
    // Admins hold neither settings.manage nor couriers.configure (both the owner's).
    expect(screen.queryByRole('group', { name: 'Manage store settings: override' })).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Enable and configure couriers: override' }),
    ).toBeNull();
    expect(screen.getAllByText('Not yours to grant').length).toBe(2);
    const grant = within(screen.getByRole('group', { name: 'Cancel orders: override' })).getByRole(
      'button',
      { name: 'Grant' },
    );
    expect(grant.getAttribute('aria-pressed')).toBe('true');
    // Roles are the owner's alone.
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
    expect(screen.getByText('Only the owner assigns roles.')).toBeTruthy();
  });

  it('locks everything on the actor’s own account', () => {
    const admin = testUser('admin');
    render(
      <MemberView
        member={member({ id: admin.id, role: 'admin' })}
        catalog={catalog}
        actor={admin}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('You cannot change your own permissions.')).toBeTruthy();
    expect(screen.getByText('You cannot change your own role.')).toBeTruthy();
    expect(screen.queryAllByRole('group', { name: /: override$/ })).toHaveLength(0);
  });

  it('keeps an admin away from another admin', () => {
    render(
      <MemberView
        member={member({ role: 'admin' })}
        catalog={catalog}
        actor={testUser('admin')}
        csrf={csrf}
      />,
    );
    expect(
      screen.getByText('Only an owner changes an owner’s or admin’s permissions.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
  });
});

describe('pending invitations', () => {
  it('are marked and can be re-sent by accounts with staff.invite', () => {
    render(
      <MemberView
        member={member({ invitationPending: true })}
        catalog={catalog}
        actor={testUser('super_admin')}
        csrf={csrf}
        notice="A new invitation email is on its way."
      />,
    );
    expect(screen.getAllByText('Invitation pending').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Resend invitation' })).toBeTruthy();
    expect(screen.getByText('A new invitation email is on its way.')).toBeTruthy();
  });

  it('offer no resend without staff.invite or once accepted', () => {
    const { unmount } = render(
      <MemberView
        member={member({ invitationPending: true })}
        catalog={catalog}
        actor={testUser('staff', {
          permissions: ['admin_workspace.access', 'staff.permissions.manage'],
        })}
        csrf={csrf}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resend invitation' })).toBeNull();
    unmount();
    render(
      <MemberView
        member={member()}
        catalog={catalog}
        actor={testUser('super_admin')}
        csrf={csrf}
      />,
    );
    expect(screen.queryByText('Invitation pending')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend invitation' })).toBeNull();
  });

  it('show in the team table', () => {
    render(
      <TeamView
        data={{ staff: [member({ invitationPending: true })], permissions: catalog }}
        actor={testUser('super_admin')}
        csrf={csrf}
      />,
    );
    expect(
      within(screen.getByRole('row', { name: /Staff Member/ })).getByText('Invitation pending'),
    ).toBeTruthy();
  });
});
