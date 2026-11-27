import { uuidSchema } from '@nilzora/validation';
import { Package } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { ShipmentStatusChip, TestChip } from '@/components/shipments/shipment-chips';
import { ShipmentDetailView } from '@/components/shipments/shipment-detail';
import {
  OPERATIONS_PATHS,
  providerName,
  SHIPMENT_KIND_LABELS,
  shipmentHref,
} from '@/components/shipments/shipment-labels';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { formatDateTime } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Shipment', robots: { index: false, follow: false } };

const back = { href: OPERATIONS_PATHS.shipments, label: 'Shipments' };

/** One courier shipment: summary, destination, timeline, staff steps and its COD. */
export default async function ShipmentPage({
  params,
}: PageProps<'/admin/operations/shipments/[shipmentId]'>) {
  const { shipmentId } = await params;
  if (!uuidSchema.safeParse(shipmentId).success) notFound();
  const path = shipmentHref(shipmentId);
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;
  if (!user.permissions.includes('shipments.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Package} title="Shipment" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="shipments.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const [detail, config] = await Promise.all([
    adminRead((api, token) => api.adminGetShipment(token, shipmentId)),
    adminRead((api, token) => api.adminCourierConfig(token)),
  ]);
  if (detail.kind === 'signed_out' || config.kind === 'signed_out') redirect(signInPath(path));
  if (detail.kind === 'not_found') notFound();
  if (detail.kind !== 'ok') {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <div className="grid gap-6">
          <PageToolbar icon={Package} title="Shipment" back={back} />
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={detail.kind} retryHref={path} permission="shipments.read" />
          </section>
        </div>
      </WorkspaceShell>
    );
  }

  const { shipment } = detail.value;
  const provider =
    config.kind === 'ok'
      ? (config.value.providers.find((p) => p.provider === shipment.provider) ?? null)
      : null;

  return (
    <WorkspaceShell
      workspace="admin"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: shipment.merchantRef }]}
    >
      <div className="grid gap-6">
        <PageToolbar
          icon={Package}
          back={back}
          eyebrow={
            <>
              <ShipmentStatusChip status={shipment.status} />
              <Chip>{SHIPMENT_KIND_LABELS[shipment.kind]}</Chip>
              {shipment.isMock ? <TestChip /> : null}
            </>
          }
          title={
            <span className="font-mono">
              <AutoText value={shipment.merchantRef} />
            </span>
          }
          meta={
            <>
              <span>{shipment.providerName || providerName(shipment.provider)}</span>
              <span aria-hidden="true">·</span>
              <span>
                Order{' '}
                <span className="font-mono">
                  <AutoText value={shipment.orderNumber} />
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Created{' '}
                <time dateTime={shipment.createdAt}>
                  <AutoText value={formatDateTime(shipment.createdAt)} />
                </time>
              </span>
            </>
          }
        />
        <ShipmentDetailView
          detail={detail.value}
          provider={provider}
          permissions={user.permissions}
          csrf={csrf}
        />
      </div>
    </WorkspaceShell>
  );
}
