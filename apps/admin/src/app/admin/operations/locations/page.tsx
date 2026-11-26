import { MapPinned } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  LocationMappingsView,
  parseMappingFilters,
} from '@/components/shipments/location-mappings';
import { OPERATIONS_PATHS } from '@/components/shipments/shipment-labels';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Location mappings',
  robots: { index: false, follow: false },
};

const PATH = OPERATIONS_PATHS.locations;

/** Courier locations per district and area (view: shipments.read). */
export default async function LocationMappingsPage({
  searchParams,
}: PageProps<'/admin/operations/locations'>) {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  const toolbar = (
    <PageToolbar
      icon={MapPinned}
      title="Location mappings"
      description="The courier’s own city, zone and area ids for each district (or area), used when a booking needs them."
    />
  );
  if (!user.permissions.includes('shipments.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        {toolbar}
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="shipments.read" />
        </section>
      </WorkspaceShell>
    );
  }
  const filters = parseMappingFilters(await searchParams);
  const config = await adminRead((api, token) => api.adminCourierConfig(token));
  if (config.kind === 'signed_out') redirect(signInPath(PATH));
  const canEdit =
    user.permissions.includes('shipments.create') ||
    user.permissions.includes('shipments.returns.manage');
  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {config.kind === 'ok' ? (
          <LocationMappingsView
            mappings={config.value.locationMappings}
            filters={filters}
            canEdit={canEdit}
            csrf={csrf}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={config.kind} retryHref={PATH} permission="shipments.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
