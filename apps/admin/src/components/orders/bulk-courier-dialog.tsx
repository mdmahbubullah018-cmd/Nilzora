'use client';

import type { BulkShipmentBookingResponse } from '@nilzora/contracts';
import { Alert, Button, Dialog, Field, Input, NativeSelect } from '@nilzora/ui';
import { CircleAlert, CircleCheck, CircleX, Clock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { CourierModeBanner, ShipmentStatusChip } from '@/components/shipments/shipment-chips';
import {
  formatWeight,
  gramsToKgText,
  kgTextToGrams,
  shipmentHref,
} from '@/components/shipments/shipment-labels';
import { formatMoney, plural } from '@/lib/format';
import { bulkBookShipmentsAction, checkCourierBookingAction } from '@/lib/order-bulk-actions';
import {
  BOOKING_OUTCOME_TEXT,
  bookableOrders,
  bookingErrorText,
  bookingOutcomeOf,
  BULK_SHIPMENT_LIMIT,
  courierBlockerText,
  ensureBookingKeys,
  portalBookableOrders,
  type BookingOutcomeKind,
  type CourierCheckValue,
} from './bulk-logic';
import { actionForm, orderPageHref } from './bulk-shared';
import { DELIVERY_ZONE_LABEL } from './order-query';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { CountText } from '@/components/i18n/format-text';

/*
 * Prepare courier booking for the selected orders. Nothing is booked until staff choose a
 * courier, review the exact list and confirm. One booking key is made per order when the
 * confirmation opens and kept (by the toolbar) for every retry of this attempt, so sending
 * again never books a parcel twice. When booking by API is not available, the dialog only
 * explains how to book in the courier's portal and links to each order.
 */

type Step =
  | { kind: 'loading' }
  | { kind: 'load_failed'; message: string }
  | { kind: 'review' }
  | { kind: 'confirm' }
  | { kind: 'done'; response: BulkShipmentBookingResponse };

interface BookingRequest {
  provider: string;
  weight: string;
  items: { orderNumber: string; bookingKey: string }[];
}

export interface BookingKeys {
  /** The keys made so far for this browser tab's booking attempts, by order number. */
  get: () => Readonly<Record<string, string>>;
  set: (keys: Record<string, string>) => void;
}

export interface BulkCourierDialogProps {
  onClose: () => void;
  /** The selection when the dialog opened (it is rendered only while open). */
  selection: readonly string[];
  csrf: CsrfInput;
  keys: BookingKeys;
  /** Called once the API has answered a booking, with the counts for the toolbar. */
  onFinished?: (response: BulkShipmentBookingResponse) => void;
}

const UNAVAILABLE_TEXT = {
  off: 'Courier connections are switched off on this server, so parcels cannot be booked from Nilzora.',
  live_not_ready:
    'No courier is ready for booking by API: real bookings are switched off, or no courier has passed every readiness check.',
  config_unavailable:
    'The courier settings could not be read, so booking from here is not offered right now.',
} as const;

export function BulkCourierDialog({
  onClose,
  selection,
  csrf,
  keys,
  onFinished,
}: BulkCourierDialogProps) {
  const tx = useTx();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [data, setData] = useState<CourierCheckValue | null>(null);
  const [provider, setProvider] = useState('');
  const [weight, setWeight] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);
  const [request, setRequest] = useState<BookingRequest | null>(null);
  const [sendError, setSendError] = useState<{ message: string; unconfirmed: boolean } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ids = useId();

  useEffect(() => {
    let current = true;
    checkCourierBookingAction(actionForm(csrf, { orderNumber: selection })).then(
      (answer) => {
        if (!current) return;
        if (!answer.ok) {
          setStep({ kind: 'load_failed', message: answer.message });
          return;
        }
        setData(answer.value);
        setWeight(gramsToKgText(answer.value.check.defaultParcelWeightGrams));
        const { availability } = answer.value;
        setProvider(availability.available ? (availability.couriers[0]?.id ?? '') : '');
        setStep({ kind: 'review' });
      },
      () => {
        if (current) {
          setStep({
            kind: 'load_failed',
            message: 'The orders could not be checked. Check your connection and try again.',
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [csrf, selection, attempt]);

  const availability = data?.availability ?? null;
  const toBook = data ? bookableOrders(data.check) : { orderNumbers: [], overLimit: 0 };
  const courierName =
    availability?.available === true
      ? (availability.couriers.find((c) => c.id === provider)?.name ?? provider)
      : '';

  function close() {
    if (!sending) onClose();
  }

  /** Opens the confirmation: one key per order, made now and kept for every retry. */
  function review() {
    if (weight.trim() !== '' && kgTextToGrams(weight) === undefined) {
      setWeightError('Enter the parcel weight in kilograms, from 0.001 to 50 (e.g. 0.5).');
      return;
    }
    setWeightError(null);
    const made = ensureBookingKeys(keys.get(), toBook.orderNumbers);
    keys.set(made);
    setRequest({
      provider,
      weight: weight.trim(),
      items: toBook.orderNumbers.map((orderNumber) => ({
        orderNumber,
        bookingKey: made[orderNumber] ?? '',
      })),
    });
    setSendError(null);
    setStep({ kind: 'confirm' });
  }

  async function send() {
    if (!request) return;
    setSending(true);
    setSendError(null);
    try {
      const answer = await bulkBookShipmentsAction(
        actionForm(csrf, {
          confirm: 'yes',
          provider: request.provider,
          weight: request.weight,
          item: request.items.map((item) => `${item.orderNumber}:${item.bookingKey}`),
        }),
      );
      if (answer.ok) {
        // A courier refusal created nothing: that order gets a fresh key next time. Every
        // other outcome keeps its key, so a retry can only find the same booking.
        const next = { ...keys.get() };
        for (const row of answer.value.results) {
          if (bookingOutcomeOf(row) === 'failed' && row.outcome === 'failed') {
            delete next[row.orderNumber];
          }
        }
        keys.set(next);
        onFinished?.(answer.value);
        setStep({ kind: 'done', response: answer.value });
      } else {
        setSendError({ message: answer.message, unconfirmed: answer.unconfirmed });
      }
    } catch {
      setSendError({
        message:
          'Nilzora could not confirm the bookings. Send them again: the same booking keys are used, so no parcel is booked twice.',
        unconfirmed: true,
      });
    } finally {
      setSending(false);
    }
  }

  const title =
    step.kind === 'confirm' && request
      ? `Book ${plural(request.items.length, 'parcel')} with ${courierName}?`
      : step.kind === 'done'
        ? 'Booking results'
        : 'Prepare courier booking';

  const canBook = availability?.available === true && toBook.orderNumbers.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={title}
      description={
        step.kind === 'confirm'
          ? 'One parcel is booked for each order below. The orders’ status and payment do not change.'
          : step.kind === 'review'
            ? `Checks the ${plural(selection.length, 'selected order')}. Nothing is booked until you confirm.`
            : undefined
      }
      className="sm:max-w-3xl"
      footer={
        step.kind === 'review' ? (
          <>
            <Button variant="ghost" onClick={close}><AutoText>Cancel</AutoText></Button>
            {canBook ? (
              <Button disabled={!provider} onClick={review}>
                {`Book ${plural(toBook.orderNumbers.length, 'eligible order')} with ${courierName}`}
              </Button>
            ) : null}
          </>
        ) : step.kind === 'confirm' ? (
          <>
            <Button variant="ghost" disabled={sending} onClick={() => setStep({ kind: 'review' })}><AutoText>Back</AutoText></Button>
            <Button loading={sending} onClick={() => void send()}>
              {sendError?.unconfirmed
                ? 'Send the same bookings again'
                : `Yes, book ${plural(request?.items.length ?? 0, 'parcel')}`}
            </Button>
          </>
        ) : (
          <Button variant={step.kind === 'done' ? 'primary' : 'ghost'} onClick={close}>
            {step.kind === 'done' ? 'Done' : 'Cancel'}
          </Button>
        )
      }
    >
      {step.kind === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground"><AutoText>Checking which selected orders can be booked…</AutoText></p>
      ) : step.kind === 'load_failed' ? (
        <div className="grid gap-3">
          <Alert tone="danger" title={tx("The orders could not be checked")}>
            {step.message}
          </Alert>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => {
              setStep({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          ><AutoText>Try again</AutoText></Button>
        </div>
      ) : step.kind === 'review' && data && availability ? (
        <div className="grid gap-4">
          <p className="text-sm text-foreground">
            {availability.available ? (
              <>
                <strong><CountText count={data.check.bookable} one="order" /></strong> of {selection.length} can be
                booked now.
              </>
            ) : (
              <>
                <strong><CountText count={portalBookableOrders(data.check).length} one="order" /></strong> of{' '}
                {selection.length} can be booked in the courier’s portal.
              </>
            )}
          </p>
          <EligibilityTable data={data} couriersUnavailable={!availability.available} />
          {availability.available ? (
            toBook.orderNumbers.length > 0 ? (
              <div className="grid gap-4 rounded-xl border border-hairline p-4">
                {availability.mode === 'mock' ? <CourierModeBanner mode="mock" compact /> : null}
                {toBook.overLimit > 0 ? (
                  <Alert
                    tone="warning"
                    title={`At most ${String(BULK_SHIPMENT_LIMIT)} parcels at a time`}
                  >
                    The first {BULK_SHIPMENT_LIMIT} eligible orders are booked now;{' '}
                    <CountText count={toBook.overLimit} one="order" /> can be booked afterwards.
                  </Alert>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${ids}-courier`} label={tx("Courier")} required>
                    {(control) => (
                      <NativeSelect
                        {...control}
                        value={provider}
                        onChange={(event) => setProvider(event.currentTarget.value)}
                      >
                        {availability.couriers.map((courier) => (
                          <option key={courier.id} value={courier.id}>
                            {courier.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                  <Field
                    id={`${ids}-weight`}
                    label={tx("Weight per parcel (kg)")}
                    hint={`Default ${formatWeight(data.check.defaultParcelWeightGrams)}. Leave empty for the courier default.`}
                    error={weightError ?? undefined}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={6}
                        className="text-base sm:text-sm"
                        value={weight}
                        onChange={(event) => setWeight(event.currentTarget.value)}
                      />
                    )}
                  </Field>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground"><AutoText>None of the selected orders can be booked now.</AutoText></p>
            )
          ) : (
            <PortalOnly
              reason={UNAVAILABLE_TEXT[availability.reason]}
              orderNumbers={portalBookableOrders(data.check)}
            />
          )}
        </div>
      ) : step.kind === 'confirm' && request ? (
        <div className="grid gap-3">
          <p className="text-sm text-foreground">
            Courier: <strong><AutoText value={courierName} /></strong>
            {' · '}
            Weight: {request.weight ? `${request.weight} kg each` : 'courier default'}
          </p>
          <ul
            aria-label={tx("Orders to book")}
            className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto"
          >
            {request.items.map((item) => (
              <li key={item.orderNumber} className="font-mono text-xs">
                <Chip tone="primary"><AutoText value={item.orderNumber} /></Chip>
              </li>
            ))}
          </ul>
          {sendError ? (
            <Alert
              tone={sendError.unconfirmed ? 'warning' : 'danger'}
              title={sendError.unconfirmed ? 'Not confirmed' : 'Not booked'}
            >
              {sendError.message}
            </Alert>
          ) : null}
        </div>
      ) : step.kind === 'done' ? (
        <BookingResults response={step.response} courier={courierName} />
      ) : null}
    </Dialog>
  );
}

function EligibilityTable({
  data,
  couriersUnavailable,
}: {
  data: CourierCheckValue;
  couriersUnavailable: boolean;
}) {
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-hairline">
      <table className="w-full text-sm">
        <caption className="sr-only"><AutoText>Which selected orders can be booked</AutoText></caption>
        <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium"><AutoText>Order</AutoText></th>
            <th scope="col" className="px-3 py-2 font-medium"><AutoText>Booking</AutoText></th>
            <th scope="col" className="px-3 py-2 text-right font-medium"><AutoText>COD due</AutoText></th>
            <th scope="col" className="px-3 py-2 font-medium"><AutoText>District</AutoText></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {data.check.results.map((row) => (
            <tr key={row.orderNumber}>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap"><AutoText value={row.orderNumber} /></td>
              <td className="px-3 py-2">
                {row.bookable ? (
                  <span className="inline-flex items-center gap-1.5 text-success-ink">
                    <CircleCheck aria-hidden="true" className="size-4" /><AutoText>Can be booked</AutoText></span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    <CircleX aria-hidden="true" className="size-4 shrink-0" />
                    {courierBlockerText(row, couriersUnavailable)}
                    {row.shipmentStatus ? <ShipmentStatusChip status={row.shipmentStatus} /> : null}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                {row.codDueMinor === null ? '—' : formatMoney(row.codDueMinor)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.district ?? '—'}
                {row.deliveryZone ? (
                  <span className="block text-xs text-muted-foreground">
                    {DELIVERY_ZONE_LABEL[row.deliveryZone]}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Booking by API is not available: book in the courier's portal and record it per order. */
function PortalOnly({ reason, orderNumbers }: { reason: string; orderNumbers: string[] }) {
  const tx = useTx();
  return (
    <Alert tone="info" title={tx("Book these parcels in the courier’s portal")}>
      <span className="grid gap-2">
        <span>
          {reason} Book each parcel in the courier’s own merchant portal, then record its
          consignment in the Shipment section of the order’s page so it can be tracked and
          reconciled.
        </span>
        {orderNumbers.length > 0 ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {orderNumbers.map((orderNumber) => (
              <Link
                key={orderNumber}
                href={orderPageHref(orderNumber)}
                className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
              >
                {orderNumber}
              </Link>
            ))}
          </span>
        ) : null}
      </span>
    </Alert>
  );
}

const OUTCOME_ICON: Record<BookingOutcomeKind, ReactNode> = {
  booked: <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-ink" />,
  duplicate: <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-info-ink" />,
  uncertain: <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-warning-ink" />,
  in_progress: <Clock aria-hidden="true" className="size-4 shrink-0 text-warning-ink" />,
  failed: <CircleX aria-hidden="true" className="size-4 shrink-0 text-danger-ink" />,
};

/** The API's answer, order by order. */
export function BookingResults({
  response,
  courier,
}: {
  response: BulkShipmentBookingResponse;
  courier: string;
}) {
  const tx = useTx();
  return (
    <div className="grid gap-3">
      <p role="status" className="text-sm text-foreground">
        <strong><CountText count={response.booked} one="parcel" /> booked</strong>
        {courier ? ` with ${courier}` : ''}
        {response.failed > 0 ? ` · ${String(response.failed)} not booked` : ''}
        {response.uncertain > 0 ? ` · ${String(response.uncertain)} need a check` : ''}.
      </p>
      {response.uncertain > 0 ? (
        <Alert tone="warning" title={tx("Check the courier portal")}>
          The courier did not answer clearly for some orders. Look for them in the courier’s portal,
          then resolve each booking on the order page. Do not book them again first.
        </Alert>
      ) : null}
      <ul
        aria-label={tx("Booking result for each order")}
        className="grid max-h-72 gap-1 overflow-y-auto"
      >
        {response.results.map((row) => {
          const kind = bookingOutcomeOf(row);
          return (
            <li
              key={row.orderNumber}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline px-3 py-2 text-sm"
            >
              <Link
                href={orderPageHref(row.orderNumber)}
                className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
              >
                {row.orderNumber}
              </Link>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
                {OUTCOME_ICON[kind]}
                {kind === 'failed'
                  ? `${BOOKING_OUTCOME_TEXT.failed}: ${bookingErrorText(row.error)}`
                  : BOOKING_OUTCOME_TEXT[kind]}
              </span>
              {row.shipmentId && (kind === 'booked' || kind === 'duplicate') ? (
                <Link
                  href={shipmentHref(row.shipmentId)}
                  aria-label={`Open shipment for ${row.orderNumber}`}
                  className="text-xs font-medium text-link underline-offset-4 hover:underline"
                ><AutoText>Open shipment</AutoText></Link>
              ) : kind === 'uncertain' ? (
                <Link
                  href={orderPageHref(row.orderNumber)}
                  aria-label={`Resolve on the order page for ${row.orderNumber}`}
                  className="text-xs font-medium text-link underline-offset-4 hover:underline"
                ><AutoText>Resolve on the order page</AutoText></Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
