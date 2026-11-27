import type { AdminBrand } from '@nilzora/contracts';
import { BadgeCheck, ExternalLink, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { Chip } from '@/components/admin-kit/chip';
import { FilterBar, SearchFilter, SelectFilter } from '@/components/admin-kit/filter-bar';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel, TableHeading, ViewOnly } from '@/components/catalog/catalog-ui';
/* @/lib/format */
import { BrandLogo } from './brand-logo';
import { BRANDS_PATH, hasBrandFilters, type BrandFilters } from './brand-query';
import { BrandPreview } from './brand-preview';
import { BrandForm, BrandBannerForm, BrandLogoForm, DeleteBrandForm } from './merch-forms';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';
import { plural } from '@/lib/format';

const VIEW_OPTIONS = [
  { value: 'visible', label: 'Visible in the store' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'no-logo', label: 'Without a logo' },
];

function BrandSummary({ brand, canManage }: { brand: AdminBrand; canManage: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <BrandLogo brand={brand} />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold wrap-break-word text-foreground">
          {brand.name}
          <Chip tone={brand.isActive ? 'success' : 'neutral'} dot>
            {brand.isActive ? 'Visible' : 'Hidden'}
          </Chip>
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">
            /{brand.slug} · <CountText count={brand.productCount} one="product" /> on sale
          </span>
        </p>
      </div>
      {canManage ? (
        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-link ring-1 ring-hairline group-open:bg-info-soft max-sm:h-11">
          <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          <AutoText>Edit</AutoText>
        </span>
      ) : null}
    </div>
  );
}

export interface BrandsViewProps {
  /** The brands to list (after the filters). */
  brands: readonly AdminBrand[];
  /** Every brand there is, so a filter that matches none can still say how many exist. */
  totalBrands?: number;
  filters?: BrandFilters;
  /** The public store's origin for "Open in the store"; null when there is none. */
  storeUrl?: string | null;
  /** products.publish: create, edit, logo, visibility and delete (the API checks again). */
  canManage: boolean;
  csrf: CsrfInput;
}

/** Every brand, hidden ones included: create, edit, logo, visibility and delete. */
export function BrandsView({
  brands,
  totalBrands = brands.length,
  filters = { q: '', view: 'all' },
  storeUrl = null,
  canManage,
  csrf,
}: BrandsViewProps) {
  const filtered = hasBrandFilters(filters);
  return (
    <div className="grid gap-6">
      <PageToolbar
        icon={BadgeCheck}
        title="Brands"
        description="The makers and labels shoppers can browse at nilzora.com/brand-name. Assign products to a brand from each product’s page."
        meta={
          totalBrands > 0 ? (
            <span>
              <CountText count={totalBrands} one="brand" />
            </span>
          ) : undefined
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section
          aria-label="All brands"
          className="nz-panel-strong nz-panel-sheen min-w-0 overflow-hidden rounded-2xl border"
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-hairline p-4 sm:p-5">
            <TableHeading
              title={filtered ? `${plural(brands.length, 'brand')} found` : 'All brands'}
              description={
                canManage
                  ? 'Open a brand to edit it, change its logo, preview it as customers see it, or delete it.'
                  : undefined
              }
            />
            {totalBrands > 1 || filtered ? (
              <FilterBar
                action={BRANDS_PATH}
                resetHref={filtered ? BRANDS_PATH : undefined}
                label="Brand filters"
              >
                <SearchFilter
                  label="Search"
                  defaultValue={filters.q}
                  placeholder="Name, address or description"
                />
                <SelectFilter
                  name="view"
                  label="Show"
                  options={VIEW_OPTIONS}
                  defaultValue={filters.view === 'all' ? undefined : filters.view}
                  allLabel="All brands"
                />
              </FilterBar>
            ) : null}
          </div>
          {brands.length === 0 && filtered ? (
            <EmptyPanel
              icon={BadgeCheck}
              title="No brand matches"
              description={`None of the ${plural(totalBrands, 'brand')} matches these filters.`}
              className="py-14"
              action={
                <Link
                  href={BRANDS_PATH}
                  className="text-sm font-medium text-link underline-offset-4 hover:underline"
                >
                  <AutoText>Clear filters</AutoText>
                </Link>
              }
            />
          ) : brands.length === 0 ? (
            <EmptyPanel
              icon={BadgeCheck}
              title="No brands yet"
              description={
                canManage
                  ? 'Add the first brand with the form. A visible brand appears in the store right away, even before its first product.'
                  : 'Brands appear here once someone with publish permission adds them.'
              }
              className="py-14"
            />
          ) : (
            <ul className="divide-y divide-hairline">
              {brands.map((brand) => (
                <li key={brand.id}>
                  {canManage ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none px-4 py-4 transition-colors hover:bg-info-soft/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                        <BrandSummary brand={brand} canManage />
                      </summary>
                      <div className="grid gap-6 border-t border-hairline bg-neutral-soft/40 px-4 py-5 sm:px-5 lg:grid-cols-[2fr_1fr]">
                        <BrandForm brand={brand} csrf={csrf} />
                        <div className="grid content-start gap-5">
                          <BrandLogoForm brand={brand} csrf={csrf} />
                          <div className="border-t border-hairline pt-4">
                            <BrandBannerForm brand={brand} csrf={csrf} />
                          </div>
                          <div className="border-t border-hairline pt-4">
                            <DeleteBrandForm brand={brand} csrf={csrf} />
                          </div>
                        </div>
                        <div className="border-t border-hairline pt-5 lg:col-span-2">
                          <BrandPreview brand={brand} storeUrl={storeUrl} />
                        </div>
                      </div>
                    </details>
                  ) : (
                    <div className="px-4 py-4 sm:px-5">
                      <BrandSummary brand={brand} canManage={false} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage ? (
          <SectionCard
            title="Add a brand"
            icon={Plus}
            description="Its address is made from the name unless you choose one."
            className="nz-panel-strong xl:sticky xl:top-20"
          >
            <BrandForm csrf={csrf} stacked />
          </SectionCard>
        ) : (
          <ViewOnly>
            Your account can view brands. Adding, changing and deleting them needs the “Publish
            products” permission.
          </ViewOnly>
        )}
      </div>
    </div>
  );
}
