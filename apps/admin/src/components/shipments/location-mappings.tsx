import {
  BD_DISTRICTS,
  COURIER_PROVIDER_IDS,
  type CourierLocationMapping,
  type CourierProviderId,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { MapPinned } from 'lucide-react';
import type { Route } from 'next';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { FilterBar, SearchFilter, SelectFilter } from '@/components/admin-kit/filter-bar';
import { oneOf, single, withQuery } from '@/components/admin-kit/href';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { searchParam, type SearchParams } from '@/components/orders/order-query';
import { ActionDisclosure } from './shipment-actions';
import { DeleteMappingForm, MappingForm } from './mapping-forms';
import {
  destinationEntries,
  OPERATIONS_PATHS,
  PROVIDER_OPTIONS,
  providerName,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

/** Every Bangladesh district, alphabetically. */
export const ALL_DISTRICTS: readonly string[] = Object.values(BD_DISTRICTS)
  .flat()
  .sort((a, b) => a.localeCompare(b));

export interface MappingFilters {
  provider?: CourierProviderId;
  district?: string;
  q?: string;
}

export function parseMappingFilters(params: SearchParams): MappingFilters {
  const district = single(params.district);
  return {
    provider: oneOf(params.courier, COURIER_PROVIDER_IDS),
    district: district && ALL_DISTRICTS.includes(district) ? district : undefined,
    q: searchParam(params.q),
  };
}

export function mappingsHref(filters: MappingFilters): Route {
  return withQuery(OPERATIONS_PATHS.locations, {
    courier: filters.provider,
    district: filters.district,
    q: filters.q,
  });
}

/** The mappings matching the filters, by courier, district and area. */
export function filterMappings(
  mappings: readonly CourierLocationMapping[],
  filters: MappingFilters,
): CourierLocationMapping[] {
  const q = filters.q?.toLowerCase();
  return mappings
    .filter((m) => !filters.provider || m.provider === filters.provider)
    .filter((m) => !filters.district || m.district === filters.district)
    .filter(
      (m) =>
        !q ||
        [m.district, m.area, m.label ?? '', ...Object.values(m.destination).map(String)]
          .join(' ')
          .toLowerCase()
          .includes(q),
    )
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.district.localeCompare(b.district) ||
        a.area.localeCompare(b.area),
    );
}

/**
 * The courier locations remembered for districts and areas, so a booking can name the
 * courier's own city/zone/area ids. Viewing needs shipments.read; adding, editing and
 * removing need shipments.create or shipments.returns.manage.
 */
export function LocationMappingsView({
  mappings,
  filters,
  canEdit,
  csrf,
}: {
  mappings: readonly CourierLocationMapping[];
  filters: MappingFilters;
  canEdit: boolean;
  csrf: CsrfInput;
}) {
  const rows = filterMappings(mappings, filters);
  const filtered = Boolean(filters.provider ?? filters.district ?? filters.q);
  const columns = canEdit ? 7 : 6;
  return (
    <div className="grid gap-6">
      {canEdit ? (
        <ActionDisclosure
          title="Add a location mapping"
          description="One courier, one district (and optionally one area)"
        >
          <MappingForm csrf={csrf} districts={ALL_DISTRICTS} />
        </ActionDisclosure>
      ) : null}
      <GlassTable
        label="Location mappings"
        header={
          <FilterBar
            action={OPERATIONS_PATHS.locations}
            resetHref={filtered ? OPERATIONS_PATHS.locations : undefined}
            label="Location mapping filters"
          >
            <SearchFilter label="Search" defaultValue={filters.q} placeholder="Area, label or id" />
            <SelectFilter
              name="courier"
              label="Courier"
              options={PROVIDER_OPTIONS}
              defaultValue={filters.provider}
              allLabel="Every courier"
            />
            <SelectFilter
              name="district"
              label="District"
              options={ALL_DISTRICTS.map((d) => ({ value: d, label: d }))}
              defaultValue={filters.district}
              allLabel="Every district"
            />
          </FilterBar>
        }
        footer={
          <p className="text-sm text-muted-foreground tabular-nums">
            {rows.length === mappings.length
              ? `${String(mappings.length)} mapping${mappings.length === 1 ? '' : 's'}`
              : `${String(rows.length)} of ${String(mappings.length)} mappings`}
          </p>
        }
      >
        <DataTable caption="Courier location mappings" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead><AutoText>Courier</AutoText></TableHead>
              <TableHead><AutoText>District</AutoText></TableHead>
              <TableHead><AutoText>Area</AutoText></TableHead>
              <TableHead><AutoText>Courier location</AutoText></TableHead>
              <TableHead><AutoText>Label</AutoText></TableHead>
              <TableHead><AutoText>Updated</AutoText></TableHead>
              {canEdit ? (
                <TableHead>
                  <span className="sr-only"><AutoText>Actions</AutoText></span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          {rows.length > 0 ? (
            <TableBody>
              {rows.map((mapping) => (
                <TableRow key={mapping.id}>
                  <TableCell><AutoText value={providerName(mapping.provider)} /></TableCell>
                  <TableCell><AutoText value={mapping.district} /></TableCell>
                  <TableCell>
                    {mapping.area || <span className="text-muted-foreground"><AutoText>Whole district</AutoText></span>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-mono text-xs">
                      {destinationEntries(mapping.destination)
                        .map(([label, value]) => `${label}: ${value}`)
                        .join(' · ')}
                    </span>
                  </TableCell>
                  <TableCell>{mapping.label ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <DateTimeText value={mapping.updatedAt} style="datetime" />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex flex-wrap items-start gap-2">
                        <ActionDisclosure title="Edit">
                          <MappingForm csrf={csrf} districts={ALL_DISTRICTS} mapping={mapping} />
                        </ActionDisclosure>
                        <DeleteMappingForm mapping={mapping} csrf={csrf} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={columns}
              icon={MapPinned}
              title={filtered ? 'No mappings match these filters' : 'No location mappings yet'}
              description={
                filtered
                  ? 'Try another courier, district or search.'
                  : 'Add the courier’s own location ids for the districts you ship to most.'
              }
            />
          )}
        </DataTable>
      </GlassTable>
    </div>
  );
}
