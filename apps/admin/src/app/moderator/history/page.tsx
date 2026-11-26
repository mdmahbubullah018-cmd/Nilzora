import { History } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { oneOf, pageParam } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SegmentedNav } from '@/components/admin-kit/segmented-nav';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { MODERATION_TASK_STATUS } from '@/components/admin-kit/status-badge';
import {
  DECIDED_STATUSES,
  moderatorTasksHref,
  MODERATOR_HISTORY_PATH,
} from '@/components/moderation/moderation-query';
import { TaskListResults } from '@/components/moderation/moderator-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'History',
  robots: { index: false, follow: false },
};

/** Reviews the moderator decided, one outcome at a time, with their decision notes. */
export default async function ModeratorHistoryPage({
  searchParams,
}: PageProps<'/moderator/history'>) {
  const gate = await workspaceGate('moderator', MODERATOR_HISTORY_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={MODERATOR_HISTORY_PATH} />;
  }
  const { user, csrf } = gate;
  const params = await searchParams;
  // The API lists one status at a time (there is no "any decided outcome" filter).
  const status = oneOf(params.status, DECIDED_STATUSES) ?? 'approved';
  const page = pageParam(params.page);

  return (
    <WorkspaceShell workspace="moderator" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={History}
          title="History"
          description="Reviews you decided, newest first, with the note you left."
        />
        {user.permissions.includes('content.approve') ? (
          <>
            <SegmentedNav
              label="Outcome"
              current={status}
              options={DECIDED_STATUSES.map((value) => ({
                key: value,
                label: MODERATION_TASK_STATUS[value].label,
                href: moderatorTasksHref(
                  MODERATOR_HISTORY_PATH,
                  value === 'approved' ? undefined : value,
                ),
              }))}
            />
            <Suspense
              key={`${status}-${String(page)}`}
              fallback={<TableSkeleton caption="Loading your history" columns={6} rows={5} />}
            >
              <TaskListResults
                path={MODERATOR_HISTORY_PATH}
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
