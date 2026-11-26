import Link from 'next/link';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CartIcon } from '@nilzora/ui';
import { AccessGate } from '@/components/access/access-gate';
import { ExportMenu } from '@/components/admin-kit/export-menu';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { ORDERS_PATH, parseOrderFilters, ordersHref } from '@/components/orders/order-query';
import { OrdersResults } from '@/components/orders/orders-results';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { exportRange } from '@/lib/export-range';

export const metadata: Metadata = { title: 'Orders', robots: { index: false, follow: false } };

/**
 * Every Cash-on-Delivery order, filtered by status, payment, zone, search and dates, and
 * sorted. Orders can be selected (across pages) for bulk status changes, a CSV export and
 * courier booking.
 */
export default async function OrdersPage({ searchParams }: PageProps<'/admin/orders'>) {
  const gate = await workspaceGate('admin', ORDERS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={ORDERS_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={CartIcon} title="Orders" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const { page, ...filters } = parseOrderFilters(await searchParams);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={CartIcon}
          title="Orders"
          description="Cash-on-Delivery orders from every customer. Open an order to move it to its next step, cancel it or record the cash collected, or select several to act on them together."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={ordersHref(filters.view === 'archived' ? {} : { view: 'archived' })}
                className="inline-flex h-9 items-center rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground hover:bg-surface-muted"
              >
                {filters.view === 'archived' ? 'Back to active orders' : 'Archived orders'}
              </Link>
              {/* The report's own filters (it has no customer filter); dates default to the last year. */}
              <ExportMenu
                kind="orders"
                filters={{
                  ...exportRange({ from: filters.from, to: filters.to }),
                  status: filters.status,
                  paymentStatus: filters.paymentStatus,
                  q: filters.q,
                }}
              />
            </div>
          }
        />

        <Suspense
          key={ordersHref(filters, page)}
          fallback={<TableSkeleton caption="Loading orders" columns={8} />}
        >
          <OrdersResults
            filters={filters}
            page={page}
            now={new Date()}
            canReadCustomers={user.permissions.includes('customers.read')}
            // Selection and bulk actions; each action is offered by permission and the API
            // checks every order again.
            bulk={{ permissions: user.permissions, csrf }}
          />
        </Suspense>
      </div>
    </WorkspaceShell>
  );
}
