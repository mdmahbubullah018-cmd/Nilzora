import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { DetailSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { DECISION_NOTICES, MODERATOR_TASKS_PATH } from '@/components/moderation/moderation-query';
import { noticeMessage } from '@/components/orders/order-query';
import { TaskDetailContent } from '@/components/moderation/moderator-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = { title: 'Review', robots: { index: false, follow: false } };

/** One assigned review: the submitted content, its history and the decision. */
export default async function ModeratorTaskPage({
  params,
  searchParams,
}: PageProps<'/moderator/tasks/[taskId]'>) {
  const gate = await workspaceGate('moderator', MODERATOR_TASKS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={MODERATOR_TASKS_PATH} />;
  }
  const { user, csrf } = gate;
  const { taskId } = await params;
  const notice = noticeMessage((await searchParams).notice, DECISION_NOTICES);

  return (
    <WorkspaceShell
      workspace="moderator"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: 'Review' }]}
    >
      {user.permissions.includes('content.approve') ? (
        <Suspense fallback={<DetailSkeleton label="Loading the review" />}>
          <TaskDetailContent taskId={taskId} csrf={csrf} notice={notice} />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          <PageToolbar
            back={{ href: MODERATOR_TASKS_PATH, label: 'Product content' }}
            title="Review"
          />
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="content.approve" />
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
