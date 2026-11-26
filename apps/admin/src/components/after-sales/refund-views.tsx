import type { RefundDetail, RefundStatus, RefundSummary } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { Banknote, HandCoins, History, ReceiptText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Chip,
  DataTable,
  DataTableEmpty,
  DetailList,
  FilterBar,
  Pagination,
  PAYMENT_STATUS,
  SearchFilter,
  SectionCard,
  Tabs,
  withQuery,
  type StatusTone,
} from '@/components/admin-kit';
import { Timeline, type TimelineTone } from '@/components/admin-kit/timeline';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable, ViewOnly } from '@/components/catalog/catalog-ui';
import { formatDateTime, formatMoney } from '@/lib/format';
import { RefundRequestForm, RefundSteps } from './after-sales-forms';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

export const REFUNDS_PATH = '/admin/refunds' as Route;

const STATUS: Record<RefundStatus, { label: string; tone: StatusTone & TimelineTone }> = {
  requested: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved — waiting for the payout', tone: 'primary' },
  completed: { label: 'Paid out', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const METHOD_LABELS: Record<string, string> = {
  cod_manual: 'Cash paid back by hand',
  bank_transfer: 'Bank transfer',
};

export function refundStatusLabel(status: string): string {
  return STATUS[status as RefundStatus]?.label ?? status;
}

export function refundMethodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

export function RefundStatusChip({ status }: { status: string }) {
  const style = STATUS[status as RefundStatus];
  return (
    <Chip tone={style?.tone ?? 'neutral'} dot>
      {style?.label ?? status}
    </Chip>
  );
}

export function refundsHref(status: string, q: string, page = 1): Route {
  return withQuery(REFUNDS_PATH, {
    status: status === 'all' ? undefined : status,
    q: q === '' ? undefined : q,
    page: page > 1 ? page : undefined,
  });
}

/** The queue, with the form that starts a refund on an order. */
export function RefundListView({
  refunds,
  status,
  q,
  page,
  totalPages,
  total,
  pageSize = 25,
  csrf,
  canRequest,
}: {
  refunds: readonly RefundSummary[];
  status: string;
  q: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  csrf: CsrfInput;
  canRequest: boolean;
}) {
  const filtered = status !== 'all' || q !== '';
  return (
    <div className="grid gap-6">
      {canRequest ? (
        <SectionCard
          title="Record a refund"
          icon={HandCoins}
          className="nz-panel-strong"
          description="Cash on Delivery means the money is handed back by the store. A refund is approved first and only counts as paid once its reference is recorded."
        >
          <RefundRequestForm csrf={csrf} />
        </SectionCard>
      ) : null}

      <GlassTable
        label="Refunds"
        header={
          <>
            <Tabs
              label="Refund status"
              current={status}
              items={[
                { key: 'all', label: 'All', href: refundsHref('all', q) },
                ...(Object.keys(STATUS) as RefundStatus[]).map((key) => ({
                  key,
                  label: STATUS[key].label.split(' — ')[0] ?? key,
                  href: refundsHref(key, q),
                })),
              ]}
            />
            <FilterBar
              action={REFUNDS_PATH}
              label="Search refunds"
              hidden={{ status: status === 'all' ? undefined : status }}
              resetHref={filtered ? REFUNDS_PATH : undefined}
            >
              <SearchFilter
                label="Search"
                defaultValue={q}
                placeholder="Order number, name or reference"
              />
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
              noun="refunds"
              hrefFor={(next) => refundsHref(status, q, next)}
            />
          ) : undefined
        }
      >
        <DataTable caption="Refunds" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead><AutoText>Order</AutoText></TableHead>
              <TableHead><AutoText>Customer</AutoText></TableHead>
              <TableHead className="text-right"><AutoText>Amount</AutoText></TableHead>
              <TableHead><AutoText>Method</AutoText></TableHead>
              <TableHead><AutoText>Status</AutoText></TableHead>
              <TableHead><AutoText>Requested</AutoText></TableHead>
            </TableRow>
          </TableHeader>
          {refunds.length > 0 ? (
            <TableBody>
              {refunds.map((refund) => (
                <TableRow key={refund.id}>
                  <TableCell>
                    <Link
                      href={`/admin/refunds/${refund.id}` as Route}
                      className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {refund.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{refund.customerName ?? '—'}</TableCell>
                  <TableCell className="text-right font-semibold text-foreground tabular-nums">
                    {formatMoney(refund.amountMinor)}
                  </TableCell>
                  <TableCell><AutoText value={refundMethodLabel(refund.method)} /></TableCell>
                  <TableCell>
                    <RefundStatusChip status={refund.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <DateTimeText value={refund.requestedAt} style="datetime" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={6}
              icon={ReceiptText}
              title={filtered ? 'No refunds match this view' : 'No refunds yet'}
              description={
                filtered
                  ? 'Try another status or search.'
                  : 'Refunds appear here once staff request one on an order.'
              }
            />
          )}
        </DataTable>
      </GlassTable>
    </div>
  );
}

/** One refund: the money, the order, the decision, and the payout record. */
export function RefundDetailView({
  refund,
  csrf,
  canApprove,
}: {
  refund: RefundDetail;
  csrf: CsrfInput;
  canApprove: boolean;
}) {
  const payment = PAYMENT_STATUS[refund.order.paymentStatus as keyof typeof PAYMENT_STATUS];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="grid min-w-0 gap-6">
        <SectionCard
          title="Refund"
          icon={Banknote}
          actions={<RefundStatusChip status={refund.status} />}
        >
          <DetailList
            items={[
              {
                label: 'Amount',
                value: (
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {formatMoney(refund.amountMinor)}
                  </span>
                ),
              },
              { label: 'Method', value: refundMethodLabel(refund.method) },
              { label: 'Customer', value: refund.customer.name ?? null },
              {
                label: 'Order',
                value: (
                  <Link
                    href={`/admin/orders/${refund.order.number}` as Route}
                    className="font-mono font-medium text-link underline-offset-4 hover:underline"
                  >
                    {refund.order.number}
                  </Link>
                ),
              },
              { label: 'Order total', value: formatMoney(refund.order.totalMinor) },
              { label: 'Still refundable', value: formatMoney(refund.refundableMinor) },
              { label: 'Payment', value: payment?.label ?? refund.order.paymentStatus },
              { label: 'Payout reference', value: refund.reference ?? 'Not paid out yet' },
              { label: 'Reason', value: refund.reason, wide: true },
              {
                label: 'Completed',
                value: refund.completedAt === null ? null : formatDateTime(refund.completedAt),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="History" icon={History}>
          {refund.history.length > 0 ? (
            <Timeline
              label="Refund history"
              items={refund.history.map((entry, index) => ({
                key: `${entry.at}-${String(index)}`,
                title:
                  entry.fromStatus === null
                    ? refundStatusLabel(entry.toStatus)
                    : `${refundStatusLabel(entry.fromStatus)} → ${refundStatusLabel(entry.toStatus)}`,
                at: entry.at,
                note: entry.note,
                tone: STATUS[entry.toStatus]?.tone ?? 'neutral',
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground"><AutoText>No history has been recorded yet.</AutoText></p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Decision and payout"
        icon={HandCoins}
        description="A refund counts as paid only once its reference is recorded."
      >
        {canApprove ? (
          <RefundSteps refundId={refund.id} status={refund.status} csrf={csrf} />
        ) : (
          <ViewOnly><AutoText>Deciding and paying out refunds needs the “Approve refunds” permission.</AutoText></ViewOnly>
        )}
      </SectionCard>
    </div>
  );
}
