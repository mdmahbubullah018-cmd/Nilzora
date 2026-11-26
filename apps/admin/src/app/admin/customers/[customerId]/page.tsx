import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { DetailSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import { CUSTOMERS_PATH } from '@/components/customers/customer-query';
import { CustomerDetailContent } from '@/components/customers/customer-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = { title: 'Customer', robots: { index: false, follow: false } };

export default async function CustomerPage({ params }: PageProps<'/admin/customers/[customerId]'>) {
  const gate = await workspaceGate('admin', CUSTOMERS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={CUSTOMERS_PATH} />;
  }
  const { user, csrf } = gate;
  const { customerId } = await params;

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: 'Customer' }]}>
      {user.permissions.includes('customers.read') ? (
        <Suspense fallback={<DetailSkeleton label="Loading the customer" />}>
          <CustomerDetailContent
            customerId={customerId}
            permissions={user.permissions}
            csrf={csrf}
          />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          <PageToolbar back={{ href: CUSTOMERS_PATH, label: 'Customers' }} title="Customer" />
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="customers.read" />
          </section>
        </div>
      )}
    </WorkspaceShell>
  );
}
