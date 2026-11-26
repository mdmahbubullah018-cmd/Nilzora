import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { DetailSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { AdminReviewContent } from '@/components/moderation/admin-review';
import { MODERATION_NOTICES, MODERATION_PATH } from '@/components/moderation/moderation-query';
import { noticeMessage } from '@/components/orders/order-query';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'Content review',
  robots: { index: false, follow: false },
};

/** One content review for assigners: the submission, its history, assign and withdraw. */
export default async function AdminReviewPage({
  params,
  searchParams,
}: PageProps<'/admin/moderation/[taskId]'>) {
  const gate = await workspaceGate('admin', MODERATION_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={MODERATION_PATH} />;
  }
  const { user, csrf } = gate;
  const { taskId } = await params;
  const notice = noticeMessage((await searchParams).notice, MODERATION_NOTICES);

  return (
    <WorkspaceShell
      workspace="admin"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: 'Content review' }]}
    >
      {user.permissions.includes('moderation.assign') ? (
        <Suspense fallback={<DetailSkeleton label="Loading the review" />}>
          <AdminReviewContent
            taskId={taskId}
            permissions={user.permissions}
            actor={user}
            csrf={csrf}
            notice={notice}
          />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          <PageToolbar
            back={{ href: MODERATION_PATH, label: 'Moderation' }}
            title="Content review"
          />
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="moderation.assign" />
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
