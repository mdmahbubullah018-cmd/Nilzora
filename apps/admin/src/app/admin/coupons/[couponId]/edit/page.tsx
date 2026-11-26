import { TicketPercent } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, NotFoundState, ReadState } from '@/components/admin-kit/states';
import { CouponForm } from '@/components/marketing/coupon-form';
import { loadCampaignTargets } from '@/components/marketing/load-campaigns';
import { COUPONS_PATH, couponHref } from '@/components/marketing/coupon-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Edit coupon', robots: { index: false, follow: false } };

/** Editing a coupon's rules. Past orders keep the discount they were placed with. */
export default async function EditCouponPage({
  params,
}: PageProps<'/admin/coupons/[couponId]/edit'>) {
  const { couponId } = await params;
  const gate = await workspaceGate('admin', COUPONS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={COUPONS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('coupons.update')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={TicketPercent} title="Edit coupon" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="coupons.update" />
        </section>
      </WorkspaceShell>
    );
  }

  const [coupon, targets] = await Promise.all([
    adminRead((api, token) => api.adminGetCoupon(token, couponId).then((r) => r.coupon)),
    loadCampaignTargets(),
  ]);
  if (coupon.kind === 'signed_out') redirect(signInPath(COUPONS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={TicketPercent}
          back={{ href: couponHref(couponId), label: 'Coupon' }}
          title="Edit coupon"
          description="Changing the rules affects future checkouts only; orders already placed keep their discount."
        />
        {coupon.kind === 'ok' ? (
          <section className="nz-panel-strong nz-panel-sheen rounded-2xl border p-5 sm:p-6">
            <CouponForm
              coupon={coupon.value}
              csrf={csrf}
              targets={targets.kind === 'ok' ? targets.value : null}
              canPickCustomers={user.permissions.includes('customers.read')}
            />
          </section>
        ) : coupon.kind === 'not_found' ? (
          <section className="nz-panel rounded-2xl border">
            <NotFoundState title="Coupon not found" description="It may have been removed." />
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
