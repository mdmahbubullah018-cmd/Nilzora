import {
  orderNumberSchema,
  type CustomerShipment,
  type OrderDetail,
  type ReviewStatus,
} from '@nilzora/contracts';
import {
  Alert,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { Banknote, Receipt, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddressBlock } from '@/components/addresses/address-block';
import { productHref } from '@/components/cart/cart-line';
import { ProductImage } from '@/components/catalog/product-image';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import {
  BackLink,
  itemCountLabel,
  PageFrame,
  SummaryList,
  SummaryRow,
} from '@/components/checkout/page-parts';
import { CancelOrderForm } from '@/components/orders/cancel-order-form';
import { ReviewAlreadySubmitted, ReviewFromOrder } from '@/components/product/review-from-order';
import type { CsrfField } from '@/components/auth/form-kit';
import { AskSupportButton } from '@/components/support/ask-support-button';
import { CartClearedSignal } from '@/components/orders/cart-cleared-signal';
import { ShipmentTrackingCard } from '@/components/orders/shipment-tracking';
import {
  DELIVERY_ZONE_LABELS,
  formatEventTime,
  ORDER_EVENT_LABELS,
  OrderStatusBadge,
  PAYMENT_STATUS_DESCRIPTIONS,
  PaymentStatusBadge,
} from '@/components/orders/order-status';
import { readAccount } from '@/lib/account-read';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { formatLongDate, formatMoney } from '@/lib/format';
import { cancelOrderAction } from '@/lib/order-actions';
import { readOrderShipments } from '@/lib/order-shipments';
import { session } from '@/lib/session';
import {
  AWAITING_COURIER_ORDER_STATUSES,
  deliveryShipments,
  returnPickups,
} from '@/lib/shipment-view';

export const metadata: Metadata = {
  title: 'Order details',
  robots: { index: false, follow: false },
};

function OrderItems({
  order,
  canReview,
  reviewStates,
  csrf,
}: {
  order: OrderDetail;
  /** Only a delivered order earns a review (the database checks the same rule). */
  canReview: boolean;
  /** Product id → the review already written, or null when there is none. Absent: not checked. */
  reviewStates: ReadonlyMap<string, ReviewStatus | null>;
  csrf: CsrfField | undefined;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Items ({itemCountLabel(order.itemCount)})</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Prices and pictures are the order's own copies, kept as they were when it was placed. */}
        <ul className="divide-y divide-border">
          {order.items.map((item) => {
            const href = productHref(item.productSlug);
            const reviewed = reviewStates.get(item.productId);
            return (
              <li key={item.orderItemId} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <ProductImage
                  image={item.image}
                  productName={item.productName}
                  decorative
                  size="sm"
                  className="w-16"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-sm font-semibold wrap-break-word text-foreground">
                      {href ? (
                        <Link href={href} className="rounded-sm underline-offset-4 hover:underline">
                          {item.productName}
                        </Link>
                      ) : (
                        item.productName
                      )}
                    </p>
                    {item.variantLabel ? (
                      <p className="text-sm text-muted-foreground">{item.variantLabel}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      Qty {item.quantity} · {formatMoney(item.unitPriceMinor)} each
                    </p>
                    {item.campaignDiscountMinor > 0 && item.regularPriceMinor !== null ? (
                      <p className="text-xs font-medium text-link">
                        {item.campaignTitle ?? 'Promotion'} · was{' '}
                        {formatMoney(item.regularPriceMinor)}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">SKU {item.sku}</p>
                    {/*
                      One action per line, and only when the order is delivered and the
                      review state is known: an offer the server would refuse is not offered,
                      and a review that exists is never invited twice.
                    */}
                    {canReview && csrf && reviewStates.has(item.productId) ? (
                      <div className="mt-1.5">
                        {reviewed === null ? (
                          <ReviewFromOrder
                            productId={item.productId}
                            productSlug={item.productSlug}
                            productName={item.productName}
                            csrf={csrf}
                          />
                        ) : reviewed === undefined ? null : (
                          <ReviewAlreadySubmitted status={reviewed} />
                        )}
                      </div>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    <span className="sr-only">Line total: </span>
                    {formatMoney(item.lineTotalMinor)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <SummaryList className="border-t border-border pt-5">
          <SummaryRow label="Subtotal">{formatMoney(order.subtotalMinor)}</SummaryRow>
          <SummaryRow label={`Delivery (${DELIVERY_ZONE_LABELS[order.deliveryZone]})`}>
            {formatMoney(order.shippingFeeMinor)}
          </SummaryRow>
          {order.discountMinor > 0 ? (
            <SummaryRow label="Discount">{formatMoney(-order.discountMinor)}</SummaryRow>
          ) : null}
          <SummaryRow label="Total" total>
            {formatMoney(order.totalMinor)}
          </SummaryRow>
        </SummaryList>
      </CardContent>
    </Card>
  );
}

function OrderTimeline({ order, note }: { order: OrderDetail; note?: string | null }) {
  const events =
    order.history.length > 0
      ? [...order.history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      : [{ fromStatus: null, toStatus: 'pending' as const, at: order.placedAt }];
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Order progress</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid">
          {events.map((event, index) => (
            <li
              // The history only grows, so an event's position is a stable key.
              key={index}
              className="relative flex gap-3 pb-5 last:pb-0"
            >
              {index < events.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border"
                />
              ) : null}
              <span
                aria-hidden="true"
                className={
                  index === events.length - 1
                    ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-primary ring-4 ring-sky-100'
                    : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-border-strong'
                }
              />
              <div className="grid gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  {ORDER_EVENT_LABELS[event.toStatus]}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={event.at}>{formatEventTime(event.at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
        {note ? (
          <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
            <Truck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {note}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const parsed = orderNumberSchema.safeParse((await params).orderNumber);
  if (!parsed.success) notFound();
  const orderNumber = parsed.data;
  const query = await searchParams;

  const read = await readAccount((api, accessToken) => api.getOrder(accessToken, orderNumber));
  if (read.kind === 'signed_out') redirect(`/login?next=/account/orders/${orderNumber}`);
  // Missing and other customers' orders look the same, so order numbers cannot be probed.
  if (read.kind === 'not_found') notFound();

  const back = <BackLink href="/account/orders">Your orders</BackLink>;
  if (read.kind === 'suspended') {
    return (
      <PageFrame>
        {back}
        <PageHeader title={`Order ${orderNumber}`} />
        <SuspendedState />
      </PageFrame>
    );
  }
  if (read.kind !== 'ok') {
    return (
      <PageFrame>
        {back}
        <PageHeader title={`Order ${orderNumber}`} />
        <UnavailableState
          title="We could not load this order"
          retryHref={`/account/orders/${orderNumber}`}
        />
      </PageFrame>
    );
  }

  const { order } = read.value;
  /*
   * A review action is offered on a delivered order only, and only for a product whose review
   * state could actually be read: the page never invites a review the server would refuse
   * (not bought, not received, already written). The eligibility rules themselves live in the
   * database function that saves the review — this only decides what to show.
   */
  // Shipments are read alongside the reviews. A pending order cannot have been booked yet.
  const shipmentsRead: Promise<readonly CustomerShipment[] | null> =
    order.status === 'pending' ? Promise.resolve(null) : readOrderShipments(order.orderNumber);
  const canReview = order.status === 'delivered';
  const reviewStates = new Map<string, ReviewStatus | null>();
  if (canReview) {
    const productIds = [...new Set(order.items.map((item) => item.productId))];
    const reads = await Promise.all(
      productIds.map(async (productId) => {
        const mine = await readAccount((api, accessToken) =>
          api.myProductReview(accessToken, productId),
        );
        return [
          productId,
          mine.kind === 'ok' ? (mine.value.review?.status ?? null) : undefined,
        ] as const;
      }),
    );
    for (const [productId, status] of reads) {
      if (status !== undefined) reviewStates.set(productId, status);
    }
  }
  const shipments = await shipmentsRead;
  const delivery = shipments === null ? [] : deliveryShipments(shipments);
  const pickups = shipments === null ? [] : returnPickups(shipments);
  // Said only when the read worked and the order may still be handed to a courier.
  const trackingNote =
    shipments !== null &&
    delivery.length === 0 &&
    (AWAITING_COURIER_ORDER_STATUSES as readonly string[]).includes(order.status)
      ? 'Courier tracking appears here once your parcel is with the courier.'
      : null;
  const reviewCsrf: CsrfField | undefined =
    reviewStates.size > 0 ? { name: CSRF_FIELD, token: await session.csrfToken() } : undefined;
  // Fixed messages chosen by known flags; query text is never displayed.
  const placed = singleParam(query, 'placed') === '1';
  const justCancelled = singleParam(query, 'cancelled') === '1' && order.status === 'cancelled';
  return (
    <PageFrame>
      {back}
      {placed ? (
        <>
          <CartClearedSignal />
          <Alert tone="success" title={`Thank you — your order ${order.orderNumber} is placed.`}>
            Pay in cash on delivery. We will confirm your order soon, and you can follow it here.
          </Alert>
        </>
      ) : null}
      {justCancelled ? <Alert tone="success">Your order has been cancelled.</Alert> : null}

      <PageHeader
        eyebrow={<OrderStatusBadge status={order.status} />}
        title={`Order ${order.orderNumber}`}
        description={
          <>
            Placed on <time dateTime={order.placedAt}>{formatLongDate(order.placedAt)}</time>
          </>
        }
        actions={
          <Link
            href={`/account/orders/${order.orderNumber}/receipt`}
            className={buttonClasses({ variant: 'outline' })}
          >
            <Receipt aria-hidden="true" />
            View receipt
          </Link>
        }
      />

      {order.status === 'cancelled' ? (
        <Alert tone="info" title="This order is cancelled">
          {order.cancelledAt ? (
            <>
              Cancelled on{' '}
              <time dateTime={order.cancelledAt}>{formatLongDate(order.cancelledAt)}</time>.{' '}
            </>
          ) : null}
          Nothing is due for it.
          {order.cancelReason ? (
            <span className="mt-1 block wrap-break-word">Reason: {order.cancelReason}</span>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="grid gap-6">
          <OrderItems
            order={order}
            canReview={canReview}
            reviewStates={reviewStates}
            csrf={reviewCsrf}
          />
          <OrderTimeline order={order} note={trackingNote} />
        </div>

        <div className="grid gap-6">
          {/* First in the side column: beside the items on wide screens, right after the
              order progress on narrow ones. The courier's status never replaces the order's. */}
          <ShipmentTrackingCard title="Delivery tracking" shipments={delivery} />
          <ShipmentTrackingCard title="Return pickup" shipments={pickups} returnLinks />
          <Card>
            <CardHeader>
              <CardTitle as="h2">Payment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Banknote aria-hidden="true" className="size-4 text-primary" />
                  Cash on Delivery
                </p>
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
              <p className="text-sm text-muted-foreground">
                {PAYMENT_STATUS_DESCRIPTIONS[order.paymentStatus]}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Delivery address</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressBlock address={order.shippingAddress} />
            </CardContent>
          </Card>

          {order.customerNote ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Your note</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line wrap-break-word text-body">
                  {order.customerNote}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {order.canCancel ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Changed your mind?</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  You can cancel while the order is awaiting confirmation. Nothing is charged.
                </p>
                <CancelOrderForm
                  action={cancelOrderAction}
                  csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
                  orderNumber={order.orderNumber}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2">Need help with this order?</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Ask us about delivery, payment or anything else. We reply in the chat, and the order
                is attached so you do not have to explain it.
              </p>
              <AskSupportButton
                label="Get help with this order"
                request={{ orderNumber: order.orderNumber, subject: `Order ${order.orderNumber}` }}
              />
            </CardContent>
          </Card>

          {order.status === 'delivered' ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Send something back</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  If something is wrong with this order, ask to send it back. Nilzora reviews the
                  request before anything is returned, and any refund is paid back by hand under
                  Cash on Delivery.
                </p>
                <Link
                  href={`/account/returns/new?order=${order.orderNumber}`}
                  className={buttonClasses({ variant: 'outline' })}
                >
                  Request a return
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}
