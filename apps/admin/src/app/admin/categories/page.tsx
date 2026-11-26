import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { CategoryListView } from '@/components/catalog/category-list-view';
import { adminRead } from '@/components/admin-kit/read';
import { readCategories } from '@/components/catalog/load-catalog';
import { categoryNotice } from '@/components/catalog/notices';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Categories', robots: { index: false, follow: false } };

/** Every category, hidden ones included, with product counts and visibility controls. */
export default async function CategoriesPage({ searchParams }: PageProps<'/admin/categories'>) {
  const gate = await workspaceGate('admin', '/admin/categories');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/categories" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('products.read')) {
    return shell(<PageForbidden title="Categories" permission="products.read" />);
  }

  const categories = await readCategories();
  if (categories.kind === 'signed_out') redirect(signInPath('/admin/categories'));
  if (categories.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Categories"
        failure={categories.kind}
        retryHref="/admin/categories"
        permission="products.read"
      />,
    );
  }
  // The promotion column is a convenience: when the campaign read fails, the categories
  // still render and the column simply shows nothing.
  const promotions = user.permissions.includes('discounts.view')
    ? await adminRead((api, token) => api.adminCategoryCampaigns(token))
    : null;
  const byCategory = new Map(
    promotions?.kind === 'ok'
      ? promotions.value.campaigns.map((campaign) => [campaign.categoryId, campaign] as const)
      : [],
  );

  return shell(
    <CategoryListView
      categories={categories.value}
      canManage={user.permissions.includes('products.publish')}
      csrf={csrf}
      notice={categoryNotice((await searchParams).notice)}
      campaignsByCategory={byCategory}
      canManageCampaigns={user.permissions.includes('discounts.create')}
    />,
  );
}
