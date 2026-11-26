import type { AdminCoupon, CouponRedemption, CouponState } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, buttonClasses } from '@nilzora/ui';
import { TicketPercent } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Chip,
  DataTable,
  DataTableEmpty,
  FilterBar,
  FilterChips,
  Pagination,
  SearchFilter,
  SelectFilter,
  type StatusTone,
} from '@/components/admin-kit';
import { withQuery } from '@/components/admin-kit/href';
import { KpiCard } from '@/components/admin-kit/kpi-card';
import { SectionCard } from '@/components/admin-kit/section-card';
import { formatCount, formatDateTime, formatMoney } from '@/lib/format';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel, GlassTable } from '@/components/catalog/catalog-ui';
import { CouponActiveToggle } from './coupon-active-toggle';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

/*
 * The coupon screens. Everything shown is what the API returned: the state, the usage
 * counts and the discounts are all derived from redemption rows, never guessed here.
 */

export const COUPONS_PATH = '/admin/coupons' as Route;

/** One coupon's page. */
export function couponHref(couponId: string): Route {
  return `/admin/coupons/${couponId}` as Route;
}

/** One coupon's edit form. */
export function editCouponHref(couponId: string): Route {
  return `/admin/coupons/${couponId}/edit` as Route;
}

const STATE_STYLE: Record<CouponState, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'primary' },
  expired: { label: 'Expired', tone: 'neutral' },
  inactive: { label: 'Inactive', tone: 'warning' },
  exhausted: { label: 'Used up', tone: 'danger' },
};

/** "10% off (up to ৳500)" or "৳100 off". */
export function couponValueLabel(
  coupon: Pick<AdminCoupon, 'kind' | 'value' | 'maxDiscountMinor'>,
): string {
  if (coupon.kind === 'free_delivery') return 'Free delivery';
  if (coupon.kind === 'fixed') return `${formatMoney(coupon.value)} off`;
  const cap =
    coupon.maxDiscountMinor === null ? '' : ` (up to ${formatMoney(coupon.maxDiscountMinor)})`;
  return `${String(coupon.value)}% off${cap}`;
}

export function CouponStateBadge({ state }: { state: CouponState }) {
  const style = STATE_STYLE[state];
  return (
    <Chip tone={style.tone} dot>
      {style.label}
    </Chip>
  );
}

export interface CouponFilters {
  q?: string | undefined;
  state?: AdminCouponFiltersState | undefined;
}

type AdminCouponFiltersState = 'active' | 'scheduled' | 'expired' | 'inactive' | 'exhausted';

export function couponListHref(filters: CouponFilters, page = 1): Route {
  return withQuery(COUPONS_PATH, {
    q: filters.q,
    state: filters.state,
    page: page > 1 ? page : undefined,
  });
}

export interface CouponListViewProps {
  coupons: readonly AdminCoupon[];
  filters: CouponFilters;
  page: number;
  total: number;
  totalPages: number;
  pageSize: number;
}

