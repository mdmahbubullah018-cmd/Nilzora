import type { AdminCategory, CategoryCampaign } from '@nilzora/contracts';
import { buttonClasses, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { FolderTree, Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Chip, DataTable, DataTableEmpty, PageToolbar } from '@/components/admin-kit';
import { GlassTable, TOUCH, ViewOnly } from './catalog-ui';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatCount, formatMoney, plural } from '@/lib/format';
import { productListHref } from './catalog-query';
import { CategoryOrderButtons, CategoryVisibilityForm } from './category-forms';
import { categoryRows, MAX_CATEGORY_DEPTH } from './category-tree';
import { SuccessNotice } from './page-states';
import { ProductTile } from './product-tile';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';

/**
 * A category's promotion, read from the campaign engine: the live campaign that reaches
 * its products, or the shortcut that starts one with this category already chosen.
 */
function CategoryPromotion({
  category,
  campaign,
  canCreate,
}: {
  category: AdminCategory;
  campaign: CategoryCampaign | undefined;
  canCreate: boolean;
}) {
  if (campaign === undefined) {
    return canCreate ? (
      <Link
        href={`/admin/discounts/new?category=${category.id}` as Route}
        className="nz-tap text-sm text-link underline-offset-4 hover:underline"
      >
        Create category sale
        <span className="sr-only"> for {category.name}</span>
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">
        <AutoText>None</AutoText>
      </span>
    );
  }
  const value =
    campaign.discountKind === 'fixed'
      ? `${formatMoney(campaign.discountValue)} off`
      : `${String(campaign.discountValue)}% off`;
  return (
    <div className="grid gap-0.5">
      <Link
        href={`/admin/discounts/${campaign.campaignId}` as Route}
        className="nz-tap max-w-48 truncate text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        {campaign.customerTitle.trim() === '' ? 'Campaign' : campaign.customerTitle}
      </Link>
      <span className="text-xs text-muted-foreground">
        {value} · <CountText count={campaign.productCount} one="product" />
      </span>
    </div>
  );
}

export function categoryPath(categoryId: string): Route {
  return `/admin/categories/${categoryId}` as Route;
}

export interface CategoryListViewProps {
  categories: readonly AdminCategory[];
  /** products.publish: create, edit, show and hide categories. */
  canManage: boolean;
  csrf: CsrfInput;
  notice?: string | undefined;
  /** The live discount campaigns that reach each category, by category id. */
  campaignsByCategory?: ReadonlyMap<string, CategoryCampaign>;
  /** discounts.create: the "create a category sale" shortcut. */
  canManageCampaigns?: boolean;
}

