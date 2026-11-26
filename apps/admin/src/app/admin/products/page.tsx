import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { parseProductListParams } from '@/components/catalog/catalog-query';
import { anySignedOut, loadProductList } from '@/components/catalog/load-catalog';
import { productNotice } from '@/components/catalog/notices';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { ProductListView } from '@/components/catalog/product-list-view';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Products', robots: { index: false, follow: false } };

/** Every product in any state, filterable by status, review, category and stock. */
export default async function ProductsPage({ searchParams }: PageProps<'/admin/products'>) {
  // The page's own check: never rely on the layout alone.
  const gate = await workspaceGate('admin', '/admin/products');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/products" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('products.read')) {
    return shell(<PageForbidden title="Products" permission="products.read" />);
  }

  const query = await searchParams;
  const params = parseProductListParams(query);
  const { products, categories } = await loadProductList(params);
  if (anySignedOut([products, categories])) redirect(signInPath('/admin/products'));

  if (products.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Products"
        failure={products.kind === 'signed_out' ? 'unavailable' : products.kind}
        retryHref="/admin/products"
        resetHref="/admin/products"
        permission="products.read"
      />,
    );
  }
  return shell(
    <ProductListView
      params={params}
      list={products.value}
      categories={categories.kind === 'ok' ? categories.value : null}
      canCreate={user.permissions.includes('products.create')}
      canEdit={user.permissions.includes('products.update')}
      canPublish={user.permissions.includes('products.publish')}
      owner={user.role === 'super_admin'}
      csrf={csrf}
      now={new Date()}
      notice={productNotice(query.notice)}
    />,
  );
}
