import { adminReturnListQuerySchema } from '@nilzora/contracts';
import { Undo2 } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { ReturnListView } from '@/components/after-sales/return-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Returns', robots: { index: false, follow: false } };

const RETURNS_PATH = '/admin/returns' as Route;

interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Return requests, newest first, with the status tabs and search in the view. */
export default async function ReturnsPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', RETURNS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={RETURNS_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Undo2} title="Returns" />
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
  const parsed = adminReturnListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : adminReturnListQuerySchema.parse({ status: 'all', q: '', page: 1, pageSize: 25 });

  const result = await adminRead((api, token) => api.adminListReturns(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(RETURNS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Undo2}
          title="Returns"
          description="Goods customers asked to send back. Decide each request, mark the goods received, then restock."
        />
        {result.kind === 'ok' ? (
          <ReturnListView
            returns={result.value.returns}
            status={query.status}
            q={query.q}
            page={result.value.page}
            totalPages={result.value.totalPages}
            total={result.value.total}
            pageSize={result.value.pageSize}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={RETURNS_PATH} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
