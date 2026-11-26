import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { DetailSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { noticeMessage } from '@/components/orders/order-query';
import { canManageTeam, STAFF_NOTICES, STAFF_PATH } from '@/components/staff/staff-rules';
import { MemberContent } from '@/components/staff/staff-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = { title: 'Team member', robots: { index: false, follow: false } };

/** One team member: role change and the permission override matrix. */
export default async function StaffMemberPage({
  params,
  searchParams,
}: PageProps<'/admin/staff/[userId]'>) {
  const gate = await workspaceGate('admin', STAFF_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={STAFF_PATH} />;
  }
  const { user, csrf } = gate;
  const { userId } = await params;
  const notice = noticeMessage((await searchParams).notice, STAFF_NOTICES);

  return (
    <WorkspaceShell
      workspace="admin"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: 'Team member' }]}
    >
      {canManageTeam(user) ? (
        <Suspense fallback={<DetailSkeleton label="Loading the team member" />}>
          <MemberContent userId={userId} actor={user} csrf={csrf} notice={notice} />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          <PageToolbar back={{ href: STAFF_PATH, label: 'Staff' }} title="Team member" />
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="staff.roles.assign" />
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
