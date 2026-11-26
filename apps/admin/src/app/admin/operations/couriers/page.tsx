import { buttonClasses } from '@nilzora/ui';
import { ScrollText, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { single, withQuery } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { CourierOverviewView } from '@/components/shipments/courier-overview';
import { OPERATIONS_PATHS } from '@/components/shipments/shipment-labels';
import { TestDataSwitch } from '@/components/shipments/test-data-switch';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Courier overview',
  robots: { index: false, follow: false },
};

const PATH = OPERATIONS_PATHS.couriers;

/** Courier desk: mode, what needs attention, and each courier's performance. */
export default async function CourierOverviewPage({
  searchParams,
}: PageProps<'/admin/operations/couriers'>) {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  const permissions = user.permissions;
  const includeTest = single((await searchParams).test) === '1';

  const toolbar = (
    <PageToolbar
      icon={Truck}
      title="Courier overview"
      description="Steadfast and Pathao parcels at a glance. Booking is always a staff step on the order; courier events move shipments, never orders."
      actions={
        <>
          <TestDataSwitch path={PATH} includeTest={includeTest} />
          {permissions.includes('audit_logs.read') ? (
            <Link
              href={withQuery('/admin/audit', { area: 'shipment.' })}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              <ScrollText aria-hidden="true" /><AutoText>Shipment audit log</AutoText></Link>
          ) : null}
        </>
      }
    />
  );

  if (!permissions.includes('couriers.read') && !permissions.includes('shipments.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Truck} title="Courier overview" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="shipments.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const [overview, config] = await Promise.all([
    adminRead((api, token) => api.adminCourierOverview(token, { includeMock: includeTest })),
    adminRead((api, token) => api.adminCourierConfig(token)),
  ]);
  if (overview.kind === 'signed_out' || config.kind === 'signed_out') redirect(signInPath(PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {overview.kind === 'ok' ? (
          <CourierOverviewView
            overview={overview.value}
            config={config.kind === 'ok' ? config.value : null}
            permissions={permissions}
            includeTest={includeTest}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={overview.kind} retryHref={PATH} permission="shipments.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
