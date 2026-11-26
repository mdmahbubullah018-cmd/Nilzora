'use client';

import { Alert } from '@nilzora/ui';
import Link from 'next/link';
import type { BookingState } from './courier-state';
import { shipmentHref } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';

/** The outcome of the last booking, in words staff can act on. */
export function BookingOutcomeNotice({
  state,
  canOpenShipment,
}: {
  state: BookingState;
  canOpenShipment: boolean;
}) {
  if (!state.outcome) return null;
  const link =
    state.shipmentId && canOpenShipment ? (
      <Link
        href={shipmentHref(state.shipmentId)}
        className="font-semibold underline underline-offset-4"
      ><AutoText>Open the shipment</AutoText></Link>
    ) : null;
  const tone =
    state.outcome === 'booked'
      ? 'success'
      : state.outcome === 'failed'
        ? 'danger'
        : state.outcome === 'uncertain'
          ? 'warning'
          : 'info';
  const title = {
    booked: 'Booked',
    failed: 'Booking failed',
    uncertain: 'Check the courier portal, then resolve',
    in_progress: 'Booking in progress',
  }[state.outcome];
  return (
    <Alert tone={tone} title={title}>
      {state.message}
      {state.duplicate && state.outcome === 'booked'
        ? ' (This was a repeat of the same booking, so nothing new was sent.)'
        : null}{' '}
      {link}
    </Alert>
  );
}
