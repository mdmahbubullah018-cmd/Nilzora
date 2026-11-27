import type {
  CodPositionStatus,
  CourierCapabilityState,
  CourierMode,
  CourierQuoteKind,
  ShipmentStatus,
} from '@nilzora/contracts';
import { Alert } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { Chip } from '@/components/admin-kit/chip';
import {
  CAPABILITY_STATE,
  COD_POSITION_LABELS,
  COURIER_MODE_COPY,
  QUOTE_KIND_TONE,
  quoteKindLabel,
  SHIPMENT_STATUS_TONE,
  shipmentStatusLabel,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';

/** A shipment's own status (never the order's). */
export function ShipmentStatusChip({ status }: { status: ShipmentStatus }) {
  return (
    <Chip tone={SHIPMENT_STATUS_TONE[status]} dot>
      {shipmentStatusLabel(status)}
    </Chip>
  );
}

/** Marks test data from the local mock courier, everywhere it appears. */
export function TestChip() {
  return (
    <Chip
      tone="offer"
      title="Test shipment from the mock courier: no real parcel, left out of totals"
    >
      <AutoText>Test</AutoText>
    </Chip>
  );
}

/** Where a price comes from: Live quote, Courier estimate, Internal Estimate or No price. */
export function QuoteKindChip({ kind }: { kind: CourierQuoteKind }) {
  return (
    <Chip tone={QUOTE_KIND_TONE[kind]}>
      <AutoText value={quoteKindLabel(kind)} />
    </Chip>
  );
}

export function CodPositionChip({ status }: { status: CodPositionStatus }) {
  const style = COD_POSITION_LABELS[status];
  return (
    <Chip tone={style.tone} dot>
      {style.label}
    </Chip>
  );
}

export function CapabilityChip({ state }: { state: CourierCapabilityState }) {
  const style = CAPABILITY_STATE[state];
  return (
    <Chip tone={style.tone}>
      <AutoText value={style.label} />
    </Chip>
  );
}

/** How the server talks to couriers, said plainly: off, test mode or live. */
export function CourierModeBanner({
  mode,
  bookingEnabled,
  compact = false,
  settingsHref,
}: {
  mode: CourierMode;
  /** Live mode only: whether real bookings are switched on (Courier settings). */
  bookingEnabled?: boolean | undefined;
  compact?: boolean;
  /** Links to Courier settings, where the mode is changed. */
  settingsHref?: Route | undefined;
}) {
  const copy = COURIER_MODE_COPY[mode];
  const liveButBlocked = mode === 'live' && bookingEnabled === false;
  return (
    <Alert
      tone={mode === 'live' && !liveButBlocked ? 'success' : mode === 'mock' ? 'warning' : 'info'}
      title={liveButBlocked ? 'Live couriers — real bookings switched off' : copy.label}
    >
      {compact ? null : copy.description}
      {liveButBlocked
        ? ' Real bookings are switched off in Courier settings, so booking through the APIs is paused; portal bookings can still be recorded.'
        : null}
      {settingsHref ? (
        <>
          {' '}
          <Link href={settingsHref} className="font-semibold underline underline-offset-4">
            <AutoText>Courier settings</AutoText>
          </Link>
        </>
      ) : null}
    </Alert>
  );
}
