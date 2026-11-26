import type { CouponTargeting } from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { DeleteCouponForm } from '@/components/marketing/coupon-delete';
import { Pencil, TicketPercent } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, NotFoundState, ReadState } from '@/components/admin-kit/states';
import {
  COUPONS_PATH,
  CouponDetailView,
  editCouponHref,
} from '@/components/marketing/coupon-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Coupon', robots: { index: false, follow: false } };

const REDEMPTIONS_PER_PAGE = 25;

/** One coupon: its rules and edit form, what it has cost, its redemptions and the switch. */
export default async function CouponPage({
  params,
  searchParams,
}: PageProps<'/admin/coupons/[couponId]'>) {
  const { couponId } = await params;
  const gate = await workspaceGate('admin', COUPONS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={COUPONS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('coupons.update')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={TicketPercent} title="Coupon" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="coupons.update" />
        </section>
      </WorkspaceShell>
    );
  }

  const pageParam = Number((await searchParams).page);
  const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [coupon, redemptions] = await Promise.all([
    adminRead((api, token) => api.adminGetCoupon(token, couponId).then((r) => r.coupon)),
    adminRead((api, token) =>
      api.adminCouponRedemptions(token, couponId, {
        page,
        pageSize: REDEMPTIONS_PER_PAGE,
      }),
    ),
  ]);
  if (coupon.kind === 'signed_out' || redemptions.kind === 'signed_out') {
    redirect(signInPath(COUPONS_PATH));
  }

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {coupon.kind === 'ok' ? (
          <>
            <PageToolbar
              icon={TicketPercent}
              back={{ href: COUPONS_PATH, label: 'Coupons' }}
              eyebrow={
                <span className="font-mono text-sm font-semibold text-foreground">
                  {coupon.value.code}
                </span>
              }
              title={coupon.value.description ?? coupon.value.code}
              description="Discounts already given stay on their orders: editing a coupon never rewrites past totals."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={editCouponHref(coupon.value.id)}
                    className={buttonClasses({ variant: 'outline', size: 'sm' })}
                  >
                    <Pencil aria-hidden="true" /><AutoText>Edit</AutoText></Link>
                  {coupon.value.redemptionCount === 0 ? (
                    <DeleteCouponForm
                      couponId={coupon.value.id}
                      code={coupon.value.code}
                      csrf={csrf}
                    />
                  ) : null}
                </div>
              }
            />
            {coupon.value.targeting ? (
              <TargetingSummary targeting={coupon.value.targeting} />
            ) : null}
            <CouponDetailView
              coupon={coupon.value}
              redemptions={redemptions.kind === 'ok' ? redemptions.value.redemptions : []}
              redemptionsTotal={redemptions.kind === 'ok' ? redemptions.value.total : 0}
              redemptionsPage={redemptions.kind === 'ok' ? redemptions.value.page : 1}
              redemptionsTotalPages={redemptions.kind === 'ok' ? redemptions.value.totalPages : 0}
              pageSize={REDEMPTIONS_PER_PAGE}
              csrf={csrf}
            />
            {redemptions.kind !== 'ok' ? (
              <section className="nz-panel rounded-2xl border">
                <ReadState
                  failure={redemptions.kind === 'not_found' ? 'unavailable' : redemptions.kind}
                  retryHref={COUPONS_PATH}
                  permission="coupons.update"
                  compact
                />
              </section>
            ) : null}
          </>
        ) : coupon.kind === 'not_found' ? (
          <section className="nz-panel rounded-2xl border">
            <NotFoundState
              title="Coupon not found"
              description="It may have been removed, or the link is wrong."
            />
          </section>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={coupon.kind} retryHref={COUPONS_PATH} permission="coupons.update" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}

const SCOPE_LABEL = {
  storewide: 'Everything in the store',
  categories: 'Selected categories',
  products: 'Selected products',
} as const;
const AUDIENCE_LABEL = {
  all: 'Everyone',
  new_customers: 'New customers only',
  returning_customers: 'Returning customers only',
  selected_customers: 'Chosen customers only',
} as const;

/** Voucher, scope and audience at a glance, with how many customers collected it. */
function TargetingSummary({ targeting }: { targeting: CouponTargeting }) {
  const items: { label: string; value: string }[] = [
    { label: 'Type', value: targeting.isVoucher ? 'Collectible voucher' : 'Coupon code' },
    { label: 'Applies to', value: SCOPE_LABEL[targeting.scope] },
    { label: 'Customers', value: AUDIENCE_LABEL[targeting.audience] },
  ];
  if (targeting.isVoucher) {
    items.push({ label: 'Voucher title', value: targeting.title ?? 'Uses the description' });
    items.push({
      label: 'Collected',
      value: `${String(targeting.collectionCount)}${targeting.collectLimit === null ? '' : ` of ${String(targeting.collectLimit)}`} customers`,
    });
  }
  if (targeting.scope === 'products') {
    items.push({
      label: 'Products',
      value: targeting.products.map((product) => product.name).join(', '),
    });
  }
  if (targeting.scope === 'categories') {
    items.push({
      label: 'Categories',
      value: `${String(targeting.categoryIds.length)} chosen (with subcategories)`,
    });
  }
  return (
    <section
      aria-label="Voucher and eligibility"
      className="nz-panel rounded-2xl border p-5 sm:p-6"
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="grid gap-0.5">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {item.label}
            </dt>
            <dd className="text-sm font-medium text-foreground"><AutoText value={item.value} /></dd>
          </div>
        ))}
      </dl>
      {targeting.audience === 'selected_customers' ? (
        <div className="mt-5 grid gap-2 border-t border-hairline pt-4">
          <h2 className="text-sm font-semibold text-foreground">
            Recipients ({String(targeting.customers.length)})
          </h2>
          {targeting.customers.length === 0 ? (
            <p className="text-sm text-muted-foreground"><AutoText>No customer is chosen, so nobody can use this coupon. Edit it to choose customers.</AutoText></p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {targeting.customers.map((customer) => (
                <li
                  key={customer.id}
                  className="flex min-w-0 flex-col rounded-xl border border-hairline bg-surface px-3 py-1.5 text-sm"
                >
                  <span className="truncate font-medium text-foreground">
                    {customer.name ?? customer.email ?? 'Customer'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[customer.email, customer.phone].filter(Boolean).join(' · ') ||
                      'Contact details need the “View customers” permission'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
