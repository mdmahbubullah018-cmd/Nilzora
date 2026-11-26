import {
  LOW_STOCK_THRESHOLD,
  type AdminOrderSummary,
  type AdminReviewListResponse,
  type AuditEntry,
  type DashboardResponse,
  type Permission,
} from '@nilzora/contracts';
import {
  buttonClasses,
  CartIcon,
  cn,
  EmptyState,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nilzora/ui';
import {
  Activity,
  ClipboardCheck,
  ListOrdered,
  MessageSquareQuote,
  PackageCheck,
  PackageX,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DonutChart, type DonutSegment } from '@/components/admin-kit/charts/donut-chart';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { withQuery } from '@/components/admin-kit/href';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ReadState, type ReadFailure } from '@/components/admin-kit/states';
import {
  ORDER_STATUS_CHART_TONE,
  OrderStatusBadge,
  PaymentStatusBadge,
  StockBadge,
} from '@/components/admin-kit/status-badge';
import { formatAuditAction, formatBdPhone, formatCount, formatDateTime, formatMoney, plural } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { CountText, RelativeTimeText } from '@/components/i18n/format-text';

/*
 * The overview's panels. Each takes data that has already been read and permission
 * filtered; the page decides which panels to render (see dashboard-view.tsx).
 */

const viewAll = buttonClasses({ variant: 'ghost', size: 'sm', className: 'text-link' });

function ViewAll({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link href={href} className={viewAll}>
      {children}
    </Link>
  );
}

/** A panel whose read failed: the same title, with the reason instead of figures. */
export function FailedSection({
  title,
  icon,
  failure,
  permission,
  className,
}: {
  title: string;
  icon?: typeof Activity;
  failure: ReadFailure;
  permission?: Permission;
  className?: string;
}) {
  return (
    <SectionCard title={title} icon={icon} className={className}>
      <ReadState failure={failure} permission={permission} retryHref="/admin" compact />
    </SectionCard>
  );
}

type OrderCounts = NonNullable<DashboardResponse['orders']>;

const PIPELINE = [
  { key: 'pending', label: 'To confirm', status: 'pending' },
  { key: 'confirmed', label: 'To process', status: 'confirmed' },
  { key: 'processing', label: 'To ship', status: 'processing' },
  { key: 'shipped', label: 'Out for delivery', status: 'shipped' },
] as const;

