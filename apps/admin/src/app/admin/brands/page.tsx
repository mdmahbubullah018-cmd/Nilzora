import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { adminRead } from '@/components/admin-kit/read';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { BrandsView } from '@/components/merch/brand-views';
import { filterBrands, parseBrandFilters } from '@/components/merch/brand-query';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { storefrontBaseUrl } from '@/lib/storefront-url';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Brands', robots: { index: false, follow: false } };

/** Every brand, hidden ones included: create, edit, logo and visibility. */
export default async function BrandsPage({ searchParams }: PageProps<'/admin/brands'>) {
  const gate = await workspaceGate('admin', '/admin/brands');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/brands" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );
  if (!user.permissions.includes('products.read')) {
    return shell(<PageForbidden title="Brands" permission="products.read" />);
  }

  const filters = parseBrandFilters(await searchParams);
  const brands = await adminRead((api, token) =>
    api.adminListBrands(token).then((response) => response.brands),
  );
  if (brands.kind === 'signed_out') redirect(signInPath('/admin/brands'));
  if (brands.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Brands"
        failure={brands.kind}
        retryHref="/admin/brands"
        permission="products.read"
      />,
    );
  }
  return shell(
    <BrandsView
      brands={filterBrands(brands.value, filters)}
      totalBrands={brands.value.length}
      filters={filters}
      storeUrl={storefrontBaseUrl()}
      canManage={user.permissions.includes('products.publish')}
      csrf={csrf}
    />,
  );
}
