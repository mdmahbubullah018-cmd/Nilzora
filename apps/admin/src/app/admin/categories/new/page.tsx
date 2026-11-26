import { FolderPlus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { CategoryForm } from '@/components/catalog/category-forms';
import {
  categoryPath,
  nextSortOrder,
  MAX_CATEGORY_DEPTH,
} from '@/components/catalog/category-tree';
import { readCategories } from '@/components/catalog/load-catalog';
import { PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'New category',
  robots: { index: false, follow: false },
};

const back = { href: '/admin/categories', label: 'Categories' } as const;
const TITLE = 'New category';

export default async function NewCategoryPage({
  searchParams,
}: PageProps<'/admin/categories/new'>) {
  const gate = await workspaceGate('admin', '/admin/categories/new');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/categories/new" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: TITLE }]}>
      {children}
    </WorkspaceShell>
  );

  // Categories are saved by products.publish holders (the API checks both again).
  for (const permission of ['products.read', 'products.publish'] as const) {
    if (!user.permissions.includes(permission)) {
      return shell(<PageForbidden title={TITLE} permission={permission} back={back} />);
    }
  }

  const categories = await readCategories();
  const parents = categories.kind === 'ok' ? categories.value : [];
  // "Add subcategory" on a category's row opens this page with that category preselected: only
  // a category that exists and still has room beneath it (the tree is three levels deep).
  const requested = (await searchParams).parent;
  const parent =
    typeof requested === 'string' &&
    categoryPath(parents, requested).length > 0 &&
    categoryPath(parents, requested).length < MAX_CATEGORY_DEPTH
      ? parents.find((candidate) => candidate.id === requested)
      : undefined;

  return shell(
    <>
      <PageToolbar
        back={back}
        icon={FolderPlus}
        title={parent ? `New subcategory in ${parent.name}` : TITLE}
        description="Categories group products in the storefront’s navigation and listings."
      />
      <section
        aria-label="Category details"
        className="nz-panel-strong nz-panel-sheen max-w-3xl rounded-2xl border p-5 sm:p-6"
      >
        <CategoryForm
          csrf={csrf}
          parents={parents}
          defaultParentId={parent?.id}
          defaultSortOrder={nextSortOrder(parents, parent?.id ?? null)}
        />
      </section>
    </>,
  );
}
