import {
  SHIPMENT_KINDS,
  SHIPMENT_STATUSES,
  type Permission,
  type Shipment,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { CircleAlert, Truck } from 'lucide-react';
import Link from 'next/link';
import {
  DataTable,
  DataTableEmpty,
  parseSort,
  SortableHead,
  sortParam,
  type SortState,
} from '@/components/admin-kit/data-table';
import {
  DateFilter,
  FilterBar,
  FilterChips,
  SearchFilter,
  SelectFilter,
  type FilterChip,
} from '@/components/admin-kit/filter-bar';
import { Pagination } from '@/components/admin-kit/pagination';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatDateTime, formatDayLong, formatMoney } from '@/lib/format';
import { ShipmentStatusChip, TestChip } from './shipment-chips';
import {
  hasShipmentFilters,
  OPERATIONS_PATHS,
  orderHref,
  PROVIDER_OPTIONS,
  providerName,
  SHIPMENT_KIND_LABELS,
  shipmentFlags,
  shipmentHref,
  shipmentsHref,
  SHIPMENT_SORT_COLUMNS,
  shipmentStatusLabel,
  sortShipments,
  type ShipmentFilters,
  type ShipmentSortColumn,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

const DEFAULT_SORT: SortState<ShipmentSortColumn> = { column: 'updated', direction: 'desc' };

const STATUS_OPTIONS = SHIPMENT_STATUSES.map((status) => ({
  value: status,
  label: shipmentStatusLabel(status),
}));
const KIND_OPTIONS = SHIPMENT_KINDS.map((kind) => ({
  value: kind,
  label: SHIPMENT_KIND_LABELS[kind],
}));

function chips(filters: ShipmentFilters): FilterChip[] {
  const without = (patch: Partial<ShipmentFilters>) => shipmentsHref({ ...filters, ...patch });
  const list: FilterChip[] = [];
  if (filters.status)
    list.push({
      key: 'status',
      label: `Status: ${shipmentStatusLabel(filters.status)}`,
      removeHref: without({ status: undefined }),
    });
  if (filters.provider)
    list.push({
      key: 'courier',
      label: `Courier: ${providerName(filters.provider)}`,
      removeHref: without({ provider: undefined }),
    });
  if (filters.kind)
    list.push({
      key: 'kind',
      label: `Kind: ${SHIPMENT_KIND_LABELS[filters.kind]}`,
      removeHref: without({ kind: undefined }),
    });
  if (filters.q)
    list.push({ key: 'q', label: `Search: “${filters.q}”`, removeHref: without({ q: undefined }) });
  if (filters.from)
    list.push({
      key: 'from',
      label: `From ${formatDayLong(filters.from)}`,
      removeHref: without({ from: undefined }),
    });
  if (filters.to)
    list.push({
      key: 'to',
      label: `To ${formatDayLong(filters.to)}`,
      removeHref: without({ to: undefined }),
    });
  return list;
}

export interface ShipmentListViewProps {
  filters: ShipmentFilters;
  shipments: readonly Shipment[];
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  permissions: readonly Permission[];
  now: Date;
}

/** Every courier shipment, filterable, newest first; each row opens the shipment. */
export function ShipmentListView({
  filters,
  shipments,
  page,
  totalPages,
  total,
  pageSize,
  permissions,
  now,
}: ShipmentListViewProps) {
  const filtered = hasShipmentFilters(filters);
  const sort = parseSort(filters.sort, SHIPMENT_SORT_COLUMNS, DEFAULT_SORT);
  const sortHref = (next: SortState<ShipmentSortColumn>) =>
    shipmentsHref({ ...filters, sort: sortParam(next) }, page);
  const rows = sortShipments(shipments, sort);
  const canOpenOrder = permissions.includes('orders.read');
  return (
    <GlassTable
      label="Shipments"
      header={
        <>
          <FilterBar
            action={OPERATIONS_PATHS.shipments}
            hidden={{ test: filters.test ? '1' : undefined, sort: filters.sort }}
            resetHref={filtered ? shipmentsHref({ test: filters.test }) : undefined}
            label="Shipment filters"
          >
            <SearchFilter
              label="Search"
              defaultValue={filters.q}
              placeholder="Order number, consignment or tracking code"
            />
            <SelectFilter
              name="status"
              label="Status"
              options={STATUS_OPTIONS}
              defaultValue={filters.status}
              allLabel="Every status"
            />
            <SelectFilter
              name="courier"
              label="Courier"
              options={PROVIDER_OPTIONS}
              defaultValue={filters.provider}
              allLabel="Every courier"
            />
            <SelectFilter
              name="kind"
              label="Kind"
              options={KIND_OPTIONS}
              defaultValue={filters.kind}
              allLabel="Every kind"
            />
            <DateFilter name="from" label="Created from" defaultValue={filters.from} />
            <DateFilter name="to" label="Created to" defaultValue={filters.to} />
          </FilterBar>
          <FilterChips chips={chips(filters)} clearHref={shipmentsHref({ test: filters.test })} />
        </>
      }
      footer={
        total > 0 ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            noun="shipments"
            hrefFor={(next) => shipmentsHref(filters, next)}
          />
        ) : undefined
      }
    >
      <DataTable caption="Shipments" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Shipment</AutoText></TableHead>
            <TableHead><AutoText>Order</AutoText></TableHead>
            <SortableHead column="courier" sort={sort} hrefFor={sortHref}><AutoText>Courier</AutoText></SortableHead>
            <SortableHead column="status" sort={sort} hrefFor={sortHref}><AutoText>Status</AutoText></SortableHead>
            <TableHead><AutoText>Consignment</AutoText></TableHead>
            <SortableHead
              column="cod"
              sort={sort}
              hrefFor={sortHref}
              align="right"
              firstDirection="desc"
            ><AutoText>COD</AutoText></SortableHead>
            <SortableHead column="updated" sort={sort} hrefFor={sortHref} firstDirection="desc"><AutoText>Last update</AutoText></SortableHead>
          </TableRow>
        </TableHeader>
        {shipments.length > 0 ? (
          <TableBody>
            {rows.map((shipment) => {
              const flags = shipmentFlags(shipment);
              const updated = shipment.lastEventAt ?? shipment.updatedAt;
              return (
                <TableRow key={shipment.id}>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="flex items-center gap-2">
                        <Link
                          href={shipmentHref(shipment.id)}
                          className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                        >
                          {shipment.merchantRef}
                        </Link>
                        {shipment.isMock ? <TestChip /> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {SHIPMENT_KIND_LABELS[shipment.kind]}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canOpenOrder ? (
                      <Link
                        href={orderHref(shipment.orderNumber)}
                        className="font-mono text-xs text-link underline-offset-4 hover:underline"
                      >
                        {shipment.orderNumber}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs"><AutoText value={shipment.orderNumber} /></span>
                    )}
                  </TableCell>
                  <TableCell>{shipment.providerName || providerName(shipment.provider)}</TableCell>
                  <TableCell>
                    <div className="grid justify-items-start gap-1">
                      <ShipmentStatusChip status={shipment.status} />
                      {flags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center gap-1 text-xs font-medium text-danger-ink"
                        >
                          <CircleAlert aria-hidden="true" className="size-3.5" />
                          {flag}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {shipment.consignmentId ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(shipment.codAmountMinor)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <time dateTime={updated} title={formatDateTime(updated)}>
                      <RelativeTimeText value={updated} now={now} />
                    </time>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={7}
            icon={Truck}
            title={filtered ? 'No shipments match these filters' : 'No shipments yet'}
            description={
              filtered
                ? 'Try another status, courier or search.'
                : filters.test
                  ? 'Shipments appear here once a courier is booked from an order.'
                  : 'Shipments appear here once a courier is booked from an order. Test shipments are hidden; include test data to see them.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}
