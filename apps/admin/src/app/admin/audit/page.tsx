import { Card } from '@nilzora/ui';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import {
  DateFilter,
  FilterBar,
  SearchFilter,
  SelectFilter,
} from '@/components/admin-kit/filter-bar';
import { ExportMenu } from '@/components/admin-kit/export-menu';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import {
  AUDIT_AREAS,
  auditHref,
  AUDIT_PATH,
  AuditResults,
  parseAuditFilters,
} from '@/components/audit/audit-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { dhakaToday, shiftDay } from '@/lib/date-range';

export const metadata: Metadata = { title: 'Audit log', robots: { index: false, follow: false } };

/**
 * The audit export's range: the filtered range when both ends are set (otherwise the last
 * 30 days, ending today in Bangladesh), plus the search, which the report also accepts.
 */
function exportRange(filters: { from?: string; to?: string; q?: string }): Record<string, string> {
  const today = dhakaToday();
  const to = filters.to ?? today;
  const from = filters.from ?? shiftDay(to, -29);
  return { from, to, ...(filters.q ? { q: filters.q } : {}) };
}

/** Privileged actions, newest first, filterable by area and by acting account. */
export default async function AuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const gate = await workspaceGate('admin', AUDIT_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={AUDIT_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('audit_logs.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={ScrollText} title="Audit log" />
        <Card className="nz-panel rounded-2xl">
          <ForbiddenState permission="audit_logs.read" />
        </Card>
      </WorkspaceShell>
    );
  }

  const { page, ...filters } = parseAuditFilters(await searchParams);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={ScrollText}
          title="Audit log"
          description="Who changed what: order and payment updates, account and permission changes, reviews and settings. Select an account’s name to see only its actions. The export follows the dates and search you choose (the last 30 days when none)."
          actions={<ExportMenu kind="audit_logs" filters={exportRange(filters)} />}
        />
        <FilterBar
          action={AUDIT_PATH}
          hidden={{ actor: filters.actorId }}
          resetHref={AUDIT_PATH}
          label="Audit log filters"
        >
          <SelectFilter
            name="area"
            label="Area"
            options={AUDIT_AREAS}
            defaultValue={filters.area}
            allLabel="Every area"
          />
          <DateFilter name="from" label="From" defaultValue={filters.from} max={dhakaToday()} />
          <DateFilter name="to" label="To" defaultValue={filters.to} max={dhakaToday()} />
          <SearchFilter
            label="Search"
            defaultValue={filters.q}
            placeholder="Action, person or reference"
          />
        </FilterBar>
        <Suspense
          key={auditHref(filters, page)}
          fallback={<TableSkeleton caption="Loading the audit log" columns={5} />}
        >
          <AuditResults filters={filters} page={page} permissions={user.permissions} />
        </Suspense>
      </div>
    </WorkspaceShell>
  );
}
