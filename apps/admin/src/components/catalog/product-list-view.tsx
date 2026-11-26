import {
  MODERATION_STATUSES,
  type AdminCategory,
  type AdminProductListResponse,
  type AdminProductSummary,
} from '@nilzora/contracts';
import { buttonClasses, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { ArrowDown, ArrowUpDown, Package, PackageSearch, Plus, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  DataTable,
  DataTableEmpty,
  FilterBar,
  FilterChips,
  MODERATION_STATUS,
  ModerationStatusBadge,
  PageToolbar,
  Pagination,
  PRODUCT_STATUS,
  ProductStatusBadge,
  SearchFilter,
  SegmentedNav,
  SelectFilter,
  SortableHead,
  type FilterChip,
} from '@/components/admin-kit';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatDate, formatMoney } from '@/lib/format';
import {
  DEFAULT_PRODUCT_SORT,
  hasProductFilters,
  productListHref,
  productSortParam,
  type ProductSortState,
  type ProductListParams,
  type StockFilter,
} from './catalog-query';
import { GlassTable, TOUCH } from './catalog-ui';
import { categoryFilterOptions, categoryPathLabel } from './category-tree';
import { SuccessNotice } from './page-states';
import { ProductRowActions } from './product-forms';
import { ProductShare } from './product-share';
import { ProductTile, StockMeter } from './product-tile';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

export const STOCK_FILTER_LABELS: Record<StockFilter, string> = {
  low: 'Low or out of stock',
  out: 'Out of stock',
};

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'On sale' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
] as const;

export function productPath(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

/** The chips for the filters in effect, each linking to the list without it. */
export function productFilterChips(
  params: ProductListParams,
  categories: readonly AdminCategory[],
  base: Route = '/admin/products',
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (params.q) {
    chips.push({
      key: 'q',
      label: `Search: ${params.q}`,
      removeHref: productListHref(params, { q: undefined }, base),
    });
  }
  if (params.status) {
    chips.push({
      key: 'status',
      label: `Status: ${PRODUCT_STATUS[params.status].label}`,
      removeHref: productListHref(params, { status: undefined }, base),
    });
  }
  if (params.moderation) {
    chips.push({
      key: 'moderation',
      label: `Review: ${MODERATION_STATUS[params.moderation].label}`,
      removeHref: productListHref(params, { moderation: undefined }, base),
    });
  }
  if (params.category) {
    const name = categoryPathLabel(categories, params.category);
    chips.push({
      key: 'category',
      label: `Category: ${name ?? 'Selected category'}`,
      removeHref: productListHref(params, { category: undefined }, base),
    });
  }
  if (params.stock) {
    chips.push({
      key: 'stock',
      label: `Stock: ${STOCK_FILTER_LABELS[params.stock]}`,
      removeHref: productListHref(params, { stock: undefined }, base),
    });
  }
  return chips;
}

/** Price with the former price struck through when there is one. */
export function PriceCell({
  priceMinor,
  compareAtPriceMinor,
}: Pick<AdminProductSummary, 'priceMinor' | 'compareAtPriceMinor'>) {
  return (
    <div className="grid justify-items-end">
      <span className="font-semibold text-foreground tabular-nums"><AutoText value={formatMoney(priceMinor)} /></span>
      {compareAtPriceMinor !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="sr-only">Former price </span>
          <s><AutoText value={formatMoney(compareAtPriceMinor)} /></s>
        </span>
      ) : null}
    </div>
  );
}

/** Tile, linked name, SKU and a featured mark: the first cell of every product row. */
export function ProductCell({ product }: { product: AdminProductSummary }) {
  return (
    <div className="flex min-w-56 items-center gap-3">
      <ProductTile categorySlug={product.category.slug} image={product.image} />
      <div className="grid min-w-0 gap-0.5">
        <Link
          href={productPath(product.id)}
          className="nz-tap flex max-w-72 items-center gap-1.5 truncate rounded-sm font-medium text-foreground hover:text-link hover:underline"
        >
          <span className="truncate"><AutoText value={product.name} /></span>
          {product.isFeatured ? (
            <>
              <Star
                aria-hidden="true"
                className="size-3.5 shrink-0 fill-warning text-warning"
                strokeWidth={1.75}
              />
              <span className="sr-only">(featured)</span>
            </>
          ) : null}
        </Link>
        <span className="font-mono text-[11px] text-muted-foreground"><AutoText value={product.sku} /></span>
      </div>
    </div>
  );
}

