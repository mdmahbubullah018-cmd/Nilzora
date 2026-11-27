import type { CheckoutDetail, CheckoutRecoveryMetrics, CheckoutSummary } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { PackageX, ShoppingBag } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Chip,
  DataTable,
  DetailList,
  FilterBar,
  Pagination,
  SearchFilter,
  SectionCard,
  Tabs,
  withQuery,
  type StatusTone,
} from '@/components/admin-kit';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { CheckoutRecoveryPanel } from './recovery-panel';
import { formatDateTime, formatMoney } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

/**
 * The labels staff see. A cart that was never taken to checkout is not on this page at
 * all, and an attempt is called incomplete only once it went quiet past the store's
 * configured inactivity window, which the database decides.
 */
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  started: { label: 'In progress', tone: 'primary' },
  incomplete: { label: 'Left before ordering', tone: 'warning' },
  converted: { label: 'Became an order', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function checkoutStatusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

export function CheckoutStageChip({ status }: { status: string }) {
  const style = STATUS[status];
  return (
    <Chip tone={style?.tone ?? 'neutral'} dot>
      {style?.label ?? status}
    </Chip>
  );
}

const CHECKOUTS_PATH = '/admin/checkouts' as Route;

/** How the recovery conversation is going. Conversion is shown as a stage, not a state. */
const RECOVERY: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: 'Needs contact', tone: 'warning' },
  contacted: { label: 'Contacted', tone: 'primary' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export function CheckoutRecoveryChip({ state, recovered }: { state: string; recovered: boolean }) {
  if (recovered) {
    return (
      <Chip tone="success" dot>
        Recovered
      </Chip>
    );
  }
  const style = RECOVERY[state];
  return (
    <Chip tone={style?.tone ?? 'neutral'} dot>
      {style?.label ?? state}
    </Chip>
  );
}

export interface CheckoutFilters {
  status: string;
  q: string;
  from: string;
  to: string;
  sort: string;
}

export function checkoutsHref(filters: CheckoutFilters, page = 1): Route {
  return withQuery(CHECKOUTS_PATH, {
    status: filters.status === 'all' ? undefined : filters.status,
    q: filters.q === '' ? undefined : filters.q,
    from: filters.from === '' ? undefined : filters.from,
    to: filters.to === '' ? undefined : filters.to,
    sort: filters.sort === 'recent' ? undefined : filters.sort,
    page: page > 1 ? page : undefined,
  });
}

/** The queue: the summary figures, stage tabs, filters, one row per attempt, and page links. */
export function CheckoutListView({
  checkouts,
  metrics,
  filters,
  page,
  totalPages,
  total,
  pageSize = 25,
}: {
  checkouts: readonly CheckoutSummary[];
  metrics: CheckoutRecoveryMetrics | null;
  filters: CheckoutFilters;
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
}) {
  const { status, q } = filters;
  const filtered = status !== 'all' || q !== '' || filters.from !== '' || filters.to !== '';
  const href = (next: Partial<CheckoutFilters>, nextPage = 1) =>
    checkoutsHref({ ...filters, ...next }, nextPage);

  return (
    <div className="grid gap-6">
      <CheckoutMetricsPanel metrics={metrics} />

      <SectionCard
        title={`Checkout attempts (${String(total)})`}
        icon={PackageX}
        description="Customers who started a checkout. Nothing here is a sale, and a cart is never called abandoned just for existing."
        className="nz-panel-strong"
        flush
      >
        <div className="grid gap-4 border-b border-hairline px-5 pb-4 sm:px-6">
          <Tabs
            label="Checkout stage"
            current={status}
            items={[
              { key: 'all', label: 'All', href: href({ status: 'all' }) },
              ...Object.entries(STATUS).map(([key, style]) => ({
                key,
                label: style.label,
                href: href({ status: key }),
              })),
            ]}
          />
          <FilterBar
            action={CHECKOUTS_PATH}
            label="Search checkouts"
            hidden={{
              status: status === 'all' ? undefined : status,
              sort: filters.sort === 'recent' ? undefined : filters.sort,
            }}
            resetHref={filtered ? CHECKOUTS_PATH : undefined}
          >
            <SearchFilter label="Search" defaultValue={q} placeholder="Name, phone, order number" />
            <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
              <AutoText>Abandoned from</AutoText>
              <input
                type="date"
                name="from"
                defaultValue={filters.from}
                className="min-h-9 rounded-lg border border-hairline bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
              <AutoText>To</AutoText>
              <input
                type="date"
                name="to"
                defaultValue={filters.to}
                className="min-h-9 rounded-lg border border-hairline bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
              <AutoText>Sort</AutoText>
              <select
                name="sort"
                defaultValue={filters.sort}
                className="min-h-9 rounded-lg border border-hairline bg-surface px-2 text-sm text-foreground"
              >
                <option value="recent">Latest activity</option>
                <option value="started">When checkout started</option>
                <option value="value">Cart value</option>
              </select>
            </label>
          </FilterBar>
        </div>

        {checkouts.length === 0 ? (
          <EmptyPanel
            icon={ShoppingBag}
            title="No checkout attempts match this view."
            description={
              filtered
                ? 'Try another stage or search.'
                : 'Attempts appear here once customers start a checkout.'
            }
            className="py-14"
          />
        ) : (
          <div className="nz-sticky-head lg:[&>div]:max-h-[min(72vh,52rem)] lg:[&>div]:overflow-y-auto">
            <DataTable caption="Checkout attempts" dense>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    <AutoText>Customer</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Stage</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Recovery</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Items</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Cart value</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Contacts</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Abandoned</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Last activity</AutoText>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkouts.map((checkout) => (
                  <TableRow key={checkout.id}>
                    <TableCell>
                      <Link
                        href={`/admin/checkouts/${checkout.id}` as Route}
                        className="font-medium text-foreground underline-offset-4 hover:text-link hover:underline"
                      >
                        {checkout.customerName ?? 'Customer'}
                      </Link>
                      {checkout.customerPhone ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {checkout.customerPhone}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CheckoutStageChip status={checkout.status} />
                        {checkout.orderNumber ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {checkout.orderNumber}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <CheckoutRecoveryChip
                        state={checkout.recoveryState}
                        recovered={checkout.status === 'converted' && checkout.abandonedAt !== null}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <AutoText value={checkout.itemCount} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(checkout.cartValueMinor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {checkout.attemptCount === 0 ? (
                        '—'
                      ) : (
                        <AutoText value={checkout.attemptCount} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {checkout.abandonedAt ? (
                        <DateTimeText value={checkout.abandonedAt} style="datetime" />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <DateTimeText value={checkout.lastActivityAt} style="datetime" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          </div>
        )}

        {total > 0 ? (
          <div className="border-t border-hairline px-4 py-3 sm:px-5">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              noun="checkout attempts"
              hrefFor={(next) => checkoutsHref(filters, next)}
            />
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

/**
 * The figures staff triage with. Every number comes from admin_checkout_recovery_metrics, so
 * the definition of "abandoned", "recovered" and the rate is the database's, not the browser's.
 */
function CheckoutMetricsPanel({ metrics }: { metrics: CheckoutRecoveryMetrics | null }) {
  if (metrics === null) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        <AutoText>The summary figures are not available right now.</AutoText>
      </p>
    );
  }
  const cards = [
    {
      label: 'Waiting for a decision',
      value: String(metrics.openCount),
      hint: 'Abandoned and not yet ordered',
    },
    {
      label: 'Abandoned in this period',
      value: String(metrics.abandonedCount),
      hint: 'Checkouts that went quiet',
    },
    {
      label: 'Abandoned in the last 24 hours',
      value: String(metrics.recentCount),
      hint: 'Worth contacting first',
    },
    {
      label: 'Cart value waiting',
      value: formatMoney(metrics.potentialValueMinor),
      hint: 'Catalogue prices, not a sale',
    },
    { label: 'Contact attempts', value: String(metrics.attemptCount), hint: 'Recorded by staff' },
    { label: 'Recovered', value: String(metrics.recoveredCount), hint: 'Later became an order' },
    {
      label: 'Recovery rate',
      value:
        metrics.recoveryRatePercent === null ? '—' : `${metrics.recoveryRatePercent.toFixed(1)}%`,
      hint: 'Of what was abandoned here',
    },
  ];
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Abandoned checkout summary"
    >
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-hairline bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <AutoText>{card.label}</AutoText>
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{card.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <AutoText>{card.hint}</AutoText>
          </p>
        </div>
      ))}
      {metrics.trackingSince === null ? null : (
        <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
          <AutoText>Checkout tracking started</AutoText>{' '}
          <DateTimeText value={metrics.trackingSince} style="datetime" />.{' '}
          <AutoText>Anything before that was never recorded and is not counted.</AutoText>
        </p>
      )}
    </section>
  );
}

/**
 * One attempt. The amounts shown are the catalog's current prices and are labelled as such,
 * because a checkout has no agreed total until an order exists.
 */
export function CheckoutDetailView({
  checkout,
  csrf,
  storefrontUrl,
  canAct,
}: {
  checkout: CheckoutDetail;
  csrf: CsrfInput;
  storefrontUrl: string;
  canAct: boolean;
}) {
  const linesMinor = checkout.items.reduce(
    (total, item) => total + item.unitPriceMinor * item.quantity,
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <SectionCard
        title="What the cart held"
        icon={ShoppingBag}
        description="At the catalog's current prices. No total is agreed until the order is placed."
        flush
        className="min-w-0"
      >
        {checkout.items.length === 0 ? (
          <EmptyPanel
            icon={ShoppingBag}
            title="The cart was emptied before this attempt ended."
            className="py-10"
          />
        ) : (
          <div className="grid gap-3">
            <DataTable caption="Items in this checkout attempt" dense>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    <AutoText>Product</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>Option</AutoText>
                  </TableHead>
                  <TableHead>
                    <AutoText>SKU</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Qty</AutoText>
                  </TableHead>
                  <TableHead className="text-right">
                    <AutoText>Current price</AutoText>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkout.items.map((item) => (
                  <TableRow key={`${item.sku}-${item.variantLabel ?? 'base'}`}>
                    <TableCell className="font-medium text-foreground">
                      {item.productName}
                    </TableCell>
                    <TableCell>{item.variantLabel ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <AutoText value={item.sku} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <AutoText value={item.quantity} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.unitPriceMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
            <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
              Current line value {formatMoney(linesMinor)} — for context only.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={checkout.customerName ?? 'Checkout attempt'}
        icon={PackageX}
        actions={<CheckoutStageChip status={checkout.status} />}
      >
        <DetailList
          columns={1}
          items={[
            {
              label: 'Stage',
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <CheckoutStageChip status={checkout.status} />
                  <CheckoutRecoveryChip
                    state={checkout.recoveryState}
                    recovered={checkout.status === 'converted' && checkout.abandonedAt !== null}
                  />
                </span>
              ),
            },
            { label: 'Items', value: String(checkout.itemCount) },
            { label: 'Cart value', value: formatMoney(checkout.cartValueMinor) },
            { label: 'Started', value: formatDateTime(checkout.startedAt) },
            {
              label: 'Abandoned',
              value: checkout.abandonedAt ? formatDateTime(checkout.abandonedAt) : null,
            },
            { label: 'Last activity', value: formatDateTime(checkout.lastActivityAt) },
            {
              label: 'Coupon tried',
              value: checkout.couponCode ? (
                <span className="font-mono text-xs">
                  <AutoText value={checkout.couponCode} />
                </span>
              ) : null,
            },
            {
              label: 'Order',
              value: checkout.orderNumber ? (
                <>
                  <Link
                    href={`/admin/orders/${checkout.orderNumber}` as Route}
                    className="font-mono font-medium text-link underline-offset-4 hover:underline"
                  >
                    {checkout.orderNumber}
                  </Link>
                  {checkout.convertedAt ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      <DateTimeText value={checkout.convertedAt} style="datetime" />
                    </span>
                  ) : null}
                </>
              ) : (
                'Not ordered'
              ),
            },
            ...(checkout.customer
              ? [
                  { label: 'Customer', value: checkout.customer.name ?? null },
                  { label: 'Phone', value: checkout.customer.phone ?? null },
                ]
              : []),
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Recovery"
        icon={PackageX}
        description="Record what was done. Nilzora does not send messages on your behalf."
        className="lg:col-span-2"
      >
        <CheckoutRecoveryPanel
          checkout={checkout}
          csrf={csrf}
          storefrontUrl={storefrontUrl}
          canAct={canAct}
        />
      </SectionCard>
    </div>
  );
}
