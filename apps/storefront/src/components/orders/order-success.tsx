import type { OrderDetail } from '@nilzora/contracts';
import { receiptMoney } from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { ArrowRight, Check, Download, PackageCheck, Phone, Truck } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import { formatEventTime } from './order-status';

/*
 * The moment an order is placed.
 *
 * Shown only by the receipt page's `?placed=1`, which the checkout redirect sets after
 * `place_cod_order` has answered with a saved order — never before. Every figure below is the
 * order the API returned, and the money wording follows the order's own payment state, so a
 * cash order is never called paid. The full order lives one tap away ("View order details") and
 * as a PDF ("Save order details"); both always point at this order's number.
 */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm font-semibold wrap-break-word text-foreground tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export function OrderSuccess({ order, pdfHref }: { order: OrderDetail; pdfHref: string }) {
  const money = receiptMoney(order);
  const placedAt = formatEventTime(order.placedAt);
  const due = money.dueMinor === 0 ? 'Nothing due' : formatMoney(money.dueMinor);

  return (
    <section
      aria-labelledby="order-success-heading"
      className="nz-no-print mx-auto grid w-full max-w-2xl gap-6 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm sm:p-10"
    >
      <div className="grid justify-items-center gap-4">
        <span className="relative grid size-16 place-items-center rounded-full bg-success/12 text-success ring-1 ring-success/25">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full ring-1 ring-success/20 motion-safe:animate-ping motion-safe:opacity-40 motion-reduce:hidden"
            style={{ animationDuration: '2.4s', animationIterationCount: '2' }}
          />
          <Check aria-hidden="true" className="size-8" strokeWidth={2.5} />
        </span>
        <div className="grid gap-1.5">
          <h1
            id="order-success-heading"
            className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            Your order has been placed successfully!
          </h1>
          <p className="text-sm text-muted-foreground">
            Thank you. We have received your order and will confirm it shortly.
          </p>
        </div>
      </div>

      <dl className="grid gap-4 rounded-xl bg-primary/5 p-4 text-left sm:grid-cols-3">
        <Fact label="Order number">{order.orderNumber}</Fact>
        <Fact label="Placed">
          <time dateTime={order.placedAt}>{placedAt}</time>
        </Fact>
        <Fact label="Pay on delivery">{due}</Fact>
      </dl>

      <ul className="grid gap-3 text-left text-sm text-muted-foreground">
        <li className="flex items-start gap-3">
          <PackageCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>We confirm your order, then pack it. You can follow every step in your orders.</span>
        </li>
        <li className="flex items-start gap-3">
          <Phone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>The courier may call the phone number on your order before delivery.</span>
        </li>
        <li className="flex items-start gap-3">
          <Truck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            {money.dueMinor === 0
              ? 'Nothing is left to pay on this order.'
              : `Keep ${formatMoney(money.dueMinor)} ready in cash when it arrives.`}
          </span>
        </li>
      </ul>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href={`/account/orders/${order.orderNumber}`}
          className={buttonClasses({ size: 'lg' })}
        >
          View order details
          <ArrowRight aria-hidden="true" />
        </Link>
        <a href={pdfHref} download className={buttonClasses({ variant: 'outline', size: 'lg' })}>
          <Download aria-hidden="true" />
          Save order details
        </a>
      </div>
      <Link
        href="/products"
        className="justify-self-center text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        Continue shopping
      </Link>
    </section>
  );
}
