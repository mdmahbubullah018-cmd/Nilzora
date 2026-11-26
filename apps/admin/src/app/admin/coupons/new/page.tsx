import { TicketPercent } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState } from '@/components/admin-kit/states';
import { CouponForm } from '@/components/marketing/coupon-form';
import { loadCampaignTargets } from '@/components/marketing/load-campaigns';
import { COUPONS_PATH } from '@/components/marketing/coupon-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = { title: 'New coupon', robots: { index: false, follow: false } };

/** A new coupon. Nothing is written until the form is submitted. */
export default async function NewCouponPage() {
  const gate = await workspaceGate('admin', '/admin/coupons/new');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/coupons/new" />;
  }
  const { user, csrf } = gate;
  // The catalogue is read only for an account that may create coupons.
  const mayCreate =
    user.permissions.includes('coupons.update') && user.permissions.includes('coupons.create');
  const targets = mayCreate ? await loadCampaignTargets() : null;

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={TicketPercent}
          back={{ href: COUPONS_PATH, label: 'Coupons' }}
          title="New coupon"
          description="The code applies at checkout once it is active, inside its dates and under its limits."
        />
        {/* Saving a coupon needs coupons.update; creating one also needs coupons.create. */}
        {!user.permissions.includes('coupons.update') ? (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="coupons.update" />
          </section>
        ) : !user.permissions.includes('coupons.create') ? (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="coupons.create" />
          </section>
        ) : (
          <section className="nz-panel-strong nz-panel-sheen rounded-2xl border p-5 sm:p-6">
            <CouponForm
              csrf={csrf}
              targets={targets?.kind === 'ok' ? targets.value : null}
              canPickCustomers={user.permissions.includes('customers.read')}
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