/** The coupon list: figures across all coupons, filters, the table and paging. */
export function CouponListView({
  coupons,
  filters,
  page,
  total,
  totalPages,
  pageSize,
}: CouponListViewProps) {
  const used = coupons.reduce((sum, coupon) => sum + coupon.redemptionCount, 0);
  const given = coupons.reduce((sum, coupon) => sum + coupon.totalDiscountMinor, 0);
  const live = coupons.filter((coupon) => coupon.state === 'active').length;
  const filtered = Boolean(filters.q || filters.state);

  return (
    <div className="grid gap-6">
      <section aria-label="Coupon summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Coupons"
          value={formatCount(total)}
          icon={TicketPercent}
          tone="primary"
          footnote="Matching the filters below"
        />
        <KpiCard
          label="Live now"
          value={formatCount(live)}
          icon={TicketPercent}
          tone="success"
          footnote="On this page, inside their dates and under their limits"
        />
        <KpiCard
          label="Redemptions"
          value={formatCount(used)}
          icon={TicketPercent}
          tone="violet"
          footnote="On this page"
        />
        <KpiCard
          label="Discount given"
          value={formatMoney(given)}
          icon={TicketPercent}
          tone="warning"
          footnote="On this page"
        />
      </section>

      <GlassTable
        label="Coupons"
        header={
          <>
            <FilterBar
              action={COUPONS_PATH}
              label="Filter coupons"
              resetHref={COUPONS_PATH}
              hidden={{}}
            >
              <SearchFilter label="Search" defaultValue={filters.q} placeholder="Code or note" />
              <SelectFilter
                name="state"
                label="State"
                allLabel="Any state"
                defaultValue={filters.state}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'scheduled', label: 'Scheduled' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'exhausted', label: 'Used up' },
                ]}
              />
            </FilterBar>
            {filtered ? (
              <FilterChips
                chips={[
                  ...(filters.q
                    ? [
                        {
                          key: 'q',
                          label: `“${filters.q}”`,
                          removeHref: couponListHref({ ...filters, q: undefined }),
                        },
                      ]
                    : []),
                  ...(filters.state
                    ? [
                        {
                          key: 'state',
                          label: STATE_STYLE[filters.state].label,
                          removeHref: couponListHref({ ...filters, state: undefined }),
                        },
                      ]
                    : []),
                ]}
                clearHref={COUPONS_PATH}
              />
            ) : null}
          </>
        }
        footer={
          total > 0 ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              noun="coupons"
              hrefFor={(next) => couponListHref(filters, next)}
            />
          ) : undefined
        }
      >
        <DataTable caption="Coupons" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead><AutoText>Code</AutoText></TableHead>
              <TableHead><AutoText>Discount</AutoText></TableHead>
              <TableHead className="hidden md:table-cell"><AutoText>Minimum</AutoText></TableHead>
              <TableHead><AutoText>State</AutoText></TableHead>
              <TableHead className="hidden text-right lg:table-cell"><AutoText>Used</AutoText></TableHead>
              <TableHead className="hidden text-right xl:table-cell"><AutoText>Given</AutoText></TableHead>
              <TableHead className="hidden xl:table-cell"><AutoText>Ends</AutoText></TableHead>
            </TableRow>
          </TableHeader>
          {coupons.length > 0 ? (
            <TableBody>
              {coupons.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell>
                    <Link
                      href={couponHref(coupon.id)}
                      className="font-mono text-sm font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {coupon.code}
                    </Link>
                    {coupon.description ? (
                      <span className="block max-w-64 truncate text-xs text-muted-foreground">
                        {coupon.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-body"><AutoText value={couponValueLabel(coupon)} /></TableCell>
                  <TableCell className="hidden text-body tabular-nums md:table-cell">
                    {coupon.minOrderMinor === 0 ? '—' : formatMoney(coupon.minOrderMinor)}
                  </TableCell>
                  <TableCell>
                    <CouponStateBadge state={coupon.state} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {formatCount(coupon.redemptionCount)}
                    {coupon.totalLimit === null ? '' : ` / ${formatCount(coupon.totalLimit)}`}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">
                    {formatMoney(coupon.totalDiscountMinor)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">
                    {coupon.endsAt === null ? 'No end' : formatDateTime(coupon.endsAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={7}
              icon={TicketPercent}
              title={filtered ? 'No coupons match these filters' : 'No coupons yet'}
              description={
                filtered
                  ? 'Try another code, or show every state.'
                  : 'Create a code and shoppers can enter it at checkout.'
              }
            />
          )}
        </DataTable>
      </GlassTable>
    </div>
  );
}

export interface CouponDetailViewProps {
  coupon: AdminCoupon;
  redemptions: readonly CouponRedemption[];
  redemptionsTotal: number;
  redemptionsPage: number;
  redemptionsTotalPages: number;
  pageSize: number;
  csrf: CsrfInput;
}

/** One coupon: its rules, what it has cost, who used it, and the on/off switch. */
export function CouponDetailView({
  coupon,
  redemptions,
  redemptionsTotal,
  redemptionsPage,
  redemptionsTotalPages,
  pageSize,
  csrf,
}: CouponDetailViewProps) {
  const next = !coupon.isActive;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Redemptions"
          value={formatCount(coupon.redemptionCount)}
          icon={TicketPercent}
          tone="primary"
          footnote="Orders that used this code"
        />
        <KpiCard
          label="Discount given"
          value={formatMoney(coupon.totalDiscountMinor)}
          icon={TicketPercent}
          tone="warning"
          footnote="Across every order"
        />
        <KpiCard
          label="Total uses"
          value={coupon.totalLimit === null ? 'Unlimited' : formatCount(coupon.totalLimit)}
          icon={TicketPercent}
          tone="violet"
          footnote={`${String(coupon.perCustomerLimit)} per customer`}
        />
        <KpiCard
          label="Minimum order"
          value={coupon.minOrderMinor === 0 ? 'None' : formatMoney(coupon.minOrderMinor)}
          icon={TicketPercent}
          tone="success"
          footnote={
            coupon.endsAt === null ? 'No end date' : `Ends ${formatDateTime(coupon.endsAt)}`
          }
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          title="Redemptions"
          icon={TicketPercent}
          description=<CountText count={redemptionsTotal} one="order" />
          flush
        >
          <DataTable caption="Coupon redemptions" dense>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead><AutoText>Order</AutoText></TableHead>
                <TableHead><AutoText>Customer</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Discount</AutoText></TableHead>
                <TableHead className="hidden md:table-cell"><AutoText>When</AutoText></TableHead>
              </TableRow>
            </TableHeader>
            {redemptions.length > 0 ? (
              <TableBody>
                {redemptions.map((redemption) => (
                  <TableRow key={redemption.id}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${redemption.orderNumber}`}
                        className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                      >
                        {redemption.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-48 truncate text-foreground">
                        {redemption.customerName ?? redemption.customerEmail ?? 'Account removed'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(redemption.discountMinor)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      <time dateTime={redemption.redeemedAt}>
                        <DateTimeText value={redemption.redeemedAt} style="datetime" />
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ) : (
              <DataTableEmpty
                colSpan={4}
                icon={TicketPercent}
                title="Not used yet"
                description="Orders that apply this code appear here."
              />
            )}
          </DataTable>
          {redemptionsTotalPages > 1 ? (
            <div className="border-t border-hairline px-4 py-3">
              <Pagination
                page={redemptionsPage}
                totalPages={redemptionsTotalPages}
                total={redemptionsTotal}
                pageSize={pageSize}
                noun="redemptions"
                hrefFor={(next) =>
                  withQuery(couponHref(coupon.id), { page: next > 1 ? next : undefined })
                }
              />
            </div>
          ) : null}
        </SectionCard>

        <div className="grid gap-6">
          <SectionCard title="Rules" icon={TicketPercent}>
            <dl className="grid gap-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Code</AutoText></dt>
                <dd className="font-mono font-semibold text-foreground"><AutoText value={coupon.code} /></dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Discount</AutoText></dt>
                <dd className="font-semibold text-foreground"><AutoText value={couponValueLabel(coupon)} /></dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Minimum order</AutoText></dt>
                <dd className="text-foreground tabular-nums">
                  {coupon.minOrderMinor === 0 ? 'None' : formatMoney(coupon.minOrderMinor)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Per customer</AutoText></dt>
                <dd className="text-foreground tabular-nums"><AutoText value={coupon.perCustomerLimit} /></dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Starts</AutoText></dt>
                <dd className="text-foreground">
                  {coupon.startsAt === null ? 'Immediately' : formatDateTime(coupon.startsAt)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>Ends</AutoText></dt>
                <dd className="text-foreground">
                  {coupon.endsAt === null ? 'Never' : formatDateTime(coupon.endsAt)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground"><AutoText>State</AutoText></dt>
                <dd>
                  <CouponStateBadge state={coupon.state} />
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title={next ? 'Turn this coupon on' : 'Turn this coupon off'}
            icon={TicketPercent}
            description={
              next
                ? 'It applies at checkout again, inside its dates and under its limits.'
                : 'Shoppers can no longer use it. Orders that already used it keep their discount.'
            }
          >
            <CouponActiveToggle
              couponId={coupon.id}
              code={coupon.code}
              isActive={coupon.isActive}
              csrf={csrf}
            />
            <Link
              href="/admin/coupons"
              className={`${buttonClasses({ variant: 'ghost', size: 'sm' })} mt-3 max-sm:min-h-11`}
            ><AutoText>Back to all coupons</AutoText></Link>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** Shown when there are no coupons at all, so the empty page still explains itself. */
export function NoCouponsYet() {
  return (
    <section className="nz-panel rounded-2xl border border-dashed">
      <EmptyPanel
        icon={TicketPercent}
        titleAs="h2"
        title="No coupons yet"
        description="Create a code with the form. It applies at checkout only while it is active, inside its dates and under its limits."
        className="py-16"
      />
    </section>
  );
}
