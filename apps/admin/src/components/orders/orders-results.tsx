import {
  DELIVERY_ZONES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type AdminOrderListResponse,
  type AdminOrderSummary,
  type Permission,
} from '@nilzora/contracts';
import { CartIcon, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import {
  DateFilter,
  FilterBar,
  FilterChips,
  SearchFilter,
  SelectFilter,
} from '@/components/admin-kit/filter-bar';
import { Pagination } from '@/components/admin-kit/pagination';
import { adminRead } from '@/components/admin-kit/read';
import { ReadState } from '@/components/admin-kit/states';
import {
  ORDER_STATUS,
  OrderStatusBadge,
  PAYMENT_STATUS,
  PaymentStatusBadge,
} from '@/components/admin-kit/status-badge';
import { Chip } from '@/components/admin-kit/chip';
import { Tabs } from '@/components/admin-kit/tabs';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { ShipmentStatusChip, TestChip } from '@/components/shipments/shipment-chips';
import { providerName } from '@/components/shipments/shipment-labels';
import { formatBdPhone, formatDateTime, formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { BulkOrderBar } from './bulk-order-bar';
import { OrderDiscountNote, OrderLinesPreview } from './order-lines';
import {
  DELIVERY_ZONE_LABEL,
  hasOrderFilters,
  ORDER_SORT_LABEL,
  ORDER_SORTS,
  orderFilterChips,
  orderListQuery,
  ordersHref,
  ORDERS_PATH,
  type OrderFilters,
} from './order-query';
import { OrderRowCheckbox, OrderSelectionProvider, SelectPageCheckbox } from './order-selection';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

export function orderHref(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

const paymentOptions = PAYMENT_STATUSES.map((value) => ({
  value,
  label: PAYMENT_STATUS[value].label,
}));

const zoneOptions = DELIVERY_ZONES.map((value) => ({ value, label: DELIVERY_ZONE_LABEL[value] }));

// "Newest first" is the default, so it is the select's empty choice.
const sortOptions = ORDER_SORTS.filter((sort) => sort !== 'newest').map((value) => ({
  value,
  label: ORDER_SORT_LABEL[value],
}));

/** The order's latest delivery parcel: courier status, courier, and what needs a look. */
export function OrderShipmentCell({
  shipment,
}: {
  shipment: NonNullable<AdminOrderSummary['shipment']>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ShipmentStatusChip status={shipment.status} />
      <span className="text-xs text-muted-foreground">
        {shipment.providerName || providerName(shipment.provider)}
      </span>
      {shipment.isMock ? <TestChip /> : null}
      {shipment.bookingUncertain ? (
        <Chip tone="warning" title="The courier did not answer this booking clearly">
          <AutoText>Check portal</AutoText>
        </Chip>
      ) : null}
    </div>
  );
}

export type StatusCounts = Partial<Record<'all' | (typeof ORDER_STATUSES)[number], number>>;

/** The status tabs; a count is shown only when the API gave one. */
export function OrderStatusTabs({
  filters,
  counts = {},
}: {
  filters: OrderFilters;
  counts?: StatusCounts;
}) {
  return (
    <Tabs
      label="Order status"
      current={filters.status ?? 'all'}
      items={[
        {
          key: 'all',
          label: 'All orders',
          href: ordersHref({ ...filters, status: undefined }),
          ...(counts.all === undefined ? {} : { count: counts.all }),
        },
        ...ORDER_STATUSES.map((status) => ({
          key: status,
          label: ORDER_STATUS[status].label,
          href: ordersHref({ ...filters, status }),
          ...(counts[status] === undefined ? {} : { count: counts[status] }),
        })),
      ]}
    />
  );
}

/** The search, payment and date filters; the tab and customer filter ride along. */
export function OrderFilterBar({ filters }: { filters: OrderFilters }) {
  return (
    <FilterBar
      action={ORDERS_PATH}
      // Keeps the tab, the customer filter (set from a customer page) and the archive view.
      hidden={{ customerId: filters.customerId, status: filters.status, view: filters.view }}
      resetHref={hasOrderFilters(filters) ? ORDERS_PATH : undefined}
      label="Order filters"
    >
      <SearchFilter
        label="Search"
        defaultValue={filters.q}
        placeholder="Order number, phone or name"
      />
      <SelectFilter
        name="paymentStatus"
        label="Payment"
        options={paymentOptions}
        defaultValue={filters.paymentStatus}
        allLabel="All payments"
      />
      <SelectFilter
        name="deliveryZone"
        label="Zone"
        options={zoneOptions}
        defaultValue={filters.deliveryZone}
        allLabel="All zones"
      />
      <DateFilter name="from" label="Placed from" defaultValue={filters.from} />
      <DateFilter name="to" label="Placed to" defaultValue={filters.to} />
      <SelectFilter
        name="sort"
        label="Sort by"
        options={sortOptions}
        defaultValue={filters.sort}
        allLabel={ORDER_SORT_LABEL.newest}
      />
    </FilterBar>
  );
}

export interface OrdersBulkProps {
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

export function OrdersTable({
  data,
  filters,
  now,
  counts,
  chips,
  bulk,
}: {
  data: AdminOrderListResponse;
  filters: OrderFilters;
  now: Date;
  counts?: StatusCounts;
  /** The filters in effect as removable chips (named by the page; see OrdersResults). */
  chips?: ReactNode;
  /** Selection and bulk actions (the orders page); without it the list is read-only. */
  bulk?: OrdersBulkProps | undefined;
}) {
  const filtered = hasOrderFilters(filters);
  const selectable = Boolean(bulk);
  // The courier column appears only when an order on this page has a parcel to show.
  const showCourier = data.orders.some((order) => order.shipment);
  const columns = 7 + (selectable ? 1 : 0) + (showCourier ? 1 : 0);
  const table = (
    <GlassTable
      label="Orders"
      header={
        <>
          <OrderStatusTabs filters={filters} counts={counts} />
          <OrderFilterBar filters={filters} />
          {chips}
        </>
      }
      footer={
        data.total > 0 ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            noun="orders"
            hrefFor={(page) => ordersHref(filters, page)}
          />
        ) : undefined
      }
    >
      <DataTable
        caption="Orders"
        dense
        // On a phone the same orders read as a list (below); the table returns from md up.
        className={data.orders.length > 0 ? 'max-md:hidden' : undefined}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable ? (
              <TableHead className="w-12">
                <SelectPageCheckbox />
              </TableHead>
            ) : null}
            <TableHead>
              <AutoText>Order</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Items</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Customer</AutoText>
            </TableHead>
            <TableHead className="hidden 2xl:table-cell">
              <AutoText>Zone</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Status</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Payment</AutoText>
            </TableHead>
            {showCourier ? (
              <TableHead>
                <AutoText>Courier</AutoText>
              </TableHead>
            ) : null}
            <TableHead className="text-right">
              <AutoText>Total</AutoText>
            </TableHead>
          </TableRow>
        </TableHeader>
        {data.orders.length > 0 ? (
          <TableBody>
            {data.orders.map((order) => (
              <TableRow
                key={order.orderNumber}
                className="has-[[data-order-select]:checked]:bg-info-soft/60"
              >
                {selectable ? (
                  <TableCell className="w-12 align-top">
                    <OrderRowCheckbox orderNumber={order.orderNumber} />
                  </TableCell>
                ) : null}
                <TableCell className="align-top">
                  <div className="grid gap-0.5">
                    <Link
                      href={orderHref(order.orderNumber)}
                      className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <time
                      dateTime={order.placedAt}
                      title={formatDateTime(order.placedAt)}
                      className="text-xs text-muted-foreground"
                    >
                      <RelativeTimeText value={order.placedAt} now={now} />
                    </time>
                  </div>
                </TableCell>
                <TableCell>
                  <OrderLinesPreview preview={order.preview} itemCount={order.itemCount} />
                </TableCell>
                <TableCell className="align-top">
                  <div className="grid">
                    <span className="max-w-36 truncate text-foreground" title={order.recipientName}>
                      {order.recipientName}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatBdPhone(order.phone)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden align-top text-muted-foreground 2xl:table-cell">
                  {DELIVERY_ZONE_LABEL[order.deliveryZone]}
                </TableCell>
                <TableCell className="align-top">
                  <OrderStatusBadge status={order.status} />
                </TableCell>
                <TableCell className="align-top">
                  <PaymentStatusBadge status={order.paymentStatus} />
                </TableCell>
                {showCourier ? (
                  <TableCell className="align-top">
                    {order.shipment ? (
                      <OrderShipmentCell shipment={order.shipment} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        <AutoText>Not booked</AutoText>
                      </span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-right align-top">
                  <div className="grid justify-items-end gap-0.5">
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatMoney(order.totalMinor)}
                    </span>
                    <OrderDiscountNote discountMinor={order.discountMinor} coupon={order.coupon} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={columns}
            icon={CartIcon}
            title={filtered ? 'No orders match these filters' : 'No orders yet'}
            description={
              filtered
                ? 'Try a different status, zone, date range or search.'
                : 'Orders appear here as customers place them.'
            }
            action={
              filtered ? (
                <Link
                  href={ORDERS_PATH}
                  className="text-sm font-medium text-link underline-offset-4 hover:underline"
                >
                  <AutoText>Clear filters</AutoText>
                </Link>
              ) : undefined
            }
          />
        )}
      </DataTable>
      {data.orders.length > 0 ? (
        <ul aria-label="Orders" className="divide-y divide-hairline md:hidden">
          {data.orders.map((order) => (
            <li
              key={order.orderNumber}
              className="relative grid gap-3 px-4 py-4 has-[[data-order-select]:checked]:bg-info-soft/60"
            >
              <div className="flex items-start gap-3">
                {selectable ? <OrderRowCheckbox orderNumber={order.orderNumber} /> : null}
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-0.5">
                    <Link
                      href={orderHref(order.orderNumber)}
                      className="font-mono text-sm font-semibold text-link underline-offset-4 after:absolute after:inset-0 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">
                      <time dateTime={order.placedAt}>
                        <RelativeTimeText value={order.placedAt} now={now} />
                      </time>
                      {' · '}
                      {order.recipientName}
                      {' · '}
                      {DELIVERY_ZONE_LABEL[order.deliveryZone]}
                    </span>
                  </div>
                  <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatMoney(order.totalMinor)}
                    </span>
                    <OrderDiscountNote discountMinor={order.discountMinor} coupon={order.coupon} />
                  </div>
                </div>
              </div>
              <OrderLinesPreview preview={order.preview} itemCount={order.itemCount} />
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.paymentStatus} />
                {order.shipment ? <OrderShipmentCell shipment={order.shipment} /> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </GlassTable>
  );

  if (!bulk) return table;
  return (
    <OrderSelectionProvider pageOrders={data.orders.map((order) => order.orderNumber)}>
      <div className="grid gap-4">
        {table}
        <BulkOrderBar permissions={bulk.permissions} csrf={bulk.csrf} />
      </div>
    </OrderSelectionProvider>
  );
}

/** The name of the customer the list is filtered to, when this account may see it. */
async function customerName(customerId: string | undefined, canRead: boolean) {
  if (!customerId || !canRead) return { kind: 'skipped' as const };
  return adminRead((api, token) => api.adminGetCustomer(token, customerId));
}

/**
 * How many orders each status tab holds under the other filters. Each count is its own
 * read; one that fails leaves its tab without a figure (the list itself is unaffected).
 */
async function statusCounts(filters: OrderFilters): Promise<StatusCounts> {
  const keys = ['all', ...ORDER_STATUSES] as const;
  const reads = await Promise.all(
    keys.map((key) =>
      adminRead((api, token) =>
        api
          .adminListOrders(token, {
            ...orderListQuery({ ...filters, status: key === 'all' ? undefined : key, page: 1 }),
            pageSize: 1,
          })
          .then((response) => response.total),
      ),
    ),
  );
  const counts: StatusCounts = {};
  keys.forEach((key, index) => {
    const read = reads[index];
    if (read?.kind === 'ok') counts[key] = read.value;
  });
  return counts;
}

/**
 * Reads one page of orders (and the figures on the status tabs) for the filters and
 * renders the tabs, filters and table, or why it cannot be shown.
 */
export async function OrdersResults({
  filters,
  page,
  now,
  canReadCustomers = false,
  bulk,
}: {
  filters: OrderFilters;
  page: number;
  now: Date;
  /** customers.read: the customer filter's chip then names the customer. */
  canReadCustomers?: boolean;
  /** The account's permissions and CSRF field: turns on selection and bulk actions. */
  bulk?: OrdersBulkProps;
}) {
  const [result, customer, counts] = await Promise.all([
    adminRead((api, token) => api.adminListOrders(token, orderListQuery({ ...filters, page }))),
    customerName(filters.customerId, canReadCustomers),
    statusCounts(filters),
  ]);
  if (result.kind === 'signed_out' || customer.kind === 'signed_out') {
    redirect(signInPath(ORDERS_PATH));
  }
  const name =
    customer.kind === 'ok'
      ? (customer.value.customer.fullName ?? customer.value.customer.email)
      : undefined;
  const chips = <FilterChips chips={orderFilterChips(filters, name)} clearHref={ORDERS_PATH} />;
  if (result.kind !== 'ok') {
    return (
      <div className="grid gap-4">
        {chips}
        <section className="nz-panel rounded-2xl border">
          <ReadState
            failure={result.kind}
            retryHref={ordersHref(filters, page)}
            resetHref={ORDERS_PATH}
            permission="orders.read"
          />
        </section>
      </div>
    );
  }
  return (
    <OrdersTable
      data={result.value}
      filters={filters}
      now={now}
      counts={counts}
      chips={chips}
      bulk={bulk}
    />
  );
}
