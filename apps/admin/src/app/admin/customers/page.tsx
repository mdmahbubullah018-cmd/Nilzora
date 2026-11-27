import { buttonClasses } from '@nilzora/ui';
import { Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { ExportMenu } from '@/components/admin-kit/export-menu';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { TableSkeleton } from '@/components/admin-kit/skeletons';
import { ForbiddenState } from '@/components/admin-kit/states';
import {
  customersHref,
  CUSTOMERS_PATH,
  parseCustomerFilters,
} from '@/components/customers/customer-query';
import { CustomersResults } from '@/components/customers/customer-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { exportRange } from '@/lib/export-range';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Customers', robots: { index: false, follow: false } };

/** Customer accounts with their order counts, searchable by name, email or phone. */
export default async function CustomersPage({ searchParams }: PageProps<'/admin/customers'>) {
  const gate = await workspaceGate('admin', CUSTOMERS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={CUSTOMERS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('customers.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Users} title="Customers" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="customers.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const { page, ...filters } = parseCustomerFilters(await searchParams);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Users}
          title="Customers"
          description="Storefront accounts, newest first. Open an account to see its orders or to suspend it."
          actions={
            <>
              <ExportMenu
                kind="customers"
                filters={{ ...exportRange({}), status: filters.status, q: filters.q }}
              />
              <Link
                href="/admin/customers/insights"
                className={buttonClasses({
                  variant: 'outline',
                  size: 'sm',
                  className: 'h-9 rounded-xl max-sm:h-11',
                })}
              >
                <AutoText>Spending and segments</AutoText>
              </Link>
            </>
          }
        />
        <Suspense
          key={customersHref(filters, page)}
          fallback={<TableSkeleton caption="Loading customers" columns={6} />}
        >
          <CustomersResults filters={filters} page={page} now={new Date()} />
        </Suspense>
      </div>
    </WorkspaceShell>
  );
}
