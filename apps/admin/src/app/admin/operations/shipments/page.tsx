import { PackageSearch } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { ShipmentListView } from '@/components/shipments/shipment-list';
import {
  OPERATIONS_PATHS,
  parseShipmentFilters,
  SHIPMENTS_PAGE_SIZE,
  shipmentsHref,
} from '@/components/shipments/shipment-labels';
import { TestDataSwitch } from '@/components/shipments/test-data-switch';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Shipments', robots: { index: false, follow: false } };

const PATH = OPERATIONS_PATHS.shipments;

/** Every courier shipment (shipments.read), with filters and paging. */
export default async function ShipmentsPage({
  searchParams,
}: PageProps<'/admin/operations/shipments'>) {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  if (!user.permissions.includes('shipments.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={PackageSearch} title="Shipments" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="shipments.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const { page, ...filters } = parseShipmentFilters(await searchParams);
  const result = await adminRead((api, token) =>
    api.adminListShipments(token, {
      status: filters.status ?? 'all',
      provider: filters.provider ?? 'all',
      kind: filters.kind ?? 'all',
      q: filters.q ?? '',
      from: filters.from,
      to: filters.to,
      includeMock: filters.test ?? false,
      page,
      pageSize: SHIPMENTS_PAGE_SIZE,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(PATH));

  const switchParams = {
    status: filters.status,
    courier: filters.provider,
    kind: filters.kind,
    q: filters.q,
    from: filters.from,
    to: filters.to,
  };

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={PackageSearch}
          title="Shipments"
          description="Every parcel booked with a courier: deliveries, return pickups and exchanges. Open one to refresh tracking, record a status, cancel or reconcile its cash."
          actions={
            <TestDataSwitch path={PATH} includeTest={filters.test ?? false} params={switchParams} />
          }
        />
        {result.kind === 'ok' ? (
          <ShipmentListView
            filters={filters}
            shipments={result.value.shipments}
            page={result.value.page}
            totalPages={result.value.totalPages}
            total={result.value.total}
            pageSize={result.value.pageSize}
            permissions={user.permissions}
            now={new Date()}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={shipmentsHref(filters, page)}
              resetHref={PATH}
              permission="shipments.read"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
