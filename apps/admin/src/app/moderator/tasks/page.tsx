import { MODERATION_TASK_STATUSES } from '@nilzora/contracts';
import { ClipboardCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { oneOf, pageParam } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SegmentedNav } from '@/components/admin-kit/segmented-nav';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { MODERATION_TASK_STATUS } from '@/components/admin-kit/status-badge';
import { moderatorTasksHref, MODERATOR_TASKS_PATH } from '@/components/moderation/moderation-query';
import { TaskListResults } from '@/components/moderation/moderator-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'Product content',
  robots: { index: false, follow: false },
};

/** Every review assigned to the moderator, by status. */
export default async function ModeratorTasksPage({ searchParams }: PageProps<'/moderator/tasks'>) {
  const gate = await workspaceGate('moderator', MODERATOR_TASKS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={MODERATOR_TASKS_PATH} />;
  }
  const { user, csrf } = gate;
  const params = await searchParams;
  const status = oneOf(params.status, MODERATION_TASK_STATUSES);
  const page = pageParam(params.page);

  return (
    <WorkspaceShell workspace="moderator" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={ClipboardCheck}
          title="Product content"
          description="Product content reviews assigned to you. Pending reviews are listed oldest first; the rest newest first."
        />
        {user.permissions.includes('content.approve') ? (
          <>
            <div className="overflow-x-auto pb-1">
              <SegmentedNav
                label="Review status"
                current={status ?? 'all'}
                options={[
                  {
                    key: 'all',
                    label: 'All',
                    href: moderatorTasksHref(MODERATOR_TASKS_PATH, undefined),
                  },
                  ...MODERATION_TASK_STATUSES.map((value) => ({
                    key: value,
                    label: MODERATION_TASK_STATUS[value].label,
                    href: moderatorTasksHref(MODERATOR_TASKS_PATH, value),
                  })),
                ]}
              />
            </div>
            <Suspense
              key={moderatorTasksHref(MODERATOR_TASKS_PATH, status, page)}
              fallback={<TableSkeleton caption="Loading your reviews" columns={5} />}
            >
              <TaskListResults
                path={MODERATOR_TASKS_PATH}
                status={status}
                page={page}
                now={new Date()}
              />
            </Suspense>
          </>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="content.approve" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
