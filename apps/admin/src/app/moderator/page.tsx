import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ChartSkeleton, ListSkeleton, StatTilesSkeleton } from '@/components/admin-kit/loaders';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import {
  IdentityCard,
  MODERATOR_HOME,
  QueueView,
  readQueue,
} from '@/components/moderation/moderator-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Queue',
  robots: { index: false, follow: false },
};

/** The moderator home's loading shape: stat tiles, the queue, then the chart and activity. */
function ModeratorHomeSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <StatTilesSkeleton label="Loading your figures" />
      <TableSkeleton caption="Loading your queue" columns={4} rows={5} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartSkeleton heightClass="h-48" />
        <ListSkeleton rows={5} label="Loading recent activity" />
      </div>
    </div>
  );
}

async function Queue({ canModerateReviews }: { canModerateReviews: boolean }) {
  const data = await readQueue(canModerateReviews);
  return <QueueView data={data} now={new Date()} />;
}

/** The moderator's home: the reviews assigned to them, oldest first. */
export default async function ModeratorQueuePage() {
  // The page's own check: never rely on the layout alone.
  const gate = await workspaceGate('moderator', MODERATOR_HOME);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={MODERATOR_HOME} />;
  }
  const { user, csrf } = gate;

  return (
    <WorkspaceShell workspace="moderator" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Inbox}
          eyebrow={
            <Chip tone="moderator" dot>
              <AutoText>Moderator workspace</AutoText>
            </Chip>
          }
          title="Queue"
          description="Product content assigned to you for review. Approve it, request changes or reject it with a note."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {user.permissions.includes('content.approve') ? (
              <Suspense fallback={<ModeratorHomeSkeleton />}>
                <Queue canModerateReviews={user.permissions.includes('reviews.view')} />
              </Suspense>
            ) : (
              <section className="nz-panel rounded-2xl border">
                <ForbiddenState permission="content.approve" />
              </section>
            )}
          </div>
          <div className="self-start">
            <IdentityCard user={user} />
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
