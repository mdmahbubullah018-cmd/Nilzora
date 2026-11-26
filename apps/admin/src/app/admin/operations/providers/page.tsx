import { Plug } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { ProvidersView } from '@/components/shipments/provider-cards';
import { OPERATIONS_PATHS } from '@/components/shipments/shipment-labels';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Courier providers',
  robots: { index: false, follow: false },
};

const PATH = OPERATIONS_PATHS.providers;

/** Steadfast and Pathao: switches, settings and what each can do (couriers.read). */
export default async function ProvidersPage() {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  const toolbar = (
    <PageToolbar
      icon={Plug}
      title="Courier providers"
      description="Which couriers Nilzora may book, their non-secret settings, and which operations are verified. Credentials are set on the server, never here."
    />
  );
  if (!user.permissions.includes('couriers.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        {toolbar}
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="couriers.read" />
        </section>
      </WorkspaceShell>
    );
  }
  const config = await adminRead((api, token) => api.adminCourierConfig(token));
  if (config.kind === 'signed_out') redirect(signInPath(PATH));
  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {config.kind === 'ok' ? (
          <ProvidersView config={config.value} permissions={user.permissions} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={config.kind} retryHref={PATH} permission="couriers.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
