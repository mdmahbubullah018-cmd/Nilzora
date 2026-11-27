import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { adminRead } from '@/components/admin-kit/read';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { filterZones, parseZoneFilters } from '@/components/zones/zone-query';
import { ZonesView } from '@/components/zones/zone-views';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Shopping zones',
  robots: { index: false, follow: false },
};

/** Shopping zones: the collections the storefront and the app browse by. */
export default async function ZonesPage({ searchParams }: PageProps<'/admin/zones'>) {
  const gate = await workspaceGate('admin', '/admin/zones');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/zones" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );
  if (!user.permissions.includes('zones.manage')) {
    return shell(<PageForbidden title="Shopping zones" permission="zones.manage" />);
  }

  const filters = parseZoneFilters(await searchParams);
  const zones = await adminRead((api, token) =>
    api.adminListZones(token, { pageSize: 200 }).then((response) => response.zones),
  );
  if (zones.kind === 'signed_out') redirect(signInPath('/admin/zones'));
  if (zones.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Shopping zones"
        failure={zones.kind}
        retryHref="/admin/zones"
        permission="zones.manage"
      />,
    );
  }

  return shell(
    <ZonesView
      zones={filterZones(zones.value, filters)}
      totalZones={zones.value.length}
      filters={filters}
      canManage
      csrf={csrf}
    />,
  );
}
