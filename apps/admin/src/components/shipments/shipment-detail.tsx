import type {
  CourierProvider,
  Permission,
  ShipmentDetailResponse,
  ShipmentEvent,
} from '@nilzora/contracts';
import { Alert, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { HandCoins, History, ListChecks, MapPin, Package, ScrollText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { DetailList } from '@/components/admin-kit/detail-list';
import { SectionCard } from '@/components/admin-kit/section-card';
import { Timeline, type TimelineItem, type TimelineTone } from '@/components/admin-kit/timeline';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  ActionDisclosure,
  CancelShipmentForm,
  CodAdjustmentForm,
  CodCollectedForm,
  CodStateForm,
  RecordStatusForm,
  RefreshTrackingForm,
  ResolveBookingForm,
} from './shipment-actions';
import { CodPositionChip, TestChip } from './shipment-chips';
import {
  bookPermissionFor,
  COD_LEDGER_LABELS,
  COD_STATE_LABELS,
  destinationEntries,
  formatWeight,
  isTerminalShipment,
  orderHref,
  providerName,
  SHIPMENT_KIND_LABELS,
  SHIPMENT_STATUS_TONE,
  shipmentHref,
  shipmentStatusLabel,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

const SOURCE_LABEL: Record<ShipmentEvent['source'], string> = {
  booking: 'Booking',
  webhook: 'Courier update',
  poll: 'Tracking check',
  manual: 'Recorded by staff',
  system: 'Nilzora',
};

const TONE_TO_TIMELINE: Record<string, TimelineTone> = {
  neutral: 'neutral',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  violet: 'violet',
  offer: 'danger',
  moderator: 'moderator',
};

/**
 * The shipment's events as a timeline, oldest first. An event the courier sent that did
 * not move the shipment (older, or out of order) is kept and shown faded as "Not applied".
 */
export function shipmentTimelineItems(events: readonly ShipmentEvent[]): TimelineItem[] {
  return [...events]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id)
    .map((event) => ({
      key: String(event.id),
      title: shipmentStatusLabel(event.status),
      at: event.occurredAt,
      actor: [
        SOURCE_LABEL[event.source],
        event.providerStatus ? `courier status “${event.providerStatus}”` : null,
        event.recordedAt !== event.occurredAt
          ? `recorded ${formatDateTime(event.recordedAt)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      note: event.note,
      tone: TONE_TO_TIMELINE[SHIPMENT_STATUS_TONE[event.status]] ?? 'neutral',
      dimmed: !event.applied,
      dimmedLabel: 'Not applied — older or out of order',
    }));
}

function Money({ value }: { value: number }) {
  return <span className="tabular-nums"><AutoText value={formatMoney(value)} /></span>;
}

export interface ShipmentDetailViewProps {
  detail: ShipmentDetailResponse;
  /** The courier's configuration, when it could be read (decides how a cancel works). */
  provider: CourierProvider | null;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

/** One shipment: what it is, where it goes, what happened, the staff steps and its cash. */
export function ShipmentDetailView({
  detail,
  provider,
  permissions,
  csrf,
}: ShipmentDetailViewProps) {
  const { shipment, events, ledger, codPosition } = detail;
  const courier = shipment.providerName || providerName(shipment.provider);
  const can = (permission: Permission) => permissions.includes(permission);
  const open = !isTerminalShipment(shipment.status);
  const canResolve = shipment.bookingUncertain && can(bookPermissionFor(shipment.kind));
  const cancelApi = provider?.capabilities.cancel === 'available';
  const destination = destinationEntries(shipment.destination);
  const canReconcile = can('couriers.cod.reconcile');

  return (
    <div className="grid gap-6">
      {shipment.isMock ? (
        <Alert tone="warning" title="Test shipment">
          This came from the mock courier: no real parcel exists and it is left out of every total
          unless test data is included.
        </Alert>
      ) : null}
      {shipment.bookingUncertain ? (
        <Alert tone="danger" title="Booking not confirmed">
          {courier} did not answer this booking clearly, so Nilzora does not know whether a parcel
          exists. Look for <span className="font-mono"><AutoText value={shipment.merchantRef} /></span> in the{' '}
          {courier} portal, then resolve it below. It is never retried automatically.
        </Alert>
      ) : null}
      {shipment.bookingError && shipment.status === 'booking_failed' ? (
        <Alert tone="danger" title="The courier refused the booking">
          {shipment.bookingError}
        </Alert>
      ) : null}
      {shipment.syncError ? (
        <Alert tone="warning" title="Tracking could not be updated">
          {shipment.syncError}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <SectionCard title="Shipment" icon={Package}>
            <DetailList
              items={[
                { label: 'Courier', value: courier },
                { label: 'Kind', value: SHIPMENT_KIND_LABELS[shipment.kind] },
                {
                  label: 'Order',
                  value: can('orders.read') ? (
                    <Link
                      href={orderHref(shipment.orderNumber)}
                      className="font-mono text-link underline-offset-4 hover:underline"
                    >
                      {shipment.orderNumber}
                    </Link>
                  ) : (
                    <span className="font-mono"><AutoText value={shipment.orderNumber} /></span>
                  ),
                },
                {
                  label: 'Return request',
                  value:
                    shipment.returnRequestId && can('orders.read') ? (
                      <Link
                        href={`/admin/returns/${shipment.returnRequestId}` as Route}
                        className="text-link underline-offset-4 hover:underline"
                      ><AutoText>Open the return</AutoText></Link>
                    ) : null,
                },
                {
                  label: 'Original shipment',
                  value: shipment.parentShipmentId ? (
                    <Link
                      href={shipmentHref(shipment.parentShipmentId)}
                      className="text-link underline-offset-4 hover:underline"
                    ><AutoText>Open the original shipment</AutoText></Link>
                  ) : null,
                },
                {
                  label: 'Nilzora reference',
                  value: <span className="font-mono"><AutoText value={shipment.merchantRef} /></span>,
                },
                {
                  label: 'Consignment id',
                  value: shipment.consignmentId ? (
                    <span className="font-mono"><AutoText value={shipment.consignmentId} /></span>
                  ) : null,
                },
                {
                  label: 'Tracking code',
                  value: shipment.trackingCode ? (
                    shipment.trackingUrl && /^https:\/\//.test(shipment.trackingUrl) ? (
                      <a
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-link underline-offset-4 hover:underline"
                      >
                        {shipment.trackingCode}
                        <span className="sr-only"> (opens the courier’s tracking page)</span>
                      </a>
                    ) : (
                      <span className="font-mono"><AutoText value={shipment.trackingCode} /></span>
                    )
                  ) : null,
                },
                { label: 'Courier status', value: shipment.providerStatus },
                { label: 'Parcel weight', value: formatWeight(shipment.weightGrams) },
                {
                  label: 'Cash to collect (COD)',
                  value: <Money value={shipment.codAmountMinor} />,
                },
                ...(shipment.expectedChargeMinor !== null
                  ? [
                      {
                        label: 'Expected delivery charge',
                        value: <Money value={shipment.expectedChargeMinor} />,
                        hint: 'What the courier charges Nilzora; the customer’s shipping charge is on the order.',
                      },
                      {
                        label: 'Expected COD fee',
                        value:
                          shipment.expectedCodFeeMinor === null ? null : (
                            <Money value={shipment.expectedCodFeeMinor} />
                          ),
                      },
                    ]
                  : []),
                { label: 'Created', value: formatDateTime(shipment.createdAt) },
                {
                  label: 'Booked',
                  value: shipment.bookedAt ? formatDateTime(shipment.bookedAt) : null,
                },
                {
                  label: 'Picked up',
                  value: shipment.pickedUpAt ? formatDateTime(shipment.pickedUpAt) : null,
                },
                {
                  label: 'Delivered',
                  value: shipment.deliveredAt ? formatDateTime(shipment.deliveredAt) : null,
                },
                ...(shipment.cancelledAt
                  ? [
                      { label: 'Cancelled', value: formatDateTime(shipment.cancelledAt) },
                      { label: 'Cancel reason', value: shipment.cancelReason, wide: true },
                    ]
                  : []),
                ...(shipment.recommendedProvider
                  ? [
                      {
                        label: 'Recommended courier',
                        value: providerName(shipment.recommendedProvider),
                      },
                    ]
                  : []),
                ...(shipment.selectionReason
                  ? [{ label: 'Why this courier', value: shipment.selectionReason, wide: true }]
                  : []),
                ...(shipment.note ? [{ label: 'Note', value: shipment.note, wide: true }] : []),
              ]}
            />
          </SectionCard>

          <SectionCard title="Destination" icon={MapPin}>
            <DetailList
              items={[
                {
                  label: 'Zone',
                  value:
                    shipment.deliveryZone === 'inside_dhaka' ? 'Inside Dhaka' : 'Outside Dhaka',
                },
                ...destination.map(([label, value]) => ({ key: label, label, value })),
              ]}
            />
          </SectionCard>

          <SectionCard
            title="Timeline"
            icon={History}
            description="Courier events move this shipment only; the order’s status is changed on the order."
          >
            {events.length > 0 ? (
              <Timeline label="Shipment timeline" items={shipmentTimelineItems(events)} />
            ) : (
              <p className="text-sm text-muted-foreground"><AutoText>No courier events yet.</AutoText></p>
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 gap-6">
          <SectionCard title="Steps" icon={ListChecks}>
            <ShipmentSteps
              shipmentId={shipment.id}
              csrf={csrf}
              courier={courier}
              open={open}
              canTrack={can('shipments.track')}
              canCancel={can('shipments.cancel') && open && shipment.status !== 'booking_pending'}
              canResolve={canResolve}
              cancelApi={cancelApi}
              auditHref={
                can('audit_logs.read')
                  ? (`/admin/audit?area=shipment.&q=${encodeURIComponent(shipment.id)}` as Route)
                  : undefined
              }
            />
          </SectionCard>

          {ledger !== null && codPosition !== null ? (
            <SectionCard
              title="Cash on delivery"
              icon={HandCoins}
              actions={<CodPositionChip status={codPosition.status} />}
              description={`COD record: ${COD_STATE_LABELS[codPosition.codState]}`}
            >
              <div className="grid gap-4">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {(
                    [
                      ['Expected from customer', codPosition.expectedMinor],
                      ['Collected by courier', codPosition.collectedMinor],
                      ['Courier deductions', codPosition.deductionsMinor],
                      ['Adjustments', codPosition.adjustmentsMinor],
                      ['Expected settlement', codPosition.expectedSettlementMinor],
                      ['Settled', codPosition.settledMinor],
                      ['Difference', codPosition.differenceMinor],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground"><AutoText value={label} /></dt>
                      <dd
                        className={
                          label === 'Difference' && value !== 0
                            ? 'text-right font-semibold text-danger-ink tabular-nums'
                            : 'text-right text-foreground tabular-nums'
                        }
                      >
                        {formatMoney(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {canReconcile ? (
                  <div className="grid gap-2">
                    <ActionDisclosure
                      title="Record courier collection"
                      description="From the courier’s report or invoice"
                    >
                      <CodCollectedForm shipmentId={shipment.id} csrf={csrf} />
                    </ActionDisclosure>
                    <ActionDisclosure
                      title="Record an adjustment"
                      description="A signed correction with a reason"
                    >
                      <CodAdjustmentForm shipmentId={shipment.id} csrf={csrf} />
                    </ActionDisclosure>
                    <div className="grid gap-2 border-t border-hairline pt-3">
                      <p className="text-xs font-medium text-muted-foreground"><AutoText>Reconciliation</AutoText></p>
                      <CodStateForm
                        shipmentId={shipment.id}
                        csrf={csrf}
                        codState={codPosition.codState}
                        differenceMinor={codPosition.differenceMinor}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>

      {ledger !== null ? (
        <SectionCard title="COD ledger" icon={ScrollText} flush>
          <DataTable caption="COD ledger" dense>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead><AutoText>Entry</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Amount</AutoText></TableHead>
                <TableHead><AutoText>Reference</AutoText></TableHead>
                <TableHead><AutoText>Note</AutoText></TableHead>
                <TableHead><AutoText>Recorded</AutoText></TableHead>
              </TableRow>
            </TableHeader>
            {ledger.length > 0 ? (
              <TableBody>
                {ledger.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {COD_LEDGER_LABELS[entry.entryType] ?? entry.entryType}
                        {entry.isMock ? <TestChip /> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(entry.amountMinor)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.evidenceRef ?? '—'}</TableCell>
                    <TableCell className="max-w-64 truncate whitespace-normal">
                      {entry.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <DateTimeText value={entry.createdAt} style="datetime" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ) : (
              <DataTableEmpty
                colSpan={5}
                title="No COD entries yet"
                description="Entries appear once the parcel is booked with cash to collect."
              />
            )}
          </DataTable>
        </SectionCard>
      ) : null}
    </div>
  );
}

/** The staff steps, by permission and by where the shipment is. */
export function ShipmentSteps({
  shipmentId,
  csrf,
  courier,
  open,
  canTrack,
  canCancel,
  canResolve,
  cancelApi,
  auditHref,
}: {
  shipmentId: string;
  csrf: CsrfInput;
  courier: string;
  open: boolean;
  canTrack: boolean;
  canCancel: boolean;
  canResolve: boolean;
  cancelApi: boolean;
  auditHref?: Route | undefined;
}) {
  const nothing = !canResolve && !(open && canTrack) && !canCancel;
  return (
    <div className="grid gap-3">
      {canResolve ? (
        <ActionDisclosure
          title="Resolve uncertain booking"
          description="After checking the courier portal"
          open
        >
          <ResolveBookingForm shipmentId={shipmentId} csrf={csrf} />
        </ActionDisclosure>
      ) : null}
      {open && canTrack ? (
        <>
          <RefreshTrackingForm shipmentId={shipmentId} csrf={csrf} />
          <ActionDisclosure
            title="Record a status by hand"
            description="What the courier portal or rider reported"
          >
            <RecordStatusForm shipmentId={shipmentId} csrf={csrf} />
          </ActionDisclosure>
        </>
      ) : null}
      {canCancel ? (
        <CancelShipmentForm
          shipmentId={shipmentId}
          csrf={csrf}
          courier={courier}
          needsPortal={!cancelApi}
        />
      ) : null}
      {nothing ? (
        <p className="text-sm text-muted-foreground">
          {open
            ? 'Your account cannot change this shipment.'
            : 'This shipment is finished: there are no further courier steps.'}
        </p>
      ) : null}
      {auditHref ? (
        <Link
          href={auditHref}
          className="w-fit text-xs font-medium text-link underline-offset-4 hover:underline"
        ><AutoText>See this shipment in the audit log</AutoText></Link>
      ) : null}
    </div>
  );
}
