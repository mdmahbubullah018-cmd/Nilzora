import { UserCog } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { noticeMessage } from '@/components/orders/order-query';
import { canManageTeam, STAFF_NOTICES, STAFF_PATH } from '@/components/staff/staff-rules';
import { TeamResults } from '@/components/staff/staff-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'User management',
  robots: { index: false, follow: false },
};

/** The team: roles, overrides and invitations. */
export default async function StaffPage({ searchParams }: PageProps<'/admin/staff'>) {
  const gate = await workspaceGate('admin', STAFF_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={STAFF_PATH} />;
  }
  const { user, csrf } = gate;
  const notice = noticeMessage((await searchParams).notice, STAFF_NOTICES);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={UserCog}
          title="User management"
          description="System users (owner, admins, staff and moderators), their roles and the permissions granted or denied on top of each role. Shoppers are managed under Customers."
        />
        {user.role !== 'super_admin' ? (
          <p className="rounded-xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">
            Only the store owner can add system users or change their roles. You can view the team
            {user.permissions.includes('staff.permissions.manage')
              ? ' and adjust individual permissions within your own access.'
              : '.'}
          </p>
        ) : null}
        {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}
        {canManageTeam(user) ? (
          <Suspense fallback={<TableSkeleton caption="Loading the team" columns={6} rows={5} />}>
            <TeamResults actor={user} csrf={csrf} />
          </Suspense>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="staff.roles.assign" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
