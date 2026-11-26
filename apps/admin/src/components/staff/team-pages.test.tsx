// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModerationPage from '@/app/admin/moderation/page';
import AdminReviewPage from '@/app/admin/moderation/[taskId]/page';
import ProfilePage from '@/app/admin/profile/page';
import SettingsPage from '@/app/admin/settings/page';
import StaffMemberPage from '@/app/admin/staff/[userId]/page';
import StaffPage from '@/app/admin/staff/page';
import ModeratorHistoryPage from '@/app/moderator/history/page';
import ModeratorTaskPage from '@/app/moderator/tasks/[taskId]/page';
import ModeratorTasksPage from '@/app/moderator/tasks/page';
import { ROLE_PERMISSIONS, testUser } from '@/test/fixtures';

/*
 * Page-level permission checks for the settings, profile, team and moderation pages: each
 * page tests its own permission before reading anything, and refuses with the permission it
 * needs named. The Server Components that read data are stubbed (they are covered by their
 * own tests); the question here is only who is let in.
 */

const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));
const reads = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/session', () => ({
  session: {
    read: () => {
      reads.calls += 1;
      return Promise.reject(new Error('A refused page must not read anything.'));
    },
  },
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/settings-actions', () => ({
  setDeliveryChargeAction: vi.fn(),
  setSalesTargetAction: vi.fn(),
  saveStoreRulesAction: vi.fn(),
}));
vi.mock('@/lib/staff-actions', () => ({
  inviteStaffAction: vi.fn(),
  changeRoleAction: vi.fn(),
  setPermissionAction: vi.fn(),
  resendInvitationAction: vi.fn(),
}));
vi.mock('@/lib/moderation-actions', () => ({
  assignReviewAction: vi.fn(),
  withdrawReviewAction: vi.fn(),
  decideReviewAction: vi.fn(),
}));
vi.mock('@/lib/avatar-actions', () => ({ uploadAvatarAction: vi.fn(), removeAvatarAction: vi.fn() }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The data-reading Server Components: stubbed, so a page that lets someone in is visible.
vi.mock('@/components/settings/settings-view', () => ({
  SETTINGS_PATH: '/admin/settings',
  DeliveryChargesResults: () => <p>Delivery charges panel</p>,
}));
vi.mock('@/components/settings/sales-target-card', () => ({
  SalesTargetCard: () => <p>Sales target panel</p>,
}));
vi.mock('@/components/settings/store-rules-card', () => ({
  StoreRulesCard: () => <p>Store rules panel</p>,
}));
vi.mock('@/components/staff/staff-views', () => ({
  TeamResults: () => <p>Team panel</p>,
  MemberContent: () => <p>Member panel</p>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return {
    redirect: vi.fn(throwRedirect),
    notFound: vi.fn(throwNotFound),
    usePathname: () => '/',
    useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const TASK = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const USER = '5b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

function signIn(user: ReturnType<typeof testUser>) {
  gate.value = { access: 'allowed', user, csrf };
}

const query = (values: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(values), params: Promise.resolve({}) }) as never;

beforeEach(() => {
  reads.calls = 0;
  signIn(testUser('admin'));
});
afterEach(cleanup);

describe('settings page', () => {
  it('is for settings.manage only, and has no stale "not available yet" list', async () => {
    // Admins hold every permission but settings.manage.
    render(await SettingsPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Store settings' })).toBeTruthy();
    expect(screen.getByText(/“Manage store settings” permission/)).toBeTruthy();
    expect(screen.queryByText('Delivery charges panel')).toBeNull();
    expect(screen.queryByText('Store rules panel')).toBeNull();
    expect(screen.queryByText('Not available yet')).toBeNull();
    expect(reads.calls).toBe(0);
    cleanup();

    signIn(testUser('super_admin'));
    render(await SettingsPage());
    expect(screen.getByText('Delivery charges panel')).toBeTruthy();
    expect(screen.getByText('Sales target panel')).toBeTruthy();
    expect(screen.getByText('Store rules panel')).toBeTruthy();
    expect(screen.queryByText('Not available yet')).toBeNull();
  });
});

describe('profile page', () => {
  it('lets any admin-workspace account change its own picture', async () => {
    signIn(testUser('staff'));
    render(await ProfilePage());
    expect(screen.getByRole('heading', { level: 1, name: 'Profile picture' })).toBeTruthy();
    expect(screen.getByLabelText('Upload a picture')).toBeTruthy();
  });
});

describe('staff pages', () => {
  it('refuse accounts that manage neither roles nor permissions, before reading the team', async () => {
    signIn(testUser('staff'));
    render(await StaffPage(query()));
    expect(screen.getByText(/“Assign staff roles” permission/)).toBeTruthy();
    expect(screen.queryByText('Team panel')).toBeNull();
    cleanup();

    render(await StaffMemberPage({ params: Promise.resolve({ userId: USER }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/“Assign staff roles” permission/)).toBeTruthy();
    expect(screen.queryByText('Member panel')).toBeNull();
    expect(reads.calls).toBe(0);
  });

  it('let an account with a team permission in', async () => {
    render(await StaffPage(query()));
    expect(screen.getByText('Team panel')).toBeTruthy();
    cleanup();
    signIn(testUser('staff', { permissions: [...ROLE_PERMISSIONS.staff, 'staff.permissions.manage'] }));
    render(await StaffPage(query()));
    expect(screen.getByText('Team panel')).toBeTruthy();
  });
});

describe('admin moderation pages', () => {
  it('need moderation.assign and read nothing without it', async () => {
    signIn(testUser('staff'));
    render(await ModerationPage(query()));
    expect(screen.getByRole('heading', { level: 1, name: 'Moderation' })).toBeTruthy();
    expect(screen.getByText(/“Assign content reviews” permission/)).toBeTruthy();
    cleanup();

    render(await AdminReviewPage({ params: Promise.resolve({ taskId: TASK }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/“Assign content reviews” permission/)).toBeTruthy();
    expect(reads.calls).toBe(0);
  });
});

describe('moderator workspace pages', () => {
  const noReviewing = () =>
    signIn(testUser('moderator', { permissions: ['moderator_workspace.access', 'products.read'] }));

  it('refuse a moderator without content.approve on every review page', async () => {
    noReviewing();
    render(await ModeratorTasksPage(query()));
    expect(screen.getByText(/“Approve product content” permission/)).toBeTruthy();
    cleanup();

    render(await ModeratorHistoryPage(query()));
    expect(screen.getByText(/“Approve product content” permission/)).toBeTruthy();
    cleanup();

    render(await ModeratorTaskPage({ params: Promise.resolve({ taskId: TASK }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/“Approve product content” permission/)).toBeTruthy();
    expect(reads.calls).toBe(0);
  });
});
