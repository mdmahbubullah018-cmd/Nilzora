import { uuidSchema } from '@nilzora/validation';
import { Undo2 } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { ReturnDetailView } from '@/components/after-sales/return-views';
import {
  loadReturnCourier,
  ReturnCourierSection,
} from '@/components/shipments/return-courier-section';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Return', robots: { index: false, follow: false } };

const back = { href: '/admin/returns' as Route, label: 'Returns' };

interface PageParams {
  params: Promise<{ returnId: string }>;
}

/** One return request: the record, the steps and its history. */
export default async function ReturnPage({ params }: PageParams) {
  const { returnId } = await params;
  if (!uuidSchema.safeParse(returnId).success) notFound();

  const path = `/admin/returns/${returnId}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Undo2} title="Return" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminGetReturn(token, returnId));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') notFound();
  const courier = result.kind === 'ok' ? await loadReturnCourier(returnId, user.permissions) : null;

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Undo2}
          back={back}
          title={result.kind === 'ok' ? `Return ${result.value.return.orderNumber}` : 'Return'}
          description="Decide the request, mark the goods received, then restock. Refunds are recorded separately and need a payout reference."
        />
        {result.kind === 'ok' ? (
          <>
            <ReturnDetailView
              request={result.value.return}
              csrf={csrf}
              canDecide={user.permissions.includes('orders.update_status')}
              canRestock={user.permissions.includes('inventory.adjust')}
            />
            {courier ? (
              <ReturnCourierSection
                data={courier}
                returnId={result.value.return.id}
                orderNumber={result.value.return.orderNumber}
                status={result.value.return.status}
                permissions={user.permissions}
                csrf={csrf}
              />
            ) : null}
          </>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={path} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