/** Open orders at each fulfilment step, plus delivered orders whose cash is not recorded. */
export function OrderPipelineSection({
  orders,
  asChart,
  className,
}: {
  orders: OrderCounts;
  /** Draw the counts as a donut (when the all-time status chart is not available). */
  asChart: boolean;
  className?: string;
}) {
  const steps = [
    ...PIPELINE.map((step) => ({
      key: step.key,
      label: step.label,
      value: orders[step.key],
      tone: ORDER_STATUS_CHART_TONE[step.status],
      href: withQuery('/admin/orders', { status: step.status }),
    })),
    {
      key: 'awaitingCollection',
      label: 'Delivered, cash pending',
      value: orders.awaitingCollection,
      tone: ORDER_STATUS_CHART_TONE.delivered,
      href: withQuery('/admin/orders', { status: 'delivered', paymentStatus: 'pending' }),
    },
  ] satisfies DonutSegment[];
  const open = steps.reduce((sum, step) => sum + step.value, 0);

  return (
    <SectionCard
      title="Open orders"
      icon={ListOrdered}
      description="Orders waiting at each step"
      actions={<ViewAll href="/admin/orders"><AutoText>All orders</AutoText></ViewAll>}
      className={className}
    >
      {open === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Nothing waiting"
          description="Every order has been delivered and its cash recorded."
          className="py-10"
        />
      ) : asChart ? (
        <DonutChart title="Open orders by step" segments={steps} centerLabel="open" />
      ) : (
        <ul className="grid gap-1">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                href={step.href}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1 truncate text-body"><AutoText value={step.label} /></span>
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    step.value > 0 ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {formatCount(step.value)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Products and stock
// ---------------------------------------------------------------------------

type StockSummary = NonNullable<DashboardResponse['stock']>;

export function LowStockSection({ stock, className }: { stock: StockSummary; className?: string }) {
  return (
    <SectionCard
      title="Low stock"
      icon={PackageX}
      description={
        stock.lowStockCount > 0
          ? `${plural(stock.lowStockCount, 'product')} on sale at ${String(LOW_STOCK_THRESHOLD)} units or fewer`
          : `Products on sale at ${String(LOW_STOCK_THRESHOLD)} units or fewer`
      }
      actions={
        stock.lowStockCount > 0 ? (
          <ViewAll href={withQuery('/admin/products', { status: 'active', stock: 'low' })}><AutoText>View all</AutoText></ViewAll>
        ) : undefined
      }
      className={className}
    >
      {stock.products.length > 0 ? (
        <ul className="grid gap-3">
          {stock.products.map((product) => {
            const level = Math.min(1, product.stockQuantity / LOW_STOCK_THRESHOLD);
            return (
              <li key={product.id} className="grid gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0">
                    <span className="truncate text-sm font-medium text-foreground">
                      {product.name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {product.sku}
                    </span>
                  </div>
                  <StockBadge quantity={product.stockQuantity} />
                </div>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        product.stockQuantity === 0 ? 'bg-danger' : 'bg-warning',
                      )}
                      style={{ width: `${String(Math.max(level * 100, 0))}%` }}
                    />
                  </span>
                  <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                    <CountText count={product.stockQuantity} one="unit" />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={PackageCheck}
          title="Stock levels are healthy"
          description={`Every product on sale has more than ${String(LOW_STOCK_THRESHOLD)} units.`}
          className="py-10"
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Content reviews
// ---------------------------------------------------------------------------

type ReviewCounts = NonNullable<DashboardResponse['moderation']>;

export function ReviewsSection({
  reviews,
  permissions,
  className,
}: {
  reviews: ReviewCounts;
  permissions: readonly Permission[];
  className?: string;
}) {
  const assigns = permissions.includes('moderation.assign');
  const reviewsInModerator =
    permissions.includes('content.approve') && permissions.includes('moderator_workspace.access');
  const rows: { key: string; label: string; value: number; href?: Route }[] = [
    {
      key: 'mine',
      label: 'Assigned to you',
      value: reviews.assignedToMe,
      ...(reviewsInModerator ? { href: '/moderator' as const } : {}),
    },
  ];
  if (reviews.unassigned !== null) {
    rows.push({
      key: 'unassigned',
      label: 'Waiting for a reviewer',
      value: reviews.unassigned,
      ...(assigns ? { href: withQuery('/admin/moderation', { scope: 'unassigned' }) } : {}),
    });
  }
  if (reviews.pending !== null) {
    rows.push({
      key: 'pending',
      label: 'Open reviews',
      value: reviews.pending,
      ...(assigns ? { href: '/admin/moderation' as const } : {}),
    });
  }

  return (
    <SectionCard
      title="Content reviews"
      icon={ClipboardCheck}
      description="Product content waiting for a moderator"
      className={className}
    >
      <ul className="grid gap-1">
        {rows.map((row) => {
          const content = (
            <>
              <span className="min-w-0 flex-1 truncate text-body"><AutoText value={row.label} /></span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  row.value > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {formatCount(row.value)}
              </span>
            </>
          );
          const rowClass = 'flex items-center gap-3 rounded-md px-2 py-2 text-sm';
          return (
            <li key={row.key}>
              {row.href ? (
                <Link
                  href={row.href}
                  className={cn(rowClass, 'transition-colors hover:bg-surface-muted')}
                >
                  {content}
                </Link>
              ) : (
                <div className={rowClass}><AutoText value={content} /></div>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Recent orders and activity
// ---------------------------------------------------------------------------

export function RecentOrdersSection({
  orders,
  now,
  className,
}: {
  orders: readonly AdminOrderSummary[];
  now: Date;
  className?: string;
}) {
  return (
    <SectionCard
      title="Recent orders"
      icon={CartIcon}
      description="The latest orders placed"
      actions={<ViewAll href="/admin/orders"><AutoText>All orders</AutoText></ViewAll>}
      flush
      className={className}
    >
      <DataTable caption="Recent orders" dense>
        <TableHeader>
          <TableRow>
            <TableHead><AutoText>Order</AutoText></TableHead>
            <TableHead><AutoText>Customer</AutoText></TableHead>
            <TableHead><AutoText>Status</AutoText></TableHead>
            <TableHead><AutoText>Payment</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Total</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Placed</AutoText></TableHead>
          </TableRow>
        </TableHeader>
        {orders.length > 0 ? (
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.orderNumber}>
                <TableCell>
                  <Link
                    href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}
                    className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
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
                <TableCell className="text-right text-muted-foreground">
                  <time dateTime={order.placedAt} title={formatDateTime(order.placedAt)}>
                    <RelativeTimeText value={order.placedAt} now={now} />
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={CartIcon}
            title="No orders yet"
            description="Orders appear here as customers place them."
          />
        )}
      </DataTable>
    </SectionCard>
  );
}

function actorName(entry: AuditEntry): string {
  if (!entry.actor) return 'A removed account';
  return entry.actor.name ?? entry.actor.email ?? 'A staff account';
}

/** A target worth showing: short references such as order numbers or zone names. */
function targetLabel(entry: AuditEntry): string | undefined {
  const type = entry.targetType.replaceAll('_', ' ');
  if (entry.targetId && entry.targetId.length <= 24) return `${type} ${entry.targetId}`;
  return undefined;
}

export function ActivitySection({
  entries,
  now,
  className,
}: {
  entries: readonly AuditEntry[];
  now: Date;
  className?: string;
}) {
  return (
    <SectionCard
      title="Recent activity"
      icon={Activity}
      description="Privileged actions from the audit log"
      actions={<ViewAll href="/admin/audit"><AutoText>Audit log</AutoText></ViewAll>}
      className={className}
    >
      {entries.length > 0 ? (
        <ol className="grid gap-4">
          {entries.map((entry) => {
            const target = targetLabel(entry);
            return (
              <li key={entry.id} className="relative flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15"
                />
                <div className="grid min-w-0 gap-0.5">
                  <p className="text-sm text-foreground">
                    <span className="font-medium"><AutoText value={actorName(entry)} /></span>
                    <span className="text-body"> · {formatAuditAction(entry.action)}</span>
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                      <RelativeTimeText value={entry.createdAt} now={now} />
                    </time>
                    {target ? <span className="truncate font-mono"><AutoText value={target} /></span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          icon={Activity}
          title="No recorded activity yet"
          description="Privileged staff actions are listed here as they happen."
          className="py-10"
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Customer reviews
// ---------------------------------------------------------------------------

/** Customer reviews waiting for a decision (reviews.moderate), newest first. */
export function PendingReviewsSection({
  reviews,
  now,
  className,
}: {
  reviews: AdminReviewListResponse;
  now: Date;
  className?: string;
}) {
  return (
    <SectionCard
      title="Customer reviews"
      icon={MessageSquareQuote}
      description={
        reviews.total > 0
          ? `${plural(reviews.total, 'review')} waiting for a decision`
          : 'Reviews customers write wait here until approved'
      }
      actions={
        reviews.total > 0 ? (
          <ViewAll href={withQuery('/admin/reviews', { status: 'pending' })}><AutoText>Moderate</AutoText></ViewAll>
        ) : undefined
      }
      className={className}
    >
      {reviews.reviews.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="All caught up"
          description="No customer review is waiting."
          className="py-10"
        />
      ) : (
        <ul className="grid gap-3">
          {reviews.reviews.map((review) => (
            <li key={review.id} className="grid gap-1 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium text-foreground">
                  {review.productName}
                </span>
                <span
                  className="shrink-0 text-xs font-semibold text-warning-ink"
                  aria-label={`${String(review.rating)} out of 5 stars`}
                >
                  {'★'.repeat(review.rating)}
                  <span aria-hidden="true" className="text-muted-foreground">
                    {'★'.repeat(5 - review.rating)}
                  </span>
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {review.title ? `${review.title} — ` : ''}
                {review.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {review.authorName ?? 'Customer'} · <RelativeTimeText value={review.createdAt} now={now} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
