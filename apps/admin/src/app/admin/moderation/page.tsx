import { MODERATION_TASK_STATUSES, type ModerationScope } from '@nilzora/contracts';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { FilterBar, SelectFilter } from '@/components/admin-kit/filter-bar';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SegmentedNav } from '@/components/admin-kit/segmented-nav';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { MODERATION_TASK_STATUS } from '@/components/admin-kit/status-badge';
import {
  moderationHref,
  MODERATION_PATH,
  MODERATION_NOTICES,
  parseModerationFilters,
  SCOPE_LABEL,
} from '@/components/moderation/moderation-query';
import { ModerationResults } from '@/components/moderation/moderation-views';
import { noticeMessage } from '@/components/orders/order-query';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'Moderation',
  robots: { index: false, follow: false },
};

const SCOPE_ORDER = ['unassigned', 'mine', 'all'] as const satisfies readonly ModerationScope[];
const statusOptions = MODERATION_TASK_STATUSES.map((value) => ({
  value,
  label: MODERATION_TASK_STATUS[value].label,
}));

/** Every content review, for those who hand them to moderators. */
export default async function ModerationPage({ searchParams }: PageProps<'/admin/moderation'>) {
  const gate = await workspaceGate('admin', MODERATION_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={MODERATION_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('moderation.assign')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={ShieldCheck} title="Moderation" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="moderation.assign" />
        </section>
      </WorkspaceShell>
    );
  }

  const params = await searchParams;
  const { page, ...filters } = parseModerationFilters(params);
  const notice = noticeMessage(params.notice, MODERATION_NOTICES);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={ShieldCheck}
          title="Moderation"
          description="Product content submitted for review. Assign each open review to a moderator; only that moderator decides it, never the person who submitted it."
        />
        {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <SegmentedNav
            label="Which reviews"
            current={filters.scope}
            options={SCOPE_ORDER.map((scope) => ({
              key: scope,
              label: SCOPE_LABEL[scope],
              href: moderationHref({ ...filters, scope }),
            }))}
          />
          <FilterBar
            action={MODERATION_PATH}
            hidden={{ scope: filters.scope === 'all' ? undefined : filters.scope }}
            label="Review filters"
          >
            <SelectFilter
              name="status"
              label="Status"
              options={statusOptions}
              defaultValue={filters.status}
              allLabel="Any status"
            />
          </FilterBar>
        </div>
        <Suspense
          key={moderationHref(filters, page)}
          fallback={<TableSkeleton caption="Loading reviews" columns={5} />}
        >
          <ModerationResults
            filters={filters}
            page={page}
            actor={user}
            csrf={csrf}
            now={new Date()}
          />
        </Suspense>
      </div>
    </WorkspaceShell>
  );
}
