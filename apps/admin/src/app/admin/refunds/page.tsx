import { adminRefundListQuerySchema } from '@nilzora/contracts';
import { Banknote } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { RefundListView } from '@/components/after-sales/refund-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Refunds', robots: { index: false, follow: false } };

const REFUNDS_PATH = '/admin/refunds' as Route;

interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Refunds on orders, with the form that starts one. */
export default async function RefundsPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', REFUNDS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={REFUNDS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Banknote} title="Refunds" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  // A cleared field (an empty search) means "no filter", not an invalid one.
  const raw = Object.fromEntries(
    Object.entries(await searchParams).filter(([, value]) => value !== '' && value !== undefined),
  );
  const parsed = adminRefundListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : adminRefundListQuerySchema.parse({ status: 'all', q: '', page: 1, pageSize: 25 });

  const result = await adminRead((api, token) => api.adminListRefunds(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(REFUNDS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Banknote}
          title="Refunds"
          description="Money going back to customers. With Cash on Delivery it is paid by hand, approved first and completed only when its reference is recorded."
        />
        {result.kind === 'ok' ? (
          <RefundListView
            refunds={result.value.refunds}
            status={query.status}
            q={query.q}
            page={result.value.page}
            totalPages={result.value.totalPages}
            total={result.value.total}
            pageSize={result.value.pageSize}
            csrf={csrf}
            canRequest={user.permissions.includes('refunds.request')}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={REFUNDS_PATH} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
