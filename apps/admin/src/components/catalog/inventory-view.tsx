import {
  INVENTORY_REASONS,
  LOW_STOCK_THRESHOLD,
  PRODUCT_STATUSES,
  type AdminCategory,
  type AdminProductListResponse,
  type InventoryMovementListResponse,
} from '@nilzora/contracts';
import {
  buttonClasses,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nilzora/ui';
import {
  Boxes,
  History,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  PackageX,
  TriangleAlert,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  DataTable,
  DataTableEmpty,
  FilterBar,
  FilterChips,
  KpiCard,
  Pagination,
  PRODUCT_STATUS,
  ProductStatusBadge,
  ReadState,
  SearchFilter,
  SectionCard,
  SegmentedNav,
  SelectFilter,
  SortableHead,
  type FilterChip,
  type ReadFailure,
} from '@/components/admin-kit';
import { formatCount, formatDateTime, plural } from '@/lib/format';
import {
  DEFAULT_PRODUCT_SORT,
  hasProductFilters,
  movementListHref,
  productListHref,
  productSortParam,
  type ProductSortState,
  type MovementListParams,
  type ProductListParams,
} from './catalog-query';
import { ATTENTION_LIMIT, type StockCounts } from './load-catalog';
import { INVENTORY_REASON, movementActor, OrderLink, ReasonBadge, StockChange } from './movements';
import {
  productFilterChips,
  ProductCell,
  productPath,
  STOCK_FILTER_LABELS,
} from './product-list-view';
import { StockMeter } from './product-tile';
import { EmptyPanel, GlassTable, TableHeading, TOUCH } from './catalog-ui';
import { categoryFilterOptions } from './category-tree';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';

type Outcome<T> = { kind: 'ok'; value: T } | { kind: ReadFailure };

export type InventoryTab = 'stock' | 'movements';

export function InventoryTabs({ current }: { current: InventoryTab }) {
  return (
    <SegmentedNav
      label="Inventory view"
      current={current}
      options={[
        { key: 'stock', label: 'Stock levels', href: '/admin/inventory' },
        { key: 'movements', label: 'Stock ledger', href: movementListHref({ page: 1 }) },
      ]}
    />
  );
}

/** The inventory list with the urgent filter (products on sale) and a stock level. */
export function onSaleStockHref(stock?: 'low' | 'out'): Route {
  return productListHref({ status: 'active', stock, page: 1 }, {}, '/admin/inventory');
}

/**
 * Headline counts. The urgent figures count products on sale with exactly the filters
 * of the lists they link to, so a figure and its list always agree.
 */
export function StockKpis({ counts }: { counts: Outcome<StockCounts> }) {
  if (counts.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={counts.kind} retryHref="/admin/inventory" compact />
      </section>
    );
  }
  const { total, active, low, out } = counts.value;
  return (
    <section aria-label="Stock summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="On sale"
        value={formatCount(active)}
        icon={Boxes}
        tone="primary"
        footnote={`Of ${plural(total, 'product')} in any status`}
        href={onSaleStockHref()}
      />
      <KpiCard
        label="In stock"
        value={formatCount(Math.max(0, active - low))}
        icon={PackageCheck}
        tone="success"
        footnote={`On sale with more than ${String(LOW_STOCK_THRESHOLD)} units`}
      />
      <KpiCard
        label="Low or out of stock"
        value={formatCount(low)}
        icon={PackageMinus}
        tone={low > 0 ? 'warning' : 'neutral'}
        footnote={`On sale with ${String(LOW_STOCK_THRESHOLD)} units or fewer`}
        href={onSaleStockHref('low')}
      />
      <KpiCard
        label="Out of stock"
        value={formatCount(out)}
        icon={PackageX}
        tone={out > 0 ? 'danger' : 'neutral'}
        footnote="On sale with no units left"
        href={onSaleStockHref('out')}
      />
    </section>
  );
}

