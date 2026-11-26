import { VariantOptions } from './variant-options';
import type {
  AdminOrderDetail,
  AdminOrderEvent,
  AuditEntry,
  Permission,
  RefundSummary,
  ReturnDetail,
  ReturnSummary,
} from '@nilzora/contracts';
import { OrderInternalPanel } from './order-internal';
import { isOpenReturn, OrderAfterSales, OrderAuditTrail } from './order-after-sales';
import { ProductTile } from '@/components/catalog/product-tile';
import { loadOrderCourier, OrderShipmentPanel } from '@/components/shipments/order-shipment-panel';
import { orderNumberSchema } from '@nilzora/contracts';
import {
  Alert,
  buttonClasses,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nilzora/ui';
import {
  Banknote,
  FileText,
  History,
  ListChecks,
  MapPin,
  Package,
  PackageOpen,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { DataTable } from '@/components/admin-kit/data-table';
import { DetailList } from '@/components/admin-kit/detail-list';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { NotFoundState, ReadState } from '@/components/admin-kit/states';
import {
  ORDER_STATUS,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/admin-kit/status-badge';
import { Timeline, type TimelineItem, type TimelineTone } from '@/components/admin-kit/timeline';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatBdPhone, formatDateTime, formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { CodCollectionAction, OrderStatusActions } from './order-actions';
import { DELIVERY_ZONE_LABEL, ORDER_ACTOR_LABEL, ORDERS_PATH } from './order-query';
import { PrintOrderButton } from './print-order-button';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

/** The order's PDF documents (built by the API, orders.read, audited): plain download links. */
export function orderDocumentHref(
  orderNumber: string,
  document: 'invoice' | 'packing-slip',
): string {
  return `/api/orders/${orderNumber}/${document}.pdf`;
}

const DOCUMENT_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  className: 'h-9 rounded-xl max-sm:h-11',
});

const EVENT_TONE: Record<AdminOrderEvent['toStatus'], TimelineTone> = {
  pending: 'warning',
  confirmed: 'primary',
  processing: 'violet',
  shipped: 'primary',
  delivered: 'success',
  cancelled: 'danger',
};

function historyItems(order: AdminOrderDetail): TimelineItem[] {
  const items: TimelineItem[] = order.history.map((event, index) => ({
    key: `${event.at}-${String(index)}`,
    title: event.fromStatus ? ORDER_STATUS[event.toStatus].label : 'Order placed',
    at: event.at,
    actor: ORDER_ACTOR_LABEL[event.actorKind],
    note: event.note,
    tone: EVENT_TONE[event.toStatus],
  }));
  if (order.paymentCollectedAt) {
    items.push({
      key: 'payment',
      title: `Cash collected (${formatMoney(order.totalMinor)})`,
      at: order.paymentCollectedAt,
      actor: 'Staff',
      tone: 'success',
    });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** What campaign prices took off, across every unit: already inside the unit prices. */
function campaignSavings(order: AdminOrderDetail): number {
  return order.items.reduce((sum, item) => sum + item.campaignDiscountMinor * item.quantity, 0);
}

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
        {label}
      </dt>
      <dd
        className={
          strong
            ? 'text-base font-semibold text-foreground tabular-nums'
            : 'text-foreground tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}

export interface OrderDetailViewProps {
  order: AdminOrderDetail;
  permissions: readonly Permission[];
  csrf: CsrfInput;
  /** A confirmation chosen from ORDER_NOTICES after a change. */
  notice?: string | undefined;
  /** The courier / shipment section (read by the page; shown after the items). */
  courier?: ReactNode;
}

/**
 * One order, in reading order: the header (number, status, payment, placed, total), then
 * customer and delivery, items and totals, the courier section and the activity timeline,
 * with the next step and the payment in the side column.
 */
export function OrderDetailView({
  order,
  permissions,
  csrf,
  notice,
  courier,
}: OrderDetailViewProps) {
  const address = order.shippingAddress;
  const customerHref = permissions.includes('customers.read')
    ? (`/admin/customers/${order.customer.id}` as Route)
    : undefined;
  const customerName = order.customer.fullName ?? address.recipientName;
  const couponHref = permissions.includes('coupons.update')
    ? (id: string) => `/admin/coupons/${id}` as Route
    : undefined;

  return (
    <div className="grid gap-6">
      {/* On paper only: the sheet then reads as an invoice rather than a screen. */}
      <div className="nz-print-only">
        <p className="font-display text-lg font-semibold text-foreground">
          <AutoText>Nilzora</AutoText>
        </p>
        <p className="text-sm text-body">
          Invoice for order{' '}
          <span className="font-mono">
            <AutoText value={order.orderNumber} />
          </span>
        </p>
        <p className="text-sm text-body">
          Placed <DateTimeText value={order.placedAt} style="datetime" /> · {customerName} ·{' '}
          {formatBdPhone(address.phone)}
        </p>
      </div>

      <PageToolbar
        back={{ href: ORDERS_PATH, label: 'Orders' }}
        className="nz-print-hide"
        actions={
          <>
            <a
              href={orderDocumentHref(order.orderNumber, 'invoice')}
              download
              className={DOCUMENT_LINK}
            >
              <FileText aria-hidden="true" strokeWidth={1.75} />
              Invoice (PDF)
            </a>
            <a
              href={orderDocumentHref(order.orderNumber, 'packing-slip')}
              download
              className={DOCUMENT_LINK}
            >
              <PackageOpen aria-hidden="true" strokeWidth={1.75} />
              Packing slip (PDF)
            </a>
            <PrintOrderButton />
          </>
        }
        eyebrow={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </>
        }
        title={
          <span className="font-mono">
            <AutoText value={order.orderNumber} />
          </span>
        }
        meta={
          <>
            <span>
              Placed{' '}
              <time dateTime={order.placedAt}>
                <AutoText value={formatDateTime(order.placedAt)} />
              </time>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <CountText count={order.itemCount} one="item" />
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-foreground">
              <AutoText value={formatMoney(order.totalMinor)} />
            </span>
          </>
        }
      />

      {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}

      {order.status === 'cancelled' ? (
        <Alert tone="warning" title="This order was cancelled">
          {order.cancelledAt ? `Cancelled ${formatDateTime(order.cancelledAt)}. ` : null}
          {order.cancelReason ? `Reason: ${order.cancelReason}` : 'No reason was recorded.'}
        </Alert>
      ) : null}

      {/*
        Reading order: who and where, what was bought, the parcel, then what happened. The
        side column keeps the next step and the payment beside them on wide screens and
        follows the header on a phone, so the action is never far down the page.
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6 max-lg:order-2">
          <SectionCard title="Customer & delivery" icon={MapPin}>
            <DetailList
              columns={2}
              items={[
                {
                  label: 'Customer account',
                  value: customerHref ? (
                    <Link
                      href={customerHref}
                      className="font-medium text-link underline-offset-4 hover:underline"
                    >
                      {customerName}
                    </Link>
                  ) : (
                    customerName
                  ),
                },
                {
                  label: 'Account phone',
                  value: order.customer.phone ? (
                    <a
                      href={`tel:${order.customer.phone}`}
                      className="text-link underline-offset-4 hover:underline"
                    >
                      {formatBdPhone(order.customer.phone)}
                    </a>
                  ) : null,
                },
                { label: 'Recipient', value: address.recipientName },
                {
                  label: 'Recipient phone',
                  value: (
                    <a
                      href={`tel:${address.phone}`}
                      className="text-link underline-offset-4 hover:underline"
                    >
                      {formatBdPhone(address.phone)}
                    </a>
                  ),
                },
                {
                  label: 'Delivery address',
                  value: (
                    <address className="not-italic">
                      {address.addressLine}
                      <br />
                      {address.area}, {address.district}
                      {address.postalCode ? ` ${address.postalCode}` : ''}
                      <br />
                      {address.division} Division
                    </address>
                  ),
                },
                { label: 'Zone', value: DELIVERY_ZONE_LABEL[order.deliveryZone] },
                { label: 'Landmark', value: address.landmark },
                {
                  label: 'Customer note',
                  value: order.customerNote ? (
                    <span className="whitespace-pre-line">
                      <AutoText value={order.customerNote} />
                    </span>
                  ) : null,
                  wide: true,
                },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="Packing list"
            icon={Package}
            description="Exactly what to pick, as the customer ordered it: the colour, size and variant are the ones chosen at checkout."
          >
            <ol
              role="list"
              aria-label={`Packing list for order ${order.orderNumber}`}
              className="grid gap-3"
            >
              {order.items.map((item) => (
                <li
                  key={item.orderItemId}
                  className="flex items-start gap-3 rounded-xl border border-hairline bg-panel p-3"
                >
                  <ProductTile image={item.image} size="md" />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <p className="leading-snug font-semibold whitespace-normal text-foreground">
                      {item.productName}
                    </p>
                    <VariantOptions
                      options={item.variantOptions}
                      label={item.variantLabel}
                      size="lg"
                    />
                    <p className="font-mono text-xs text-muted-foreground">SKU {item.sku}</p>
                  </div>
                  <p
                    className="grid shrink-0 place-items-center rounded-lg bg-brand-navy px-3 py-1.5 text-lg leading-none font-bold text-white tabular-nums"
                    aria-label={`Quantity ${String(item.quantity)}`}
                  >
                    × {item.quantity}
                  </p>
                </li>
              ))}
            </ol>
          </SectionCard>

          <SectionCard
            title="Items"
            icon={Package}
            description=<CountText count={order.itemCount} one="item" />
            flush
          >
            <DataTable caption={`Items in order ${order.orderNumber}`} dense>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <AutoText>Product</AutoText>
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">
                    <AutoText>SKU</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Unit price</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Qty</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Line total</AutoText>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.orderItemId}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductTile image={item.image} size="md" />
                        <div className="grid min-w-0 gap-0.5">
                          <span
                            className="line-clamp-2 max-w-72 leading-snug font-medium whitespace-normal text-foreground"
                            title={item.productName}
                          >
                            {item.productName}
                          </span>
                          <VariantOptions options={item.variantOptions} label={item.variantLabel} />
                          <span className="font-mono text-xs text-muted-foreground sm:hidden">
                            {item.sku}
                          </span>
                          {item.campaignTitle && item.campaignDiscountMinor > 0 ? (
                            <span className="max-w-72 truncate text-xs text-success-ink">
                              {item.campaignTitle}: −{formatMoney(item.campaignDiscountMinor)} each
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {item.sku}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="grid justify-items-end">
                        <span>
                          <AutoText value={formatMoney(item.unitPriceMinor)} />
                        </span>
                        {item.regularPriceMinor !== null &&
                        item.regularPriceMinor > item.unitPriceMinor ? (
                          <s className="text-xs text-muted-foreground">
                            {formatMoney(item.regularPriceMinor)}
                          </s>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <AutoText value={item.quantity} />
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">
                      {formatMoney(item.lineTotalMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
            <dl className="grid gap-2 border-t border-hairline px-5 py-4 text-sm sm:px-6">
              <MoneyRow label="Subtotal" value={formatMoney(order.subtotalMinor)} />
              <MoneyRow
                label={`Delivery (${DELIVERY_ZONE_LABEL[order.deliveryZone]})`}
                value={formatMoney(order.shippingFeeMinor)}
              />
              {order.discountMinor > 0 ? (
                <MoneyRow
                  label={
                    order.coupon
                      ? `${order.coupon.isVoucher ? 'Voucher' : 'Coupon'} ${order.coupon.code}`
                      : 'Discount'
                  }
                  value={`−${formatMoney(order.discountMinor)}`}
                />
              ) : null}
              {campaignSavings(order) > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Unit prices already include {formatMoney(campaignSavings(order))} of campaign
                  savings.
                </p>
              ) : null}
              <div className="border-t border-hairline pt-2">
                <MoneyRow
                  label="Total payable (cash)"
                  value={formatMoney(order.totalMinor)}
                  strong
                />
              </div>
              {order.coupon && couponHref ? (
                <Link
                  href={couponHref(order.coupon.couponId)}
                  className="w-fit text-xs font-medium text-link underline-offset-4 hover:underline"
                >
                  Open the {order.coupon.isVoucher ? 'voucher' : 'coupon'}
                  {order.coupon.title ? ` “${order.coupon.title}”` : ''}
                </Link>
              ) : null}
            </dl>
          </SectionCard>

          {courier}

          <SectionCard
            title="Activity"
            icon={History}
            description="Every status change, who made it and any note"
          >
            {order.history.length > 0 || order.paymentCollectedAt ? (
              <Timeline
                label={`History of order ${order.orderNumber}`}
                items={historyItems(order)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <AutoText>No activity has been recorded yet.</AutoText>
              </p>
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-6 max-lg:order-1 lg:sticky lg:top-24 lg:self-start">
          <SectionCard
            title="Next steps"
            icon={ListChecks}
            description={
              order.status === 'delivered' || order.status === 'cancelled'
                ? undefined
                : 'Each step asks for confirmation. Cancelling needs a reason.'
            }
          >
            <OrderStatusActions
              orderNumber={order.orderNumber}
              status={order.status}
              allowedStatuses={order.allowedStatuses}
              csrf={csrf}
            />
          </SectionCard>

          <SectionCard title="Payment" icon={Banknote} description="Cash on Delivery">
            <div className="grid gap-4">
              <DetailList
                columns={1}
                items={[
                  { label: 'Method', value: 'Cash on Delivery' },
                  { label: 'Status', value: <PaymentStatusBadge status={order.paymentStatus} /> },
                  {
                    label:
                      order.paymentStatus === 'collected'
                        ? 'Collected'
                        : order.paymentStatus === 'cancelled'
                          ? 'Cash due'
                          : 'COD due',
                    value:
                      order.paymentStatus === 'cancelled' ? (
                        'Nothing — the order was cancelled'
                      ) : (
                        <span className="font-semibold tabular-nums">
                          {formatMoney(order.totalMinor)}
                        </span>
                      ),
                  },
                  {
                    label: 'Collected on',
                    value: order.paymentCollectedAt
                      ? formatDateTime(order.paymentCollectedAt)
                      : null,
                  },
                ]}
              />
              {order.canRecordCollection ? (
                <CodCollectionAction
                  orderNumber={order.orderNumber}
                  totalMinor={order.totalMinor}
                  csrf={csrf}
                />
              ) : order.paymentStatus === 'pending' && order.status !== 'delivered' ? (
                <p className="text-xs text-muted-foreground">
                  Cash can be recorded once the order is delivered. A courier’s status never marks
                  it paid.
                </p>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** Reads the order named in the address and renders it, or why it cannot be shown. */
export async function OrderDetailContent({
  orderNumber,
  permissions,
  csrf,
  notice,
}: {
  orderNumber: string;
  permissions: readonly Permission[];
  csrf: CsrfInput;
  notice?: string | undefined;
}) {
  const parsed = orderNumberSchema.safeParse(orderNumber);
  if (!parsed.success) {
    return (
      <section className="nz-panel rounded-2xl border">
        <NotFoundState title="Order not found" titleAs="h1" />
      </section>
    );
  }
  const path = `/admin/orders/${parsed.data}` as Route;
  // The order and its staff-only notes travel together: one round trip, not two.
  const orderNumber_ = parsed.data;
  const [result, internal] = await Promise.all([
    adminRead((api, token) => api.adminGetOrder(token, orderNumber_)),
    adminRead((api, token) => api.adminOrderInternal(token, orderNumber_)),
  ]);
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={result.kind} retryHref={path} permission="orders.read" titleAs="h1" />
      </section>
    );
  }
  // Only an order that exists has returns, refunds and an audit trail to look up.
  const canAudit = permissions.includes('audit_logs.read');
  const [returns, refunds, audit, courier] = await Promise.all([
    // The queues search by order number (a substring): only this order's rows are kept.
    adminRead((api, token) =>
      api
        .adminListReturns(token, { q: orderNumber_, pageSize: 50 })
        .then((list) => list.returns.filter((row) => row.orderNumber === orderNumber_)),
    ),
    adminRead((api, token) =>
      api
        .adminListRefunds(token, { q: orderNumber_, pageSize: 50 })
        .then((list) => list.refunds.filter((row) => row.orderNumber === orderNumber_)),
    ),
    canAudit
      ? adminRead((api, token) =>
          api.adminAuditLog(token, { action: 'order.', q: orderNumber_, pageSize: 10 }),
        )
      : Promise.resolve(null),
    loadOrderCourier(orderNumber_, permissions),
  ]);
  const openSummary =
    returns.kind === 'ok' ? returns.value.find((row) => isOpenReturn(row.status)) : undefined;
  const openReturn = openSummary
    ? await adminRead((api, token) =>
        api.adminGetReturn(token, openSummary.id).then((response) => response.return),
      )
    : null;
  return (
    <div className="grid gap-6">
      <OrderDetailView
        order={result.value.order}
        permissions={permissions}
        csrf={csrf}
        notice={notice}
        courier={
          // Courier shipments (shipments.read): nothing for other accounts.
          <OrderShipmentPanel
            data={courier}
            orderNumber={orderNumber_}
            permissions={permissions}
            csrf={csrf}
          />
        }
      />
      {internal.kind === 'ok' ? (
        <OrderInternalPanel
          orderNumber={parsed.data}
          internal={internal.value}
          canNote={permissions.includes('orders.update_status')}
          canArchive={permissions.includes('orders.cancel')}
          csrf={csrf}
        />
      ) : null}
      {returns.kind === 'ok' && refunds.kind === 'ok' ? (
        <OrderAfterSales
          orderNumber={orderNumber_}
          paymentCollected={result.value.order.paymentStatus === 'collected'}
          returns={returns.value satisfies ReturnSummary[]}
          refunds={refunds.value satisfies RefundSummary[]}
          openReturn={openReturn?.kind === 'ok' ? (openReturn.value satisfies ReturnDetail) : null}
          permissions={permissions}
          csrf={csrf}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Returns and refunds for this order could not be loaded just now. Open the{' '}
          <Link href={'/admin/returns'} className="text-link underline-offset-4 hover:underline">
            returns
          </Link>{' '}
          or{' '}
          <Link href={'/admin/refunds'} className="text-link underline-offset-4 hover:underline">
            refunds
          </Link>{' '}
          queue instead.
        </p>
      )}
      {audit?.kind === 'ok' ? (
        <OrderAuditTrail
          entries={audit.value.entries satisfies AuditEntry[]}
          total={audit.value.total}
          orderNumber={orderNumber_}
        />
      ) : null}
    </div>
  );
}
