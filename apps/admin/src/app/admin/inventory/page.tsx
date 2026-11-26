import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Boxes } from 'lucide-react';
import { AccessGate } from '@/components/access/access-gate';
import { oneOf } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import {
  parseMovementListParams,
  parseProductListParams,
} from '@/components/catalog/catalog-query';
import {
  AttentionSection,
  InventoryTabs,
  MovementLedgerSection,
  StockKpis,
  StockLevelsSection,
  type InventoryTab,
} from '@/components/catalog/inventory-view';
import {
  anySignedOut,
  loadInventoryOverview,
  loadMovementLedger,
} from '@/components/catalog/load-catalog';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Inventory', robots: { index: false, follow: false } };

const TABS: readonly InventoryTab[] = ['stock', 'movements'];
const TITLE = 'Inventory';
const DESCRIPTION =
  'Stock across the catalog, low and sold-out products first, and the ledger of every change.';

/** Stock levels (low and sold-out first) and the stock ledger. */
export default async function InventoryPage({ searchParams }: PageProps<'/admin/inventory'>) {
  const gate = await workspaceGate('admin', '/admin/inventory');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/inventory" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('products.read')) {
    return shell(<PageForbidden title={TITLE} permission="products.read" />);
  }

  const query = await searchParams;
  const tab = oneOf(query.view, TABS) ?? 'stock';
  const toolbar = (
    <PageToolbar
      icon={Boxes}
      title={TITLE}
      description={DESCRIPTION}
      actions={<InventoryTabs current={tab} />}
    />
  );

  if (tab === 'movements') {
    const params = parseMovementListParams(query);
    const ledger = await loadMovementLedger(params);
    if (anySignedOut([ledger.movements, ledger.products])) {
      redirect(signInPath('/admin/inventory'));
    }
    if (ledger.movements.kind !== 'ok') {
      return shell(
        <PageFailure
          title={TITLE}
          failure={ledger.movements.kind === 'signed_out' ? 'unavailable' : ledger.movements.kind}
          retryHref="/admin/inventory"
          resetHref="/admin/inventory?view=movements"
          permission="products.read"
        />,
      );
    }
    return shell(
      <>
        {toolbar}
        <MovementLedgerSection
          params={params}
          movements={ledger.movements.value}
          products={ledger.products.kind === 'ok' ? ledger.products.value : null}
        />
      </>,
    );
  }

  // Review states are not a stock filter; they are dropped rather than applied unseen.
  const params = { ...parseProductListParams(query), moderation: undefined };
  const data = await loadInventoryOverview(params);
  if (anySignedOut([data.counts, data.attention, data.products, data.categories])) {
    redirect(signInPath('/admin/inventory'));
  }
  if (data.products.kind !== 'ok') {
    return shell(
      <PageFailure
        title={TITLE}
        failure={data.products.kind === 'signed_out' ? 'unavailable' : data.products.kind}
        retryHref="/admin/inventory"
        resetHref="/admin/inventory"
        permission="products.read"
      />,
    );
  }
  const counts = data.counts.kind === 'signed_out' ? { kind: 'unavailable' as const } : data.counts;
  const attention =
    data.attention.kind === 'signed_out' ? { kind: 'unavailable' as const } : data.attention;
  return shell(
    <>
      {toolbar}
      <StockKpis counts={counts} />
      <AttentionSection attention={attention} />
      <StockLevelsSection
        params={params}
        list={data.products.value}
        categories={data.categories.kind === 'ok' ? data.categories.value : null}
      />
    </>,
  );
}