/** Every category in storefront order, hidden ones included, with product counts. */
export function CategoryListView({
  categories,
  canManage,
  csrf,
  notice,
  campaignsByCategory,
  canManageCampaigns = false,
}: CategoryListViewProps) {
  const hidden = categories.filter((category) => !category.isActive).length;
  const rows = categoryRows(categories);
  const subcategories = categories.filter((category) => category.parentId !== null).length;
  const newCategory = canManage ? (
    <Link href="/admin/categories/new" className={buttonClasses({ className: TOUCH })}>
      <Plus aria-hidden="true" strokeWidth={1.75} />
      <AutoText>New category</AutoText>
    </Link>
  ) : null;

  return (
    <>
      <PageToolbar
        icon={FolderTree}
        title="Categories"
        description="How the storefront groups products: categories, and the subcategories under them, in storefront order. Hidden categories and their products never appear to shoppers."
        meta={
          categories.length > 0 ? (
            <>
              <span>
                <CountText
                  count={categories.length - subcategories}
                  one="category"
                  many="categories"
                />
              </span>
              {subcategories > 0 ? (
                <span>
                  <CountText count={subcategories} one="subcategory" many="subcategories" />
                </span>
              ) : null}
              {hidden > 0 ? <span>{formatCount(hidden)} hidden</span> : null}
            </>
          ) : undefined
        }
        actions={newCategory}
      />
      <SuccessNotice>
        <AutoText value={notice} />
      </SuccessNotice>

      <GlassTable label="Category list">
        <DataTable caption="Categories" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <AutoText>Category</AutoText>
              </TableHead>
              <TableHead className="text-right">
                <AutoText>Products</AutoText>
              </TableHead>
              <TableHead className="text-right">
                <AutoText>Order</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Storefront</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Promotion</AutoText>
              </TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">
                    <AutoText>Actions</AutoText>
                  </span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          {categories.length > 0 ? (
            <TableBody>
              {rows.map((row) => {
                const { category, depth } = row;
                return (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div
                        className="flex min-w-56 items-center gap-3"
                        style={depth > 0 ? { paddingLeft: `${String(depth * 1.5)}rem` } : undefined}
                      >
                        {category.parentId ? (
                          <span aria-hidden="true" className="-mr-1 w-3 text-muted-foreground">
                            ↳
                          </span>
                        ) : null}
                        {category.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
                          <img
                            src={category.imageUrl}
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded-md object-cover ring-1 ring-hairline"
                          />
                        ) : (
                          <ProductTile categorySlug={category.slug} />
                        )}
                        <div className="grid min-w-0 gap-0.5">
                          {canManage ? (
                            <Link
                              href={categoryPath(category.id)}
                              className="nz-tap truncate rounded-sm font-medium text-foreground hover:text-link hover:underline"
                            >
                              {category.name}
                            </Link>
                          ) : (
                            <span className="truncate font-medium text-foreground">
                              {category.name}
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            /categories/{category.slug}
                          </span>
                          {category.parentId ? (
                            <span className="text-xs text-muted-foreground">
                              In{' '}
                              {categories.find((parent) => parent.id === category.parentId)?.name ??
                                'another category'}
                            </span>
                          ) : null}
                          {category.description ? (
                            <span className="max-w-md truncate text-xs text-muted-foreground">
                              {category.description}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.branchProductCount > 0 ? (
                        <Link
                          href={productListHref({ category: category.id, page: 1 })}
                          className="nz-tap inline-block min-w-8 rounded-sm font-medium text-link underline-offset-4 hover:underline"
                          aria-label={`${plural(row.branchProductCount, 'product')} in ${category.name}${row.childCount > 0 ? ' and its subcategories' : ''}`}
                        >
                          {formatCount(row.branchProductCount)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                      {row.childCount > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          <CountText
                            count={row.childCount}
                            one="subcategory"
                            many="subcategories"
                          />
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {canManage ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          <CategoryOrderButtons
                            csrf={csrf}
                            category={category}
                            parentId={row.parentId}
                            groupIds={row.groupIds}
                            position={row.position}
                          />
                          <span className="w-6 text-right">{row.position + 1}</span>
                        </span>
                      ) : (
                        row.position + 1
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {category.isActive ? (
                          <Chip tone="success" dot>
                            <AutoText>Shown</AutoText>
                          </Chip>
                        ) : (
                          <Chip tone="neutral" dot>
                            <AutoText>Hidden</AutoText>
                          </Chip>
                        )}
                        {category.isFeatured ? (
                          <Chip tone="violet">
                            <AutoText>Featured</AutoText>
                          </Chip>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <CategoryPromotion
                        category={category}
                        campaign={campaignsByCategory?.get(category.id)}
                        canCreate={canManageCampaigns}
                      />
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={categoryPath(category.id)}
                            className={buttonClasses({
                              variant: 'ghost',
                              size: 'sm',
                              className: TOUCH,
                            })}
                          >
                            Edit{' '}
                            <span className="sr-only">
                              <AutoText value={category.name} />
                            </span>
                          </Link>
                          {depth + 1 < MAX_CATEGORY_DEPTH ? (
                            <Link
                              href={`/admin/categories/new?parent=${category.id}` as Route}
                              className={buttonClasses({
                                variant: 'ghost',
                                size: 'sm',
                                className: TOUCH,
                              })}
                            >
                              Add subcategory <span className="sr-only">to {category.name}</span>
                            </Link>
                          ) : null}
                          <CategoryVisibilityForm csrf={csrf} category={category} />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={canManage ? 6 : 5}
              icon={FolderTree}
              title="No categories yet"
              description={
                canManage
                  ? 'Create a category before adding products: every product belongs to one.'
                  : 'Categories appear here once an admin creates them.'
              }
              action={newCategory}
            />
          )}
        </DataTable>
      </GlassTable>
      {!canManage ? (
        <ViewOnly>
          Your account can view categories. Creating and changing them needs the “Publish products”
          permission.
        </ViewOnly>
      ) : null}
    </>
  );
}
