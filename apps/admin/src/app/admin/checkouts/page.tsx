import { adminCheckoutListQuerySchema } from '@nilzora/contracts';
import { PackageX } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { CheckoutListView } from '@/components/checkouts/checkout-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Checkouts',
  robots: { index: false, follow: false },
};

const CHECKOUTS_PATH = '/admin/checkouts' as Route;

/** Checkout attempts, newest activity first, with the stage filter and search in the view. */
interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CheckoutsPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', CHECKOUTS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={CHECKOUTS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={PackageX} title="Checkouts" />
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
  const parsed = adminCheckoutListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : adminCheckoutListQuerySchema.parse({ status: 'all', q: '', page: 1, pageSize: 25 });

  // The figures and the queue are two reads of the same window; one failing must not hide
  // the other, so the list still renders when the metrics cannot be answered.
  const [result, metricsResult] = await Promise.all([
    adminRead((api, token) => api.adminListCheckouts(token, query)),
    adminRead((api, token) =>
      api.adminCheckoutMetrics(token, { from: query.from, to: query.to }),
    ),
  ]);
  if (result.kind === 'signed_out') redirect(signInPath(CHECKOUTS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={PackageX}
          title="Checkouts"
          description="Customers who started a checkout and have not ordered yet. Staff can review the stage, contact the customer and create a recovery link. Nothing here changes an order."
        />
        {result.kind === 'ok' ? (
          <CheckoutListView
            checkouts={result.value.checkouts}
            metrics={metricsResult.kind === 'ok' ? metricsResult.value.metrics : null}
            filters={{
              status: query.status,
              q: query.q,
              from: query.from,
              to: query.to,
              sort: query.sort,
            }}
            page={result.value.page}
            totalPages={result.value.totalPages}
            total={result.value.total}
            pageSize={result.value.pageSize}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={CHECKOUTS_PATH}
              permission="orders.read"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
