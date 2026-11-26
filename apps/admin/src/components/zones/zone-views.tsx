import type { AdminShoppingZone } from '@nilzora/contracts';
import { ZonePeekRail } from '@nilzora/ui';
import { ExternalLink, Layers, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { Chip } from '@/components/admin-kit/chip';
import { FilterBar, SearchFilter, SelectFilter } from '@/components/admin-kit/filter-bar';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel, TableHeading } from '@/components/catalog/catalog-ui';
/* @/lib/format */
import { ZoneForm } from './zone-forms';
import { hasZoneFilters, ZONES_PATH, type ZoneFilters } from './zone-query';
import { ZoneTilePreview } from './zone-tile';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';
import { plural } from '@/lib/format';

const VIEW_OPTIONS = [
  { value: 'shown', label: 'Shown in the store' },
  { value: 'hidden', label: 'Hidden' },
];

function ZoneSummary({ zone }: { zone: AdminShoppingZone }) {
  return (
    <div className="grid gap-3">
      <ZoneTilePreview zone={zone} />
      <div className="grid gap-1.5">
        <p className="flex flex-wrap items-center gap-2 font-semibold wrap-break-word text-foreground">
          {zone.name}
          <Chip tone={zone.isActive ? 'success' : 'neutral'} dot>
            {zone.isActive ? 'Shown' : 'Hidden'}
          </Chip>
        </p>
        <p className="text-sm text-muted-foreground">
          <CountText count={zone.productCount} one="product" /> ·{' '}
          <CountText count={zone.categoryCount} one="category" many="categories" /> inherited
          {zone.explicitProductCount > 0
            ? ` · ${plural(zone.explicitProductCount, 'pinned product')}`
            : ''}
        </p>
        {zone.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground"><AutoText value={zone.description} /></p>
        ) : null}
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">/products?zone={zone.slug}</span>
          {zone.audience ? <Chip tone="violet"><AutoText value={zone.audience} /></Chip> : null}
          <span>Position {zone.displayOrder}</span>
        </p>
      </div>
      <Link
        href={`/admin/zones/${zone.id}` as Route}
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-link ring-1 ring-hairline hover:bg-info-soft max-sm:h-11"
      >
        <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.75} /><AutoText>Open zone</AutoText></Link>
    </div>
  );
}

/**
 * How the storefront and the app show these zones: two banners across the width and a slice of
 * the third at the edge. Same geometry as the live row (@nilzora/ui ZonePeekRail), so an admin
 * approving a picture sees the frame it will really fill.
 */
function ZoneStorefrontPreview({ zones }: { zones: readonly AdminShoppingZone[] }) {
  const shown = zones.filter((zone) => zone.isActive).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <SectionCard
      title="As shoppers see it"
      icon={Layers}
      description="Two banners across, and the next one peeking in at the right edge. A hidden zone or an empty one never appears here."
    >
      <ZonePeekRail
        label="Storefront preview"
        items={shown.map((zone) => ({
          key: zone.id,
          content: <ZoneTilePreview zone={zone} />,
        }))}
      />
    </SectionCard>
  );
}

export interface ZonesViewProps {
  /** The zones to list (after the filters). */
  zones: readonly AdminShoppingZone[];
  /** Every zone there is, so a filter that matches none can still say how many exist. */
  totalZones?: number;
  filters?: ZoneFilters;
  /** Can create zones (the API checks `zones.manage` again on every write). */
  canManage: boolean;
  csrf: CsrfInput;
}

/** Shopping zones: the collections the storefront and the app browse by. */
export function ZonesView({
  zones,
  totalZones = zones.length,
  filters = { q: '', view: 'all' },
  canManage,
  csrf,
}: ZonesViewProps) {
  const filtered = hasZoneFilters(filters);
  return (
    <div className="grid gap-6">
      <PageToolbar
        icon={Layers}
        title="Shopping zones"
        description="Collections beside the category tree: Men's, Women's, Kids, or anything you invent. A product appears in a zone when it is pinned to it; otherwise it follows its category. A product in no zone stays in general browsing."
        meta={totalZones > 0 ? <span><CountText count={totalZones} one="zone" /></span> : undefined}
      />

      {zones.length > 0 ? <ZoneStorefrontPreview zones={zones} /> : null}

      {canManage ? (
        <SectionCard
          title="New zone"
          icon={Plus}
          description="Name it, then open it to add a picture and the products or categories it covers. An empty zone shows nowhere in the store, so you can build it quietly before it appears."
          className="nz-panel-strong"
        >
          <details className="group" open={totalZones === 0}>
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
              <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
              <span className="group-open:hidden"><AutoText>Create zone</AutoText></span>
              <span className="hidden group-open:inline"><AutoText>Close</AutoText></span>
            </summary>
            <div className="mt-5">
              <ZoneForm csrf={csrf} />
            </div>
          </details>
        </SectionCard>
      ) : null}

      <section
        aria-label="All shopping zones"
        className="nz-panel-strong nz-panel-sheen min-w-0 overflow-hidden rounded-2xl border"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-hairline p-4 sm:p-5">
          <TableHeading
            title={filtered ? `${plural(zones.length, 'zone')} found` : 'All zones'}
            description="First shown first in the store rail. Open a zone to change its picture, what it holds, or whether shoppers see it."
          />
          {totalZones > 1 || filtered ? (
            <FilterBar
              action={ZONES_PATH}
              resetHref={filtered ? ZONES_PATH : undefined}
              label="Zone filters"
            >
              <SearchFilter
                label="Search"
                defaultValue={filters.q}
                placeholder="Name, address, audience or description"
              />
              <SelectFilter
                name="view"
                label="Show"
                options={VIEW_OPTIONS}
                defaultValue={filters.view === 'all' ? undefined : filters.view}
                allLabel="All zones"
              />
            </FilterBar>
          ) : null}
        </div>
        {zones.length === 0 && filtered ? (
          <EmptyPanel
            icon={Layers}
            title="No zone matches"
            description={`None of the ${plural(totalZones, 'zone')} matches these filters.`}
            className="py-14"
            action={
              <Link
                href={ZONES_PATH}
                className="text-sm font-medium text-link underline-offset-4 hover:underline"
              ><AutoText>Clear filters</AutoText></Link>
            }
          />
        ) : zones.length === 0 ? (
          <EmptyPanel
            icon={Layers}
            title="No shopping zones yet"
            description={
              canManage
                ? 'Create the first one above. Until a zone exists the storefront simply shows no collection rail, and every product stays browsable by category.'
                : 'Zones appear here once someone with zone permission creates them.'
            }
            className="py-14"
          />
        ) : (
          <ul role="list" className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {zones.map((zone) => (
              <li key={zone.id} className="nz-panel rounded-2xl border p-3">
                <ZoneSummary zone={zone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
