import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { DetailSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { OrderDetailContent } from '@/components/orders/order-detail';
import { noticeMessage, ORDER_NOTICES, ORDERS_PATH } from '@/components/orders/order-query';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export async function generateMetadata({
  params,
}: PageProps<'/admin/orders/[orderNumber]'>): Promise<Metadata> {
  const { orderNumber } = await params;
  // Only an order number's own characters reach the title.
  const title = /^NZ\d{6,12}$/.test(orderNumber) ? `Order ${orderNumber}` : 'Order';
  return { title, robots: { index: false, follow: false } };
}

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<'/admin/orders/[orderNumber]'>) {
  // The gate returns to the list: the order number is request input, not a fixed path.
  const gate = await workspaceGate('admin', ORDERS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={ORDERS_PATH} />;
  }
  const { user, csrf } = gate;
  const { orderNumber } = await params;
  const notice = noticeMessage((await searchParams).notice, ORDER_NOTICES);
  const label = /^NZ\d{6,12}$/.test(orderNumber) ? orderNumber : 'Order';

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label }]}>
      {user.permissions.includes('orders.read') ? (
        <Suspense fallback={<DetailSkeleton label="Loading the order" />}>
          <OrderDetailContent
            orderNumber={orderNumber}
            permissions={user.permissions}
            csrf={csrf}
            notice={notice}
          />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          <PageToolbar back={{ href: ORDERS_PATH, label: 'Orders' }} title="Order" />
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="orders.read" />
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
