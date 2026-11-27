import type { ReturnDetail, ReturnStatus, ReturnSummary } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { History, ListChecks, Package, PackageCheck, ReceiptText, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Chip,
  DataTable,
  DataTableEmpty,
  DetailList,
  FilterBar,
  Pagination,
  SearchFilter,
  SectionCard,
  Tabs,
  withQuery,
  type StatusTone,
} from '@/components/admin-kit';
import { Timeline, type TimelineItem, type TimelineTone } from '@/components/admin-kit/timeline';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ReturnSteps } from './after-sales-forms';
import { refundStatusLabel, RefundStatusChip } from './refund-views';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

export const RETURNS_PATH = '/admin/returns' as Route;

const STATUS: Record<ReturnStatus, { label: string; tone: StatusTone }> = {
  requested: { label: 'Waiting for a decision', tone: 'warning' },
  approved: { label: 'Approved — waiting for the goods', tone: 'primary' },
  rejected: { label: 'Rejected', tone: 'danger' },
  received: { label: 'Goods received', tone: 'violet' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function returnStatusLabel(status: string): string {
  return STATUS[status as ReturnStatus]?.label ?? status;
}

export function ReturnStatusChip({ status }: { status: ReturnStatus }) {
  return (
    <Chip tone={STATUS[status].tone} dot>
      {STATUS[status].label}
    </Chip>
  );
}

const TIMELINE_TONE: Record<ReturnStatus, TimelineTone> = {
  requested: 'warning',
  approved: 'primary',
  rejected: 'danger',
  received: 'violet',
  completed: 'success',
  cancelled: 'neutral',
};

const ACTOR: Record<string, string> = { customer: 'Customer', staff: 'Staff', system: 'Nilzora' };

export function returnsHref(status: string, q: string, page = 1): Route {
  return withQuery(RETURNS_PATH, {
    status: status === 'all' ? undefined : status,
    q: q === '' ? undefined : q,
    page: page > 1 ? page : undefined,
  });
}

/** The queue: status tabs, search, one row per request, and page links. */
export function ReturnListView({
  returns,
  status,
  q,
  page,
  totalPages,
  total,
  pageSize = 25,
}: {
  returns: readonly ReturnSummary[];
  status: string;
  q: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
}) {
  const filtered = status !== 'all' || q !== '';
  return (
    <GlassTable
      label="Return requests"
      header={
        <>
          <Tabs
            label="Return status"
            current={status}
            items={[
              { key: 'all', label: 'All', href: returnsHref('all', q) },
              ...(Object.keys(STATUS) as ReturnStatus[]).map((key) => ({
                key,
                label: STATUS[key].label.split(' — ')[0] ?? key,
                href: returnsHref(key, q),
              })),
            ]}
          />
          <FilterBar
            action={RETURNS_PATH}
            label="Search returns"
            hidden={{ status: status === 'all' ? undefined : status }}
            resetHref={filtered ? RETURNS_PATH : undefined}
          >
            <SearchFilter label="Search" defaultValue={q} placeholder="Order number or name" />
          </FilterBar>
        </>
      }
      footer={
        total > 0 ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            noun="return requests"
            hrefFor={(next) => returnsHref(status, q, next)}
          />
        ) : undefined
      }
    >
      <DataTable caption="Return requests" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>
              <AutoText>Order</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Status</AutoText>
            </TableHead>
            <TableHead className="text-right">
              <AutoText>Items</AutoText>
            </TableHead>
            <TableHead className="text-right">
              <AutoText>Refundable</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Requested</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Reason</AutoText>
            </TableHead>
          </TableRow>
        </TableHeader>
        {returns.length > 0 ? (
          <TableBody>
            {returns.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <Link
                    href={`/admin/returns/${request.id}` as Route}
                    className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                  >
                    {request.orderNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <ReturnStatusChip status={request.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <AutoText value={request.itemCount} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(request.refundableMinor)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <DateTimeText value={request.requestedAt} style="datetime" />
                </TableCell>
                <TableCell className="max-w-64 truncate">
                  <AutoText value={request.reason} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={Undo2}
            title={filtered ? 'No return requests match this view' : 'No return requests yet'}
            description={
              filtered
                ? 'Try another status or search.'
                : 'Requests appear here when customers ask to send delivered goods back.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

function historyItems(request: ReturnDetail): TimelineItem[] {
  return request.history.map((entry, index) => ({
    key: `${entry.at}-${String(index)}`,
    title:
      entry.fromStatus === null
        ? returnStatusLabel(entry.toStatus)
        : `${returnStatusLabel(entry.fromStatus)} → ${returnStatusLabel(entry.toStatus)}`,
    at: entry.at,
    actor: ACTOR[entry.actorKind] ?? entry.actorKind,
    note: entry.note,
    tone: TIMELINE_TONE[entry.toStatus],
  }));
}

/** One request: who asked, what for, the decision, and the steps still open. */
export function ReturnDetailView({
  request,
  csrf,
  canDecide,
  canRestock,
}: {
  request: ReturnDetail;
  csrf: CsrfInput;
  canDecide: boolean;
  canRestock: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="grid min-w-0 gap-6">
        <SectionCard
          title="Request"
          icon={PackageCheck}
          actions={<ReturnStatusChip status={request.status} />}
        >
          <DetailList
            items={[
              { label: 'Customer', value: request.customer?.name ?? null },
              { label: 'Phone', value: request.customer?.phone ?? null },
              { label: 'Refundable for these items', value: formatMoney(request.refundableMinor) },
              { label: 'Requested', value: formatDateTime(request.requestedAt) },
              { label: 'Reason', value: request.reason, wide: true },
              ...(request.description
                ? [{ label: 'In the customer’s words', value: request.description, wide: true }]
                : []),
              ...(request.decisionNote
                ? [{ label: 'Decision note', value: request.decisionNote, wide: true }]
                : []),
            ]}
          />
        </SectionCard>

        <SectionCard title="Items to return" icon={Package} flush>
          {request.items.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
              <AutoText>This request has no lines.</AutoText>
            </p>
          ) : (
            <ul className="divide-y divide-hairline border-t border-hairline">
              {request.items.map((item) => (
                <li
                  key={item.orderItemId}
                  className="flex flex-wrap justify-between gap-3 px-5 py-3 sm:px-6"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <p className="font-medium text-foreground">
                      <AutoText value={item.productName} />
                    </p>
                    {item.variantLabel ? (
                      <p className="text-xs text-muted-foreground">
                        <AutoText value={item.variantLabel} />
                      </p>
                    ) : null}
                    <p className="font-mono text-xs text-muted-foreground">
                      <AutoText value={item.sku} />
                    </p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p className="text-foreground">
                      {item.quantity}
                      {item.orderedQuantity === undefined ? null : (
                        <span className="text-muted-foreground"> of {item.orderedQuantity}</span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      <AutoText value={formatMoney(item.lineTotalMinor)} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="History" icon={History}>
          {request.history.length > 0 ? (
            <Timeline label="Return history" items={historyItems(request)} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <AutoText>No history has been recorded yet.</AutoText>
            </p>
          )}
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-6">
        <SectionCard
          title="Steps"
          icon={ListChecks}
          description="Stock moves back only after the goods are marked received, and only when you restock."
        >
          <ReturnSteps
            returnId={request.id}
            status={request.status}
            received={request.receivedAt !== null}
            restocked={request.restockedAt !== null}
            canDecide={canDecide}
            canRestock={canRestock}
            csrf={csrf}
          />
        </SectionCard>

        {request.refunds && request.refunds.length > 0 ? (
          <SectionCard title="Refunds on this return" icon={ReceiptText}>
            <ul className="grid gap-2">
              {request.refunds.map((refund) => (
                <li key={refund.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    href={`/admin/refunds/${refund.id}` as Route}
                    className="font-medium text-link underline-offset-4 hover:underline"
                    aria-label={`${formatMoney(refund.amountMinor)}, ${refundStatusLabel(refund.status)}`}
                  >
                    {formatMoney(refund.amountMinor)}
                  </Link>
                  <RefundStatusChip status={refund.status} />
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
