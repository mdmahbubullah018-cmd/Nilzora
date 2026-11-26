import type { OrderDetail } from '@nilzora/contracts';
import { receiptMoney } from '@nilzora/contracts';
import type { CSSProperties, ReactNode } from 'react';
import { NilzoraLogo } from '@/components/brand/nilzora-logo';
import { formatBdPhone, formatMoney } from '@/lib/format';
import {
  DELIVERY_ZONE_LABELS,
  formatEventTime,
  OrderStatusBadge,
  PaymentStatusBadge,
} from './order-status';

/*
 * The customer's receipt, rendered from the order the API returned and from nothing else:
 * every amount, name and variant below is the copy the order saved when it was placed, so a
 * later catalogue change never rewrites an old receipt. Nothing here recalculates a price.
 *
 * It is a document first and a page section second: the totals are the order's own fields,
 * the items keep their line totals, and the paper is the print target (`.nz-print-area`).
 */

/** Staggers the reveal of a block; capped in CSS so a long order stays quick. */
function step(index: number): CSSProperties {
  return { '--nz-step': index } as CSSProperties;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium wrap-break-word text-foreground">
        {children}
      </dd>
    </div>
  );
}

function TotalsRow({
  label,
  children,
  total = false,
}: {
  label: string;
  children: ReactNode;
  total?: boolean;
}) {
  return (
    <div
      className={
        total
          ? 'flex items-baseline justify-between gap-3 border-t border-dashed border-border-strong pt-3'
          : 'flex items-baseline justify-between gap-3'
      }
    >
      <dt
        className={
          total ? 'font-display text-base font-semibold text-foreground' : 'text-muted-foreground'
        }
      >
        {label}
      </dt>
      <dd
        className={
          total
            ? 'font-display text-xl font-semibold text-foreground tabular-nums'
            : 'font-medium text-foreground tabular-nums'
        }
      >
        {children}
      </dd>
    </div>
  );
}

/** What the customer still owes, in the words that match the payment status. */
function paymentNote(order: OrderDetail): string {
  if (order.paymentStatus === 'collected') {
    return 'Paid in cash when this order was delivered.';
  }
  if (order.paymentStatus === 'cancelled') {
    return 'Nothing was charged: this order was cancelled.';
  }
  return `Nothing has been paid yet. Pay ${formatMoney(order.totalMinor)} in cash when your parcel arrives.`;
}

export interface OrderReceiptProps {
  order: OrderDetail;
}

export function OrderReceipt({ order }: OrderReceiptProps) {
  const address = order.shippingAddress;
  const placedAt = formatEventTime(order.placedAt);
  // Paid and due come from the order's own payment state, never from a total minus a guess.
  const money = receiptMoney(order);

  return (
    <article
      aria-labelledby="receipt-heading"
      className="nz-print-area nz-receipt-print mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.06),0_24px_48px_-32px_rgba(15,23,42,0.55)]"
    >
      <header className="nz-receipt-step grid gap-4 px-6 pt-6 pb-5" style={step(0)}>
        <div className="flex items-center justify-between gap-3">
          <NilzoraLogo className="h-7" priority />
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Receipt
          </p>
        </div>
        <div className="grid gap-1">
          <h2 id="receipt-heading" className="font-display text-lg font-semibold text-foreground">
            Order {order.orderNumber}
          </h2>
          <p className="text-sm text-muted-foreground">
            Placed <time dateTime={order.placedAt}>{placedAt}</time>
          </p>
        </div>
      </header>

      <div className="nz-receipt-step px-6" style={step(1)}>
        <div className="border-t border-dashed border-border-strong" />
      </div>

      <dl className="nz-receipt-step grid gap-2.5 px-6 py-5" style={step(2)}>
        <MetaRow label="Order status">
          <OrderStatusBadge status={order.status} />
        </MetaRow>
        <MetaRow label="Payment method">Cash on Delivery</MetaRow>
        <MetaRow label="Payment status">
          <PaymentStatusBadge status={order.paymentStatus} />
        </MetaRow>
        <MetaRow label="Delivering to">
          {address.recipientName}
          <span className="block font-normal text-muted-foreground">
            {formatBdPhone(address.phone)}
          </span>
        </MetaRow>
        <MetaRow label="Address">
          <span className="font-normal text-muted-foreground">
            {address.addressLine}
            {address.landmark ? (
              <>
                <br />
                Near {address.landmark}
              </>
            ) : null}
            <br />
            {address.area}, {address.district}
            {address.postalCode ? ` ${address.postalCode}` : ''}
            <br />
            {address.division} Division
          </span>
        </MetaRow>
      </dl>

      <div className="nz-receipt-step px-6" style={step(3)}>
        <div className="border-t border-dashed border-border-strong" />
      </div>

      <table className="nz-receipt-step w-full" style={step(4)}>
        <caption className="sr-only">What this order contains</caption>
        <thead>
          <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
            <th scope="col" className="px-6 pt-5 pb-2 font-medium">
              Item
            </th>
            <th scope="col" className="pt-5 pb-2 text-center font-medium">
              Qty
            </th>
            <th scope="col" className="px-6 pt-5 pb-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.orderItemId} className="align-top">
              <td className="px-6 py-2">
                <p className="text-sm font-medium wrap-break-word text-foreground">
                  {item.productName}
                </p>
                {item.variantLabel ? (
                  <p className="text-xs wrap-break-word text-muted-foreground">
                    {item.variantLabel}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {formatMoney(item.unitPriceMinor)} each · SKU {item.sku}
                </p>
              </td>
              <td className="py-2 text-center text-sm text-foreground tabular-nums">
                {item.quantity}
              </td>
              <td className="px-6 py-2 text-right text-sm font-medium text-foreground tabular-nums">
                {formatMoney(item.lineTotalMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="nz-receipt-step grid gap-2.5 px-6 pt-4 pb-5" style={step(5)}>
        <TotalsRow label="Subtotal">{formatMoney(order.subtotalMinor)}</TotalsRow>
        <TotalsRow label={`Delivery (${DELIVERY_ZONE_LABELS[order.deliveryZone]})`}>
          {order.shippingFeeMinor === 0 ? 'Free' : formatMoney(order.shippingFeeMinor)}
        </TotalsRow>
        {order.discountMinor > 0 ? (
          <TotalsRow label="Discount">{formatMoney(-order.discountMinor)}</TotalsRow>
        ) : null}
        <TotalsRow label="Total" total>
          {formatMoney(order.totalMinor)}
        </TotalsRow>
        {money.paidMinor > 0 ? (
          <TotalsRow label="Paid">{formatMoney(money.paidMinor)}</TotalsRow>
        ) : null}
        <TotalsRow label="Due">
          {money.dueMinor === 0 ? 'Nothing' : formatMoney(money.dueMinor)}
        </TotalsRow>
      </dl>

      <footer className="nz-receipt-step grid gap-2 bg-surface-muted px-6 py-5" style={step(6)}>
        <p className="text-sm font-medium text-foreground">{paymentNote(order)}</p>
        <p className="text-xs wrap-break-word text-muted-foreground">
          {order.itemCount === 1 ? '1 item' : `${order.itemCount} items`} · Order{' '}
          {order.orderNumber} · Thank you for shopping with Nilzora.
        </p>
      </footer>
    </article>
  );
}
