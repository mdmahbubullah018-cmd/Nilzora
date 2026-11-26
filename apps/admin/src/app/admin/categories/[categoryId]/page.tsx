import { adminCategoryRefSchema } from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { FolderTree, ImageIcon, Layers, Search } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { productListHref } from '@/components/catalog/catalog-query';
import { CategoryBannerForm, CategoryImageForm } from '@/components/catalog/category-image-form';
import { CategoryForm, CategoryVisibilityForm } from '@/components/catalog/category-forms';
import { readCategories } from '@/components/catalog/load-catalog';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { DeleteCategoryForm } from '@/components/catalog/delete-forms';
import { CategoryZoneForm } from '@/components/zones/assignment-forms';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';

export const metadata: Metadata = { title: 'Category', robots: { index: false, follow: false } };

const back = { href: '/admin/categories', label: 'Categories' } as const;

/** Edits one category; showing or hiding it is confirmed separately. */
export default async function CategoryPage({
  params,
}: PageProps<'/admin/categories/[categoryId]'>) {
  const { categoryId: rawId } = await params;
  const categoryId = adminCategoryRefSchema.shape.id.safeParse(rawId).success ? rawId : undefined;
  const pagePath: Route = categoryId
    ? (`/admin/categories/${categoryId}` as Route)
    : '/admin/categories';

  const gate = await workspaceGate('admin', pagePath);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={pagePath} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode, crumb = 'Category') => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: crumb }]}>
      {children}
    </WorkspaceShell>
  );

  for (const permission of ['products.read', 'products.publish'] as const) {
    if (!user.permissions.includes(permission)) {
      return shell(<PageForbidden title="Category" permission={permission} back={back} />);
    }
  }
  if (!categoryId) {
    return shell(
      <PageFailure
        title="Category"
        failure="not_found"
        retryHref="/admin/categories"
        back={back}
      />,
    );
  }

  // There is no single-category read: the list holds every category, hidden ones included.
  const categories = await readCategories();
  if (categories.kind === 'signed_out') redirect(signInPath(pagePath));
  if (categories.kind !== 'ok') {
    return shell(
      <PageFailure title="Category" failure={categories.kind} retryHref={pagePath} back={back} />,
    );
  }
  const category = categories.value.find((item) => item.id === categoryId);
  const parents = categories.value;
  if (!category) {
    return shell(
      <PageFailure title="Category" failure="not_found" retryHref={pagePath} back={back} />,
    );
  }

  // The zone panel is optional: without the permission (or before the store's zone functions
  // are deployed) the page simply does not offer it.
  const canManageZones = user.permissions.includes('zones.manage');
  const [zoneList, categoryZones] = canManageZones
    ? await Promise.all([
        adminRead((api, token) =>
          api.adminListZones(token, { pageSize: 100 }).then((response) => response.zones),
        ),
        adminRead((api, token) => api.adminCategoryZones(token, categoryId)),
      ])
    : [null, null];

  return shell(
    <>
      <PageToolbar
        back={back}
        title={category.name}
        icon={FolderTree}
        eyebrow={
          category.isActive ? (
            <Chip tone="success" dot><AutoText>Shown in the storefront</AutoText></Chip>
          ) : (
            <Chip tone="neutral" dot><AutoText>Hidden from the storefront</AutoText></Chip>
          )
        }
        meta={
          category.productCount > 0 ? (
            <Link
              href={productListHref({ category: category.id, page: 1 })}
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              <CountText count={category.productCount} one="product" />
            </Link>
          ) : (
            <span><AutoText>No products yet</AutoText></span>
          )
        }
        actions={<CategoryVisibilityForm csrf={csrf} category={category} />}
      />
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <section
          aria-label="Category details"
          className="nz-panel-strong nz-panel-sheen rounded-2xl border p-5 sm:p-6 lg:col-span-2"
        >
          <CategoryForm csrf={csrf} category={category} parents={parents} />
        </section>
        <div className="grid gap-6">
          <SectionCard
            title="Category logo"
            icon={ImageIcon}
            description="The small square picture that stands for this category in lists and menus."
          >
            <CategoryImageForm categoryId={category.id} imageUrl={category.imageUrl} csrf={csrf} />
          </SectionCard>
          <SectionCard
            title="Category banner"
            icon={ImageIcon}
            description="The wide picture across the top of this category's page. Optional; most useful for subcategories."
          >
            <CategoryBannerForm
              categoryId={category.id}
              bannerUrl={category.bannerUrl ?? null}
              csrf={csrf}
            />
          </SectionCard>
          {zoneList?.kind === 'ok' && categoryZones?.kind === 'ok' ? (
            <SectionCard
              title="Shopping zones"
              icon={Layers}
              description="Every product in this category appears in these collections, unless it has zones of its own."
            >
              <CategoryZoneForm
                categoryId={category.id}
                zones={zoneList.value}
                selected={categoryZones.value.zoneIds}
                csrf={csrf}
              />
            </SectionCard>
          ) : null}
          <SectionCard
            title="Search metadata"
            icon={Search}
            description="The title, description and share preview search engines read."
          >
            <Link
              href={`/admin/seo/category/${category.id}` as Route}
              className={buttonClasses({
                variant: 'outline',
                className: 'w-full rounded-xl max-sm:min-h-11',
              })}
            ><AutoText>Edit search metadata</AutoText></Link>
          </SectionCard>
          {user.permissions.includes('products.publish') ? (
            <SectionCard
              title="Delete category"
              description="Only a category without products or subcategories can be deleted. To hide it instead, turn it off above."
            >
              <DeleteCategoryForm categoryId={category.id} name={category.name} csrf={csrf} />
            </SectionCard>
          ) : null}
        </div>
      </div>
    </>,
    category.name,
  );
}
