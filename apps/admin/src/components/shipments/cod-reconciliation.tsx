import {
  COD_POSITION_STATUSES,
  type CodPositionListResponse,
  type CodPositionRow,
  type CourierSettlement,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { HandCoins, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { FilterBar, SelectFilter } from '@/components/admin-kit/filter-bar';
import { Pagination } from '@/components/admin-kit/pagination';
import { SectionCard } from '@/components/admin-kit/section-card';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatDate, formatMoney } from '@/lib/format';
import { CodPositionChip, ShipmentStatusChip, TestChip } from './shipment-chips';
import {
  COD_POSITION_LABELS,
  codHref,
  OPERATIONS_PATHS,
  PROVIDER_OPTIONS,
  providerName,
  shipmentHref,
  type CodFilters,
} from './shipment-labels';
import type { SettlementCandidate } from './settlement-form';
import { AutoText } from '@/components/i18n/translate';
import { CalendarDayText } from '@/components/i18n/format-text';

const STATUS_OPTIONS = COD_POSITION_STATUSES.map((status) => ({
  value: status,
  label: COD_POSITION_LABELS[status].label,
}));

function Amount({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span className={strong ? 'font-semibold text-foreground tabular-nums' : 'tabular-nums'}>
      {formatMoney(value)}
    </span>
  );
}

/** Rows a payout may still settle: delivered or collected, not closed, something outstanding. */
export function settlementCandidates(rows: readonly CodPositionRow[]): SettlementCandidate[] {
  return rows.flatMap((row) => {
    const { position } = row;
    if (position.codState === 'reconciled') return [];
    const open =
      position.status === 'collected' ||
      position.status === 'partially_settled' ||
      (position.status === 'pending' && row.deliveredAt !== null);
    if (!open) return [];
    const base =
      position.collectedMinor > 0 ? position.expectedSettlementMinor : position.expectedMinor;
    return [
      {
        shipmentId: row.shipmentId,
        orderNumber: row.orderNumber,
        provider: row.provider,
        consignmentId: row.consignmentId,
        isMock: row.isMock,
        outstandingMinor: Math.max(0, base - position.settledMinor),
      },
    ];
  });
}

export interface CodPositionsViewProps {
  filters: CodFilters;
  list: CodPositionListResponse;
}

/** Each COD shipment's money: expected, collected, deductions, expected settlement, settled. */
export function CodPositionsView({ filters, list }: CodPositionsViewProps) {
  const filtered = Boolean(filters.provider ?? filters.status);
  return (
    <GlassTable
      label="COD positions"
      header={
        <FilterBar
          action={OPERATIONS_PATHS.cod}
          hidden={{ test: filters.test ? '1' : undefined }}
          resetHref={filtered ? codHref({ test: filters.test }) : undefined}
          label="COD filters"
        >
          <SelectFilter
            name="courier"
            label="Courier"
            options={PROVIDER_OPTIONS}
            defaultValue={filters.provider}
            allLabel="Every courier"
          />
          <SelectFilter
            name="status"
            label="COD status"
            options={STATUS_OPTIONS}
            defaultValue={filters.status}
            allLabel="Every status"
          />
        </FilterBar>
      }
      footer={
        list.total > 0 ? (
          <Pagination
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            pageSize={list.pageSize}
            noun="shipments"
            hrefFor={(next) => codHref(filters, next)}
          />
        ) : undefined
      }
    >
      <DataTable caption="COD positions per shipment" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Order</AutoText></TableHead>
            <TableHead><AutoText>Courier</AutoText></TableHead>
            <TableHead><AutoText>Shipment</AutoText></TableHead>
            <TableHead><AutoText>COD status</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Expected</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Collected</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Deductions</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Expected settlement</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Settled</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Difference</AutoText></TableHead>
          </TableRow>
        </TableHeader>
        {list.positions.length > 0 ? (
          <TableBody>
            {list.positions.map((row) => (
              <TableRow key={row.shipmentId}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Link
                      href={shipmentHref(row.shipmentId)}
                      className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                    {row.isMock ? <TestChip /> : null}
                  </span>
                  {row.consignmentId ? (
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {row.consignmentId}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell><AutoText value={providerName(row.provider)} /></TableCell>
                <TableCell>
                  <ShipmentStatusChip status={row.status} />
                </TableCell>
                <TableCell>
                  <CodPositionChip status={row.position.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.position.expectedMinor} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.position.collectedMinor} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.position.deductionsMinor} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.position.expectedSettlementMinor} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.position.settledMinor} />
                </TableCell>
                <TableCell
                  className={
                    row.position.differenceMinor === 0
                      ? 'text-right text-muted-foreground'
                      : 'text-right font-semibold text-danger-ink'
                  }
                >
                  <Amount value={row.position.differenceMinor} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-border bg-surface-muted/50 hover:bg-surface-muted/50">
              <TableCell colSpan={4} className="font-semibold text-foreground">
                Total{filtered ? ' (filtered)' : ''}
                {filters.test ? ' — includes test data' : ''}
              </TableCell>
              <TableCell className="text-right">
                <Amount value={list.totals.expectedMinor} strong />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={list.totals.collectedMinor} strong />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={list.totals.deductionsMinor} strong />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={list.totals.expectedSettlementMinor} strong />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={list.totals.settledMinor} strong />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={10}
            icon={HandCoins}
            title={filtered ? 'No COD shipments match these filters' : 'No courier COD yet'}
            description="Shipments with cash to collect appear here once they are booked."
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

/** The courier payouts recorded so far, newest first. */
export function SettlementList({ settlements }: { settlements: readonly CourierSettlement[] }) {
  return (
    <SectionCard title="Settlements received" icon={ReceiptText} flush>
      <DataTable caption="Courier settlements" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Received</AutoText></TableHead>
            <TableHead><AutoText>Courier</AutoText></TableHead>
            <TableHead><AutoText>Reference</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Shipments</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Amount</AutoText></TableHead>
            <TableHead><AutoText>Note</AutoText></TableHead>
          </TableRow>
        </TableHeader>
        {settlements.length > 0 ? (
          <TableBody>
            {settlements.map((settlement) => (
              <TableRow key={settlement.id}>
                <TableCell title={`Recorded ${formatDate(settlement.createdAt)}`}>
                  <CalendarDayText day={settlement.receivedOn} long />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {providerName(settlement.provider)}
                    {settlement.isMock ? <TestChip /> : null}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs"><AutoText value={settlement.reference} /></TableCell>
                <TableCell className="text-right tabular-nums"><AutoText value={settlement.lines} /></TableCell>
                <TableCell className="text-right">
                  <Amount value={settlement.amountMinor} strong />
                </TableCell>
                <TableCell className="max-w-64 truncate">{settlement.note ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={ReceiptText}
            title="No settlements recorded"
            description="Record a courier payout when the money arrives."
          />
        )}
      </DataTable>
    </SectionCard>
  );
}