export interface ProductListViewProps {
  params: ProductListParams;
  list: AdminProductListResponse;
  /** Null when the category list could not be read (the filter is then left out). */
  categories: readonly AdminCategory[] | null;
  canCreate: boolean;
  /** products.update: the row action opens the product as its editor. */
  canEdit?: boolean;
  /** products.publish: status actions in each row. */
  canPublish?: boolean;
  /** super_admin: may publish content a review has not approved yet. */
  owner?: boolean;
  csrf: CsrfInput;
  now: Date;
  notice?: string | undefined;
}

const headClass =
  'h-10 px-4 text-left align-middle text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/**
 * "Updated" has one order only (newest first, the list's default), so its heading
 * either is the sort in effect or links to it; it never offers an order that does not exist.
 */
function UpdatedHead({ sort, href }: { sort: ProductSortState; href: Route }) {
  if (sort.column === 'updated') {
    return (
      <th scope="col" aria-sort="descending" className={`${headClass} hidden xl:table-cell`}>
        <span className="inline-flex items-center gap-1 text-foreground">
          Updated
          <ArrowDown aria-hidden="true" className="size-3.5" />
        </span>
      </th>
    );
  }
  return (
    <th scope="col" className={`${headClass} hidden xl:table-cell`}>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-sm uppercase transition-colors hover:text-foreground"
      >
        Updated
        <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-50" />
        <span className="sr-only"><AutoText>, sort newest first</AutoText></span>
      </Link>
    </th>
  );
}

/** The product table with its toolbar (status tabs, filters, chips) and pagination. */
export function ProductListView({
  params,
  list,
  categories,
  canCreate,
  canEdit = false,
  canPublish = false,
  owner = false,
  csrf,
  now,
  notice,
}: ProductListViewProps) {
  const filtered = hasProductFilters(params);
  const sort = params.sort ?? DEFAULT_PRODUCT_SORT;
  const sortHref = (next: ProductSortState) => productListHref(params, { sort: next });
  // Where a row action comes back to: this exact view.
  const here = productListHref(params, { page: list.page });
  const chips = productFilterChips(params, categories ?? []);
  const newProduct = canCreate ? (
    <Link href="/admin/products/new" className={buttonClasses({ className: TOUCH })}>
      <Plus aria-hidden="true" strokeWidth={1.75} /><AutoText>New product</AutoText></Link>
  ) : null;

  return (
    <>
      <PageToolbar
        icon={Package}
        title="Products"
        description="Every product in any state. New products start as drafts; their content is reviewed before they can go on sale."
        actions={newProduct}
      />
      <SuccessNotice><AutoText value={notice} /></SuccessNotice>

      <GlassTable
        label="Product list"
        header={
          <>
            <SegmentedNav
              label="Product status"
              current={params.status ?? 'all'}
              options={STATUS_TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                href: productListHref(params, { status: tab.key === 'all' ? undefined : tab.key }),
              }))}
            />
            <FilterBar
              action="/admin/products"
              label="Filter products"
              hidden={{ status: params.status, sort: productSortParam(params.sort) }}
              resetHref={filtered ? '/admin/products' : undefined}
            >
              <SearchFilter
                label="Search"
                defaultValue={params.q}
                placeholder="Name, SKU or address"
              />
              <SelectFilter
                name="moderation"
                label="Review"
                allLabel="Any review state"
                defaultValue={params.moderation}
                options={MODERATION_STATUSES.map((status) => ({
                  value: status,
                  label: MODERATION_STATUS[status].label,
                }))}
              />
              {categories ? (
                <SelectFilter
                  name="category"
                  label="Category"
                  allLabel="All categories"
                  defaultValue={params.category}
                  options={categoryFilterOptions(categories)}
                />
              ) : null}
              <SelectFilter
                name="stock"
                label="Stock"
                allLabel="Any stock level"
                defaultValue={params.stock}
                options={[
                  { value: 'low', label: STOCK_FILTER_LABELS.low },
                  { value: 'out', label: STOCK_FILTER_LABELS.out },
                ]}
              />
            </FilterBar>
            <FilterChips chips={chips} clearHref="/admin/products" />
          </>
        }
        footer={
          list.total > 0 ? (
            <Pagination
              page={list.page}
              totalPages={list.totalPages}
              total={list.total}
              pageSize={list.pageSize}
              noun="products"
              hrefFor={(page) => productListHref(params, { page })}
            />
          ) : undefined
        }
      >
        <DataTable caption="Products" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead column="name" sort={sort} hrefFor={sortHref}><AutoText>Product</AutoText></SortableHead>
              <TableHead className="hidden lg:table-cell"><AutoText>Category</AutoText></TableHead>
              <SortableHead column="stock" sort={sort} hrefFor={sortHref}><AutoText>Stock</AutoText></SortableHead>
              <SortableHead column="price" sort={sort} hrefFor={sortHref} align="right"><AutoText>Price</AutoText></SortableHead>
              <TableHead><AutoText>Status</AutoText></TableHead>
              <UpdatedHead sort={sort} href={sortHref(DEFAULT_PRODUCT_SORT)} />
              <TableHead className="text-right">
                <span className="sr-only"><AutoText>Actions</AutoText></span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {list.products.length > 0 ? (
            <TableBody>
              {list.products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <ProductCell product={product} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-body"><AutoText value={product.category.name} /></span>
                    {product.category.isActive ? null : (
                      <span className="block text-xs text-muted-foreground"><AutoText>Hidden category</AutoText></span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StockMeter quantity={product.stockQuantity} />
                  </TableCell>
                  <TableCell className="text-right">
                    <PriceCell
                      priceMinor={product.priceMinor}
                      compareAtPriceMinor={product.compareAtPriceMinor}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <ProductStatusBadge status={product.status} />
                      <ModerationStatusBadge status={product.moderationStatus} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <time
                      dateTime={product.updatedAt}
                      title={formatDate(product.updatedAt)}
                      className="text-muted-foreground"
                    >
                      <RelativeTimeText value={product.updatedAt} now={now} />
                    </time>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start justify-end gap-1">
                      {/* Public link to the live product; absent for drafts and archived rows. */}
                      <ProductShare product={product} variant="icon" />
                      {/*
                        One way into the product, named for what it does: the product page is
                        the editor for an account with products.update, and a read-only view
                        for everyone else. Same route either way — no second page or form.
                      */}
                      <Link
                        href={productPath(product.id)}
                        className={buttonClasses({
                          variant: 'ghost',
                          size: 'sm',
                          className: TOUCH,
                        })}
                      >
                        {canEdit ? 'Edit' : 'View'} <span className="sr-only"><AutoText value={product.name} /></span>
                      </Link>
                      {canPublish ? (
                        <ProductRowActions
                          csrf={csrf}
                          product={product}
                          returnTo={here}
                          owner={owner}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : filtered ? (
            <DataTableEmpty
              colSpan={7}
              icon={PackageSearch}
              title="No products match these filters"
              description="Try another search or clear the filters."
              action={
                <Link
                  href="/admin/products"
                  className={buttonClasses({ variant: 'outline', size: 'sm' })}
                ><AutoText>Clear filters</AutoText></Link>
              }
            />
          ) : (
            <DataTableEmpty
              colSpan={7}
              icon={Package}
              title="No products yet"
              description={
                canCreate
                  ? 'Create the first product as a draft, then submit its content for review.'
                  : 'Products appear here once staff create them.'
              }
              action={newProduct}
            />
          )}
        </DataTable>
      </GlassTable>
    </>
  );
}
