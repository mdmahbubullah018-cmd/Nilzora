import type { AdminOrderListQuery, AdminOrderSummary } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { HandCoins, PackageCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import {
  DateFilter,
  FilterBar,
  FilterChips,
  SearchFilter,
} from '@/components/admin-kit/filter-bar';
import { withQuery } from '@/components/admin-kit/href';
import { Pagination } from '@/components/admin-kit/pagination';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin-kit/status-badge';
import { Tabs } from '@/components/admin-kit/tabs';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatBdPhone, formatDateTime, formatDayLong, formatMoney } from '@/lib/format';
import { CodCollectionAction } from './order-actions';
import { orderHref } from './orders-results';
import { AutoText } from '@/components/i18n/translate';
import { CountText, RelativeTimeText } from '@/components/i18n/format-text';

/*
 * COD collections: cash the courier took at the door and whether the store has booked
 * it. "Cash to collect" is every delivered order whose payment is still pending, oldest
 * first (the longest wait is what needs chasing); "Collected" is the orders already
 * booked. The figures come from the orders list API; nothing here is computed beyond
 * adding up the rows on the page, which says so.
 */

export const COD_PATH = '/admin/cod-collections' as Route;
export const COD_PAGE_SIZE = 25;

export type CodTab = 'collect' | 'collected';

export interface CodFilters {
  tab: CodTab;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** The orders-list filters that stand for a tab. */
export function codTabQuery(tab: CodTab): Pick<AdminOrderListQuery, 'status' | 'paymentStatus'> {
  return tab === 'collect'
    ? { status: 'delivered', paymentStatus: 'pending' }
    : { paymentStatus: 'collected' };
}

export function codHref(filters: CodFilters, page = 1): Route {
  return withQuery(COD_PATH, {
    tab: filters.tab === 'collect' ? undefined : filters.tab,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    page: page > 1 ? page : undefined,
  });
}

/**
 * The orders-list page that holds a page of the tab. "Cash to collect" is read from the
 * far end (the API lists newest first), so page 1 of the tab holds the oldest orders.
 */
export function apiPageFor(tab: CodTab, page: number, totalPages: number): number {
  return tab === 'collect' ? Math.max(1, totalPages - page + 1) : page;
}

export interface CodCollectionsViewProps {
  filters: CodFilters;
  orders: readonly AdminOrderSummary[];
  /** The figure on each tab, when its read worked. */
  counts: Partial<Record<CodTab, number>>;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  now: Date;
  csrf: CsrfInput;
  /** payments.collect: the Record cash action per row (the API checks it again). */
  canRecord: boolean;
}

/** The two tabs, the filters, and the table with its Record cash action. */
export function CodCollectionsView({
  filters,
  orders,
  counts,
  page,
  totalPages,
  total,
  pageSize,
  now,
  csrf,
  canRecord,
}: CodCollectionsViewProps) {
  const collecting = filters.tab === 'collect';
  const filtered = Boolean(filters.q || filters.from || filters.to);
  const here = codHref(filters, page);
  const pageTotal = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  const without = (key: 'q' | 'from' | 'to') => codHref({ ...filters, [key]: undefined });

  return (
    <GlassTable
      label={collecting ? 'Cash to collect' : 'Collected cash'}
      header={
        <>
          <Tabs
            label="Cash collection"
            current={filters.tab}
            items={[
              {
                key: 'collect',
                label: 'Cash to collect',
                href: codHref({ ...filters, tab: 'collect' }),
                ...(counts.collect === undefined ? {} : { count: counts.collect }),
              },
              {
                key: 'collected',
                label: 'Collected',
                href: codHref({ ...filters, tab: 'collected' }),
                ...(counts.collected === undefined ? {} : { count: counts.collected }),
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            {collecting
              ? 'Delivered orders whose cash has not been booked yet, oldest first.'
              : 'Orders whose cash has been recorded as collected.'}
          </p>
          <FilterBar
            action={COD_PATH}
            hidden={{ tab: filters.tab === 'collect' ? undefined : filters.tab }}
            resetHref={filtered ? codHref({ tab: filters.tab }) : undefined}
            label="Cash collection filters"
          >
            <SearchFilter
              label="Search"
              defaultValue={filters.q}
              placeholder="Order number, phone or name"
            />
            <DateFilter name="from" label="Placed from" defaultValue={filters.from} />
            <DateFilter name="to" label="Placed to" defaultValue={filters.to} />
          </FilterBar>
          <FilterChips
            chips={[
              ...(filters.q
                ? [{ key: 'q', label: `Search: “${filters.q}”`, removeHref: without('q') }]
                : []),
              ...(filters.from
                ? [
                    {
                      key: 'from',
                      label: `From ${formatDayLong(filters.from)}`,
                      removeHref: without('from'),
                    },
                  ]
                : []),
              ...(filters.to
                ? [
                    {
                      key: 'to',
                      label: `To ${formatDayLong(filters.to)}`,
                      removeHref: without('to'),
                    },
                  ]
                : []),
            ]}
            clearHref={codHref({ tab: filters.tab })}
          />
        </>
      }
      footer={
        total > 0 ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
              <CountText count={orders.length} one="order" /> on this page add up to{' '}
              <span className="font-semibold text-foreground"><AutoText value={formatMoney(pageTotal)} /></span>.
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              noun="orders"
              hrefFor={(next) => codHref(filters, next)}
            />
          </div>
        ) : undefined
      }
    >
      <DataTable caption={collecting ? 'Cash to collect' : 'Collected cash'} dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Order</AutoText></TableHead>
            <TableHead><AutoText>Placed</AutoText></TableHead>
            <TableHead><AutoText>Customer</AutoText></TableHead>
            <TableHead><AutoText>Status</AutoText></TableHead>
            <TableHead><AutoText>Payment</AutoText></TableHead>
            <TableHead className="text-right">{collecting ? 'Cash due' : 'Amount'}</TableHead>
            {collecting && canRecord ? (
              <TableHead>
                <span className="sr-only"><AutoText>Actions</AutoText></span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        {orders.length > 0 ? (
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.orderNumber}>
                <TableCell>
                  <Link
                    href={orderHref(order.orderNumber)}
                    className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <time dateTime={order.placedAt} title={formatDateTime(order.placedAt)}>
                    <RelativeTimeText value={order.placedAt} now={now} />
                  </time>
                </TableCell>
                <TableCell>
                  <div className="grid">
                    <span className="max-w-48 truncate text-foreground"><AutoText value={order.recipientName} /></span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatBdPhone(order.phone)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <OrderStatusBadge status={order.status} />
                </TableCell>
                <TableCell>
                  <PaymentStatusBadge status={order.paymentStatus} />
                </TableCell>
                <TableCell className="text-right font-semibold text-foreground tabular-nums">
                  {formatMoney(order.totalMinor)}
                </TableCell>
                {collecting && canRecord ? (
                  <TableCell className="text-right">
                    <CodCollectionAction
                      orderNumber={order.orderNumber}
                      totalMinor={order.totalMinor}
                      csrf={csrf}
                      compact
                      returnTo={here}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={collecting && canRecord ? 7 : 6}
            icon={collecting ? HandCoins : PackageCheck}
            title={
              filtered
                ? 'No orders match these filters'
                : collecting
                  ? 'No cash waiting to be collected'
                  : 'No cash has been collected yet'
            }
            description={
              filtered
                ? 'Try another search or date range.'
                : collecting
                  ? 'Delivered orders appear here until their cash is recorded.'
                  : 'Orders appear here once their cash is recorded as collected.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}
