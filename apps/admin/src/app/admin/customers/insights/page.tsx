import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SEGMENT_LABELS,
  customerInsightQuerySchema,
  type CustomerSegment,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { ChartLine, UsersRound } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import {
  Chip,
  DataTable,
  DataTableEmpty,
  FilterBar,
  Pagination,
  SearchFilter,
  Tabs,
  withQuery,
  type StatusTone,
} from '@/components/admin-kit';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { formatCount, formatDateTime, formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Customer insight',
  robots: { index: false, follow: false },
};

const INSIGHTS_PATH = '/admin/customers/insights' as Route;

/** Short names for the tabs; the chips carry the contract's text, which says how each is decided. */
const SEGMENT: Record<CustomerSegment, { label: string; tone: StatusTone }> = {
  new: { label: 'New', tone: 'primary' },
  repeat: { label: 'Repeat', tone: 'violet' },
  high_spender: { label: 'High spender', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  active: { label: 'Active', tone: 'moderator' },
};

interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function insightsHref(segment: string, q: string, page = 1): Route {
  return withQuery(INSIGHTS_PATH, {
    segment: segment === 'all' ? undefined : segment,
    q: q === '' ? undefined : q,
    page: page > 1 ? page : undefined,
  });
}

/**
 * What each customer has actually spent. The figure is derived from their orders minus the
 * refunds that were really paid, so it can never be higher than the money the store kept.
 * Nothing here is a prediction, and no demographic attribute is collected to produce it.
 */
export default async function CustomerInsightsPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', INSIGHTS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={INSIGHTS_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('customers.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={ChartLine} title="Customer insight" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="customers.read" />
        </section>
      </WorkspaceShell>
    );
  }

  // A cleared field (an empty search) means "no filter", not an invalid one.
  const raw = Object.fromEntries(
    Object.entries(await searchParams).filter(([, value]) => value !== '' && value !== undefined),
  );
  const parsed = customerInsightQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : customerInsightQuerySchema.parse({ segment: 'all', q: '', page: 1, pageSize: 25 });

  const result = await adminRead((api, token) => api.adminCustomerInsights(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(INSIGHTS_PATH));

  const filtered = query.segment !== 'all' || query.q !== '';

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={ChartLine}
          back={{ href: '/admin/customers' as Route, label: 'Customers' }}
          title="Customer insight"
          description="Spending is confirmed orders minus refunds that were completed. A cancelled order never counts. Segments follow from real orders and the thresholds in the store settings."
        />
        {result.kind === 'ok' ? (
          <GlassTable
            label="Customer spending and segments"
            header={
              <>
                <Tabs
                  label="Customer segment"
                  current={query.segment}
                  items={[
                    { key: 'all', label: 'All customers', href: insightsHref('all', query.q) },
                    ...CUSTOMER_SEGMENTS.map((segment) => ({
                      key: segment,
                      label: SEGMENT[segment].label,
                      href: insightsHref(segment, query.q),
                    })),
                  ]}
                />
                <FilterBar
                  action={INSIGHTS_PATH}
                  label="Search customers"
                  hidden={{ segment: query.segment === 'all' ? undefined : query.segment }}
                  resetHref={filtered ? INSIGHTS_PATH : undefined}
                >
                  <SearchFilter label="Search" defaultValue={query.q} placeholder="Name or email" />
                </FilterBar>
                {query.segment !== 'all' ? (
                  <p className="text-sm text-muted-foreground">
                    {SEGMENT[query.segment].label}: {CUSTOMER_SEGMENT_LABELS[query.segment]}.
                  </p>
                ) : null}
              </>
            }
            footer={
              result.value.total > 0 ? (
                <Pagination
                  page={result.value.page}
                  totalPages={result.value.totalPages}
                  total={result.value.total}
                  pageSize={result.value.pageSize}
                  noun="customers"
                  hrefFor={(next) => insightsHref(query.segment, query.q, next)}
                />
              ) : undefined
            }
          >
            <DataTable caption="Customer spending and segments" dense>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    <AutoText>Customer</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Orders</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Spent</AutoText>
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    <AutoText>Average</AutoText>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    <AutoText>Last order</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Segment</AutoText>
                  </TableHead>
                </TableRow>
              </TableHeader>
              {result.value.customers.length > 0 ? (
                <TableBody>
                  {result.value.customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="grid">
                          <span className="max-w-56 truncate font-medium text-foreground">
                            {customer.fullName ?? 'Customer'}
                          </span>
                          <span className="max-w-56 truncate text-xs text-muted-foreground">
                            {customer.email ?? '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(customer.ordersCount)}
                        <span className="block text-xs text-muted-foreground">
                          {formatCount(customer.completedOrders)} delivered
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-foreground tabular-nums">
                        {formatMoney(customer.spendMinor)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {formatMoney(customer.averageOrderMinor)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {customer.lastOrderAt === null
                          ? 'Never'
                          : formatDateTime(customer.lastOrderAt)}
                      </TableCell>
                      <TableCell>
                        {customer.segments.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul aria-label="Segments" className="flex flex-wrap gap-1.5">
                            {customer.segments.map((segment) => (
                              <li key={segment}>
                                <Chip tone={SEGMENT[segment].tone}>
                                  {CUSTOMER_SEGMENT_LABELS[segment]}
                                </Chip>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ) : (
                <DataTableEmpty
                  colSpan={6}
                  icon={UsersRound}
                  title={filtered ? 'No customers match this view' : 'No customers yet'}
                  description={
                    filtered
                      ? 'Try another segment or search.'
                      : 'Spending appears here once customers place orders.'
                  }
                />
              )}
            </DataTable>
          </GlassTable>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={INSIGHTS_PATH}
              permission="customers.read"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
