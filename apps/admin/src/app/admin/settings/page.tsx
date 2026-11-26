import { Skeleton } from '@nilzora/ui';
import { Settings } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState } from '@/components/admin-kit/states';
import { SalesTargetCard } from '@/components/settings/sales-target-card';
import { PaymentMethodsCard } from '@/components/settings/payment-methods-card';
import { DeliveryChargesResults, SETTINGS_PATH } from '@/components/settings/settings-view';
import { StoreRulesCard } from '@/components/settings/store-rules-card';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = { title: 'Store settings', robots: { index: false, follow: false } };

function SectionSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" className="nz-panel grid gap-4 rounded-2xl border p-5 sm:p-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-4 w-40" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </section>
  );
}

/** Store settings: delivery charges, the monthly sales target and the store rules (settings.manage). */
export default async function SettingsPage() {
  const gate = await workspaceGate('admin', SETTINGS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={SETTINGS_PATH} />;
  }
  const { user, csrf } = gate;

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Settings}
          title="Store settings"
          description="Delivery charges, the monthly sales target, the store rules and the payment methods customers can choose at checkout. Every change here is recorded in the audit log."
        />
        {user.permissions.includes('settings.manage') ? (
          <>
            <Suspense fallback={<SectionSkeleton label="Loading delivery charges" />}>
              <DeliveryChargesResults csrf={csrf} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton label="Loading the sales target" />}>
              <SalesTargetCard csrf={csrf} permissions={user.permissions} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton label="Loading the store rules" />}>
              <StoreRulesCard csrf={csrf} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton label="Loading payment methods" />}>
              <PaymentMethodsCard csrf={csrf} />
            </Suspense>
          </>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="settings.manage" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
