import { uuidSchema } from '@nilzora/validation';
import { Banknote } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { RefundDetailView } from '@/components/after-sales/refund-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Refund', robots: { index: false, follow: false } };

const back = { href: '/admin/refunds' as Route, label: 'Refunds' };

interface PageParams {
  params: Promise<{ refundId: string }>;
}

/** One refund: the amount, the order, the decision and the payout record. */
export default async function RefundPage({ params }: PageParams) {
  const { refundId } = await params;
  if (!uuidSchema.safeParse(refundId).success) notFound();

  const path = `/admin/refunds/${refundId}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Banknote} title="Refund" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminGetRefund(token, refundId));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') notFound();

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Banknote}
          back={back}
          title={result.kind === 'ok' ? `Refund ${result.value.refund.order.number}` : 'Refund'}
          description="Approve the refund, then record the payout with its reference. Nothing is marked paid without it."
        />
        {result.kind === 'ok' ? (
          <RefundDetailView
            refund={result.value.refund}
            csrf={csrf}
            canApprove={user.permissions.includes('refunds.approve')}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={path} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
