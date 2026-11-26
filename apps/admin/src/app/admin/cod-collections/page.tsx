import { HandCoins } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { ExportMenu } from '@/components/admin-kit/export-menu';
import { oneOf, pageParam, single } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  apiPageFor,
  COD_PAGE_SIZE,
  COD_PATH,
  codTabQuery,
  CodCollectionsView,
  type CodFilters,
  type CodTab,
} from '@/components/orders/cod-collections';
import {
  dayParam,
  noticeMessage,
  ORDER_NOTICES,
  searchParam,
} from '@/components/orders/order-query';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { exportRange } from '@/lib/export-range';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'COD collections',
  robots: { index: false, follow: false },
};

const TABS = ['collect', 'collected'] as const;

/**
 * Cash on Delivery money: delivered orders waiting for their cash to be booked, and the
 * ones already booked. Reading needs orders.read; recording cash needs payments.collect
 * (the API checks it again); the export is the finance report (finance.read).
 */
export default async function CodCollectionsPage({
  searchParams,
}: PageProps<'/admin/cod-collections'>) {
  const gate = await workspaceGate('admin', COD_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={COD_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={HandCoins} title="COD collections" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const query = await searchParams;
  const tab: CodTab = oneOf(query.tab, TABS) ?? 'collect';
  const filters: CodFilters = {
    tab,
    q: searchParam(query.q),
    from: dayParam(query.from),
    to: dayParam(query.to),
  };
  const notice = noticeMessage(single(query.notice), ORDER_NOTICES);

  // One count per tab (pageSize 1 reads only the total), with the page's search and dates.
  const count = (which: CodTab) =>
    adminRead((api, token) =>
      api
        .adminListOrders(token, {
          ...codTabQuery(which),
          q: filters.q,
          from: filters.from,
          to: filters.to,
          page: 1,
          pageSize: 1,
        })
        .then((response) => response.total),
    );
  const [toCollect, collected] = await Promise.all([count('collect'), count('collected')]);
  if (toCollect.kind === 'signed_out' || collected.kind === 'signed_out') {
    redirect(signInPath(COD_PATH));
  }
  const counts = {
    ...(toCollect.kind === 'ok' ? { collect: toCollect.value } : {}),
    ...(collected.kind === 'ok' ? { collected: collected.value } : {}),
  };
  const current = tab === 'collect' ? toCollect : collected;

  const toolbar = (
    <PageToolbar
      icon={HandCoins}
      title="COD collections"
      description="Cash the courier takes at the door. Book it here once it reaches the store, so every delivered order ends fully paid."
      actions={
        user.permissions.includes('finance.read') ? (
          <ExportMenu
            kind="cod_collections"
            filters={{ ...exportRange({ from: filters.from, to: filters.to }), q: filters.q }}
          />
        ) : undefined
      }
    />
  );

  if (current.kind !== 'ok') {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <div className="grid gap-6">
          {toolbar}
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={current.kind} retryHref={COD_PATH} permission="orders.read" />
          </section>
        </div>
      </WorkspaceShell>
    );
  }

  const total = current.value;
  const totalPages = Math.max(1, Math.ceil(total / COD_PAGE_SIZE));
  const page = Math.min(pageParam(query.page), totalPages);
  const list = await adminRead((api, token) =>
    api.adminListOrders(token, {
      ...codTabQuery(tab),
      q: filters.q,
      from: filters.from,
      to: filters.to,
      page: apiPageFor(tab, page, totalPages),
      pageSize: COD_PAGE_SIZE,
    }),
  );
  if (list.kind === 'signed_out') redirect(signInPath(COD_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}
        {list.kind === 'ok' ? (
          <CodCollectionsView
            filters={filters}
            // "Cash to collect" was read from the far end of the newest-first list.
            orders={tab === 'collect' ? [...list.value.orders].reverse() : list.value.orders}
            counts={counts}
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={COD_PAGE_SIZE}
            now={new Date()}
            csrf={csrf}
            canRecord={user.permissions.includes('payments.collect')}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={list.kind} retryHref={COD_PATH} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
