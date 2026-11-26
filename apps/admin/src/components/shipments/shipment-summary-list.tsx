import type { Shipment } from '@nilzora/contracts';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ShipmentStatusChip, TestChip } from './shipment-chips';
import { providerName, SHIPMENT_KIND_LABELS, shipmentFlags, shipmentHref } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';

/**
 * A compact list of an order's (or a return's) shipments: courier, kind, status and where
 * to open each one. Statuses are the shipments' own, never the order's.
 */
export function ShipmentSummaryList({
  shipments,
  canOpen,
  label,
}: {
  shipments: readonly Shipment[];
  /** shipments.read: each row links to its shipment page. */
  canOpen: boolean;
  label: string;
}) {
  if (shipments.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="grid divide-y divide-hairline rounded-xl border border-hairline"
    >
      {shipments.map((shipment) => {
        const flags = shipmentFlags(shipment);
        return (
          <li
            key={shipment.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {canOpen ? (
                  <Link
                    href={shipmentHref(shipment.id)}
                    className="font-mono text-link underline-offset-4 hover:underline"
                  >
                    {shipment.merchantRef}
                  </Link>
                ) : (
                  <span className="font-mono"><AutoText value={shipment.merchantRef} /></span>
                )}
                {shipment.isMock ? <TestChip /> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {SHIPMENT_KIND_LABELS[shipment.kind]} ·{' '}
                {shipment.providerName || providerName(shipment.provider)}
                {shipment.consignmentId ? ` · ${shipment.consignmentId}` : ''}
                {shipment.codAmountMinor > 0
                  ? ` · COD ${formatMoney(shipment.codAmountMinor)}`
                  : ''}
                {` · ${formatDateTime(shipment.createdAt)}`}
              </span>
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
            <ShipmentStatusChip status={shipment.status} />
          </li>
        );
      })}
    </ul>
  );
}