/** Low and sold-out products, lowest stock first, with a way to restock each. */
export function AttentionSection({ attention }: { attention: Outcome<AdminProductListResponse> }) {
  return (
    <SectionCard
      title="Needs attention"
      icon={TriangleAlert}
      description={`Products on sale at ${String(LOW_STOCK_THRESHOLD)} units or fewer, lowest stock first`}
      flush
    >
      {attention.kind !== 'ok' ? (
        <ReadState failure={attention.kind} retryHref="/admin/inventory" compact />
      ) : attention.value.products.length === 0 ? (
        <EmptyPanel
          icon={PackageCheck}
          tone="success"
          title="Stock levels are healthy"
          description={`Every product on sale has more than ${String(LOW_STOCK_THRESHOLD)} units.`}
          className="pb-10"
        />
      ) : (
        <>
          <ul className="grid gap-x-6 border-t border-hairline sm:grid-cols-2 xl:grid-cols-3">
            {attention.value.products.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 border-b border-hairline px-5 py-3 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <ProductCell product={product} />
                </div>
                <div className="grid w-36 shrink-0 gap-1.5">
                  <StockMeter quantity={product.stockQuantity} showBadge={false} />
                  <Link
                    href={productPath(product.id)}
                    className="nz-tap text-xs font-medium text-link underline-offset-4 hover:underline"
                  >
                    Restock <span className="sr-only"><AutoText value={product.name} /></span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {attention.value.total > attention.value.products.length ? (
            <p className="px-5 py-3 text-sm text-muted-foreground sm:px-6">
              Showing the {formatCount(ATTENTION_LIMIT)} with the least stock of{' '}
              <CountText count={attention.value.total} one="product" />.{' '}
              <Link
                href={onSaleStockHref('low')}
                className="font-medium text-link underline-offset-4 hover:underline"
              ><AutoText>See them all</AutoText></Link>
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function stockChips(params: ProductListParams, categories: readonly AdminCategory[]): FilterChip[] {
  return productFilterChips({ ...params, moderation: undefined }, categories, '/admin/inventory');
}

/** Every product's stock level, filterable and paged. */
export function StockLevelsSection({
  params,
  list,
  categories,
}: {
  params: ProductListParams;
  list: AdminProductListResponse;
  categories: readonly AdminCategory[] | null;
}) {
  const filtered = hasProductFilters({ ...params, moderation: undefined });
  const sort = params.sort ?? DEFAULT_PRODUCT_SORT;
  const sortHref = (next: ProductSortState) =>
    productListHref(params, { sort: next }, '/admin/inventory');
  return (
    <GlassTable
      label="Stock levels"
      footer={
        list.total > 0 ? (
          <Pagination
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            pageSize={list.pageSize}
            noun="products"
            hrefFor={(page) => productListHref(params, { page }, '/admin/inventory')}
          />
        ) : undefined
      }
      header={
        <>
        <TableHeading
          title="Stock levels"
          description="Exact units per product. Stock changes only through orders and recorded adjustments."
        />
        <FilterBar
          action="/admin/inventory"
          label="Filter stock levels"
          hidden={{ sort: productSortParam(params.sort) }}
          resetHref={filtered ? '/admin/inventory' : undefined}
        >
          <SearchFilter label="Search" defaultValue={params.q} placeholder="Name, SKU or address" />
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
          <SelectFilter
            name="status"
            label="Status"
            allLabel="Any status"
            defaultValue={params.status}
            options={PRODUCT_STATUSES.map((status) => ({
              value: status,
              label: PRODUCT_STATUS[status].label,
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
        </FilterBar>
        <FilterChips chips={stockChips(params, categories ?? [])} clearHref="/admin/inventory" />
        </>
      }
    >
      <DataTable caption="Stock levels" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead column="name" sort={sort} hrefFor={sortHref}><AutoText>Product</AutoText></SortableHead>
            <TableHead><AutoText>Category</AutoText></TableHead>
            <TableHead><AutoText>Status</AutoText></TableHead>
            <SortableHead column="stock" sort={sort} hrefFor={sortHref}><AutoText>Stock</AutoText></SortableHead>
            <TableHead className="text-right"><AutoText>Per order</AutoText></TableHead>
            <TableHead>
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
                <TableCell><AutoText value={product.category.name} /></TableCell>
                <TableCell>
                  <ProductStatusBadge status={product.status} />
                </TableCell>
                <TableCell>
                  <StockMeter quantity={product.stockQuantity} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  up to {formatCount(product.maxOrderQuantity)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={movementListHref({ product: product.id, page: 1 })}
                      className={buttonClasses({ variant: 'ghost', size: 'sm', className: TOUCH })}
                    >
                      Ledger <span className="sr-only">for {product.name}</span>
                    </Link>
                    <Link
                      // Lands on the product's inventory section (its stock per variant, if it has any).
                      href={`${productPath(product.id)}#product-inventory` as Route}
                      className={buttonClasses({ variant: 'outline', size: 'sm', className: TOUCH })}
                    >
                      Adjust <span className="sr-only"><AutoText value={product.name} /></span>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={PackageSearch}
            title={filtered ? 'No products match these filters' : 'No products yet'}
            description={
              filtered
                ? 'Try another search or clear the filters.'
                : 'Stock levels appear here once products are created.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

/** The stock ledger: every change to stock, newest first. */
export function MovementLedgerSection({
  params,
  movements,
  products,
}: {
  params: MovementListParams;
  movements: InventoryMovementListResponse;
  /** For the product filter; null when the list could not be read. */
  products: AdminProductListResponse | null;
}) {
  const filtered = Boolean(params.product || params.reason);
  const productOptions = [...(products?.products ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({ value: product.id, label: `${product.name} (${product.sku})` }));
  const selectedName =
    products?.products.find((product) => product.id === params.product)?.name ??
    movements.movements.find((movement) => movement.product.id === params.product)?.product.name;
  // A product outside the offered list stays selectable once it is filtered on.
  if (params.product && !productOptions.some((option) => option.value === params.product)) {
    productOptions.unshift({ value: params.product, label: selectedName ?? 'Selected product' });
  }

  const chips: FilterChip[] = [];
  if (params.product) {
    chips.push({
      key: 'product',
      label: `Product: ${selectedName ?? 'Selected product'}`,
      removeHref: movementListHref(params, { product: undefined }),
    });
  }
  if (params.reason) {
    chips.push({
      key: 'reason',
      label: `Reason: ${INVENTORY_REASON[params.reason].label}`,
      removeHref: movementListHref(params, { reason: undefined }),
    });
  }

  return (
    <GlassTable
      label="Stock ledger"
      footer={
        movements.total > 0 ? (
          <Pagination
            page={movements.page}
            totalPages={movements.totalPages}
            total={movements.total}
            pageSize={movements.pageSize}
            noun="movements"
            hrefFor={(page) => movementListHref(params, { page })}
          />
        ) : undefined
      }
      header={
        <>
        <TableHeading
          title="Stock ledger"
          description="Every change to stock, newest first: opening stock, orders, cancellations and adjustments with their reasons."
        />
        <FilterBar
          action="/admin/inventory"
          label="Filter the stock ledger"
          hidden={{ view: 'movements' }}
          resetHref={filtered ? movementListHref({ page: 1 }) : undefined}
        >
          {productOptions.length > 0 ? (
            <SelectFilter
              name="product"
              label="Product"
              allLabel="All products"
              defaultValue={params.product}
              options={productOptions}
              className="min-w-56"
            />
          ) : null}
          <SelectFilter
            name="reason"
            label="Reason"
            allLabel="Any reason"
            defaultValue={params.reason}
            options={INVENTORY_REASONS.map((reason) => ({
              value: reason,
              label: INVENTORY_REASON[reason].label,
            }))}
          />
        </FilterBar>
        <FilterChips chips={chips} clearHref={movementListHref({ page: 1 })} />
        </>
      }
    >
      <DataTable caption="Stock ledger" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>When</AutoText></TableHead>
            <TableHead><AutoText>Product</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Change</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Stock after</AutoText></TableHead>
            <TableHead><AutoText>Reason</AutoText></TableHead>
            <TableHead>By</TableHead>
            <TableHead><AutoText>Order</AutoText></TableHead>
          </TableRow>
        </TableHeader>
        {movements.movements.length > 0 ? (
          <TableBody>
            {movements.movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  <time dateTime={movement.createdAt}><AutoText value={formatDateTime(movement.createdAt)} /></time>
                </TableCell>
                <TableCell>
                  <div className="grid gap-0.5">
                    <Link
                      href={productPath(movement.product.id)}
                      className="nz-tap max-w-64 truncate rounded-sm font-medium text-foreground hover:text-link hover:underline"
                    >
                      {movement.product.name}
                    </Link>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {movement.product.sku}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <StockChange change={movement.change} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(movement.stockAfter)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="grid min-w-40 gap-1">
                    <ReasonBadge reason={movement.reason} />
                    {movement.note ? (
                      <span className="max-w-72 text-xs wrap-break-word text-muted-foreground">
                        {movement.note}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell><AutoText value={movementActor(movement)} /></TableCell>
                <TableCell>
                  {movement.orderNumber ? (
                    <OrderLink orderNumber={movement.orderNumber} />
                  ) : (
                    <>
                      <span aria-hidden="true" className="text-muted-foreground">
                        —
                      </span>
                      <span className="sr-only"><AutoText>None</AutoText></span>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={7}
            icon={History}
            title={filtered ? 'No movements match these filters' : 'No stock movements yet'}
            description={
              filtered
                ? 'Try another product or reason.'
                : 'Opening stock, orders and adjustments are recorded here.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}
