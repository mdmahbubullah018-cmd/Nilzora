import type {
  AuditEntry,
  Permission,
  RefundSummary,
  ReturnDetail,
  ReturnSummary,
} from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { ArrowRight, ClipboardList, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import {
  RefundRequestForm,
  RefundSteps,
  ReturnSteps,
} from '@/components/after-sales/after-sales-forms';
import { refundMethodLabel, RefundStatusChip } from '@/components/after-sales/refund-views';
import { ReturnStatusChip } from '@/components/after-sales/return-views';
import { formatDateTime, formatMoney, plural } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

/*
 * Returns, refunds and the audit trail of one order. Every decision is taken by the same
 * forms (and the same API checks) as the returns and refunds pages; this section only puts
 * them where staff already are. Only the next open return and refund carry their steps
 * here; the rest link to their own pages.
 */

const OPEN_RETURN = new Set(['requested', 'approved', 'received']);
const OPEN_REFUND = new Set(['requested', 'approved']);

export function isOpenReturn(status: string): boolean {
  return OPEN_RETURN.has(status);
}

const returnHref = (id: string) => `/admin/returns/${id}` as Route;
const refundHref = (id: string) => `/admin/refunds/${id}` as Route;

const LINK =
  'inline-flex items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline';

export interface OrderAfterSalesProps {
  orderNumber: string;
  paymentCollected: boolean;
  returns: readonly ReturnSummary[];
  refunds: readonly RefundSummary[];
  /** The first open return, read in full so its steps can be taken here. */
  openReturn: ReturnDetail | null;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

export function OrderAfterSales({
  orderNumber,
  paymentCollected,
  returns,
  refunds,
  openReturn,
  permissions,
  csrf,
}: OrderAfterSalesProps) {
  const canDecide = permissions.includes('orders.update_status');
  const canRestock = permissions.includes('inventory.adjust');
  const canApproveRefunds = permissions.includes('refunds.approve');
  const canRequestRefunds = permissions.includes('refunds.request');
  const openRefund = refunds.find((refund) => OPEN_REFUND.has(refund.status)) ?? null;
  const refunded = refunds
    .filter((refund) => refund.status === 'completed')
    .reduce((sum, refund) => sum + refund.amountMinor, 0);

  return (
    <SectionCard
      title="Returns and refunds"
      icon={Undo2}
      description={
        returns.length === 0 && refunds.length === 0
          ? 'Nothing has been returned or refunded on this order.'
          : `${plural(returns.length, 'return')} · ${plural(refunds.length, 'refund')}${refunded > 0 ? ` · ${formatMoney(refunded)} paid back` : ''}`
      }
    >
      <div className="grid gap-6">
        {returns.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              <AutoText>Returns</AutoText>
            </h3>
            <ul className="divide-y divide-hairline rounded-xl border border-hairline">
              {returns.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="grid min-w-0 gap-1">
                    <ReturnStatusChip status={request.status} />
                    <span className="text-xs text-muted-foreground">
                      <CountText count={request.itemCount} one="item" /> · requested{' '}
                      <DateTimeText value={request.requestedAt} style="datetime" /> · up to{' '}
                      {formatMoney(request.refundableMinor)}
                    </span>
                    <span className="text-xs text-body">Reason: {request.reason}</span>
                  </div>
                  <Link href={returnHref(request.id)} className={LINK}>
                    {isOpenReturn(request.status) ? 'Manage return' : 'View return'}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {openReturn ? (
          <div className="grid gap-3 rounded-xl border border-hairline bg-neutral-soft/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              <AutoText>Next step on the open return</AutoText>
            </h3>
            <ul className="grid gap-1 text-sm text-body">
              {openReturn.items.map((item) => (
                <li key={item.orderItemId}>
                  {item.productName}
                  {item.variantLabel ? ` (${item.variantLabel})` : ''} × {item.quantity}
                </li>
              ))}
            </ul>
            <ReturnSteps
              returnId={openReturn.id}
              status={openReturn.status}
              received={openReturn.receivedAt !== null}
              restocked={openReturn.restockedAt !== null}
              canDecide={canDecide}
              canRestock={canRestock}
              csrf={csrf}
            />
          </div>
        ) : null}

        {refunds.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              <AutoText>Refunds</AutoText>
            </h3>
            <ul className="divide-y divide-hairline rounded-xl border border-hairline">
              {refunds.map((refund) => (
                <li
                  key={refund.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="grid min-w-0 gap-1">
                    <RefundStatusChip status={refund.status} />
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(refund.amountMinor)} · {refundMethodLabel(refund.method)} ·
                      requested <DateTimeText value={refund.requestedAt} style="datetime" />
                      {refund.completedAt ? ` · paid ${formatDateTime(refund.completedAt)}` : ''}
                    </span>
                  </div>
                  <Link href={refundHref(refund.id)} className={LINK}>
                    {OPEN_REFUND.has(refund.status) ? 'Review refund' : 'View refund'}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {openRefund && canApproveRefunds ? (
          <div className="grid gap-3 rounded-xl border border-hairline bg-neutral-soft/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {openRefund.status === 'requested'
                ? 'Approve or reject the refund'
                : 'Record the payout'}{' '}
              ({formatMoney(openRefund.amountMinor)})
            </h3>
            <RefundSteps refundId={openRefund.id} status={openRefund.status} csrf={csrf} />
          </div>
        ) : null}

        {paymentCollected && canRequestRefunds && !openRefund ? (
          <details className="group rounded-xl border border-hairline">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-semibold text-link [&::-webkit-details-marker]:hidden">
              <AutoText>Start a refund on this order</AutoText>
            </summary>
            <div className="border-t border-hairline p-4">
              <RefundRequestForm csrf={csrf} defaultOrderNumber={orderNumber} />
            </div>
          </details>
        ) : !paymentCollected && returns.length === 0 && refunds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            A refund can be started once the cash for this order has been collected. Customers
            request returns from their order once it is delivered.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

const AUDIT_ACTION: Record<string, string> = {
  'order.status_changed': 'Status changed',
  'order.payment_collected': 'Cash recorded as collected',
  'order.note_added': 'Staff note added',
  'order.archived': 'Archived',
  'order.restored': 'Restored from the archive',
};

function auditSummary(entry: AuditEntry): string {
  const label = AUDIT_ACTION[entry.action] ?? entry.action;
  const from = entry.details.from;
  const to = entry.details.to;
  return typeof from === 'string' && typeof to === 'string' ? `${label}: ${from} → ${to}` : label;
}

/** Who did what to this order, from the audit log (audit_logs.read). */
export function OrderAuditTrail({
  entries,
  total,
  orderNumber,
}: {
  entries: readonly AuditEntry[];
  total: number;
  orderNumber: string;
}) {
  return (
    <SectionCard
      title="Audit trail"
      icon={ClipboardList}
      description="Privileged changes to this order and the staff account that made each one"
      actions={
        total > entries.length ? (
          <Link
            href={`/admin/audit?q=${orderNumber}&action=order.` as Route}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            All {total}
          </Link>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>No staff action has been recorded yet.</AutoText>
        </p>
      ) : (
        <ol className="grid gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
            >
              <span className="text-foreground">
                <AutoText value={auditSummary(entry)} />
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.actor?.name ?? entry.actor?.email ?? 'A removed account'} ·{' '}
                <time dateTime={entry.createdAt}>
                  <AutoText value={formatDateTime(entry.createdAt)} />
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
