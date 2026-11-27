'use client';

import type {
  CourierCompareResponse,
  CourierMode,
  CourierQuote,
  OrderCourierContext,
} from '@nilzora/contracts';
import {
  Button,
  cn,
  Field,
  Input,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@nilzora/ui';
import { Scale, Send, Sparkles } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { DataTable } from '@/components/admin-kit/data-table';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  bookShipmentAction,
  compareCouriersAction,
  recordPortalBookingAction,
} from '@/lib/courier-actions';
import { formatDateTime, formatMoney } from '@/lib/format';
import { BookingOutcomeNotice } from './booking-outcome';
import type { BookingState, CompareState } from './courier-state';
import { PortalBookingForm } from './portal-booking-form';
import { ActionDisclosure } from './shipment-actions';
import { QuoteKindChip, TestChip } from './shipment-chips';
import {
  COURIER_MODE_COPY,
  formatWeight,
  gramsToKgText,
  providerName,
  quoteTotal,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { DateTimeText } from '@/components/i18n/format-text';

export { BookingOutcomeNotice } from './booking-outcome';

const IDLE_COMPARE: CompareState = { status: 'idle' };
const IDLE_BOOKING: BookingState = { status: 'idle' };

/** A new booking key for a new attempt (the first one comes from the comparison). */
export function newBookingKey(): string {
  return crypto.randomUUID();
}

export interface QuoteTableProps {
  comparison: CourierCompareResponse;
  names: Readonly<Record<string, string>>;
}

/** Every courier's price for this parcel, labelled by where the price comes from. */
export function QuoteTable({ comparison, names }: QuoteTableProps) {
  const recommended = comparison.recommendation.provider;
  return (
    <DataTable caption="Courier prices for this parcel" dense>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>
            <AutoText>Courier</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Price source</AutoText>
          </TableHead>
          <TableHead className="text-right">
            <AutoText>Delivery</AutoText>
          </TableHead>
          <TableHead className="text-right">
            <AutoText>COD fee</AutoText>
          </TableHead>
          <TableHead className="text-right">
            <AutoText>Return charge</AutoText>
          </TableHead>
          <TableHead className="text-right">
            <AutoText>Total</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Valid until</AutoText>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comparison.quotes.map((quote) => {
          const total = quoteTotal(quote);
          return (
            <TableRow key={quote.id}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    {names[quote.provider] ?? providerName(quote.provider)}
                    {quote.provider === recommended ? (
                      <span className="text-xs font-semibold text-success-ink">
                        <AutoText>Recommended</AutoText>
                      </span>
                    ) : null}
                  </span>
                  {!quote.available ? (
                    <span className="text-xs whitespace-normal text-danger-ink">
                      Cannot take this parcel
                      {quote.unavailableReason ? `: ${quote.unavailableReason}` : ''}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <QuoteKindChip kind={quote.kind} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {quote.deliveryChargeMinor === null ? '—' : formatMoney(quote.deliveryChargeMinor)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {quote.codFeeMinor === null ? '—' : formatMoney(quote.codFeeMinor)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {quote.returnChargeMinor === null ? '—' : formatMoney(quote.returnChargeMinor)}
              </TableCell>
              <TableCell className="text-right font-semibold text-foreground tabular-nums">
                {total === null ? '—' : formatMoney(total)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                <time dateTime={quote.expiresAt} title={formatDateTime(quote.expiresAt)}>
                  <DateTimeText value={quote.expiresAt} style="time" />
                </time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </DataTable>
  );
}

export interface BookingFormProps {
  orderNumber: string;
  csrf: CsrfInput;
  context: OrderCourierContext;
  comparison: CourierCompareResponse;
  /** The key this form was opened with (from the comparison); kept for every retry. */
  initialBookingKey: string;
  names: Readonly<Record<string, string>>;
  state: BookingState;
  action: (formData: FormData) => void;
  /** Hides the last outcome when staff start a new attempt. */
  onNewAttempt: () => void;
}

/**
 * Choose a courier, see what will be sent, then book with one explicit button. The
 * booking key is created once for this form and resent with every retry of it, so a
 * double click or a lost answer never books twice; only "Start a new attempt" (after a
 * refusal) makes a new one.
 */
export function BookingForm({
  orderNumber,
  csrf,
  context,
  comparison,
  initialBookingKey,
  names,
  state,
  action,
  onNewAttempt,
}: BookingFormProps) {
  const tx = useTx();
  const [bookingKey, setBookingKey] = useState(initialBookingKey);
  const choosable = comparison.quotes.filter((quote) => quote.available);
  const recommended = comparison.recommendation.provider;
  const [chosen, setChosen] = useState<string | undefined>(
    () =>
      choosable.find((quote) => quote.provider === recommended)?.provider ?? choosable[0]?.provider,
  );
  const quote: CourierQuote | undefined = choosable.find((q) => q.provider === chosen);
  const overriding = recommended !== null && chosen !== undefined && chosen !== recommended;
  const mine = state.bookingKey === bookingKey;
  const lastOutcome = mine ? state.outcome : undefined;
  const settled =
    lastOutcome === 'booked' || lastOutcome === 'uncertain' || lastOutcome === 'in_progress';
  const failed = lastOutcome === 'failed';
  const name = chosen ? (names[chosen] ?? providerName(chosen)) : '';
  const total = quote ? quoteTotal(quote) : null;
  const mapping = context.locationMappings.find((m) => m.provider === chosen);
  const { order } = context;

  if (choosable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No courier can take this parcel right now. Check the reasons above, or book in a courier
        portal and record the shipment status by hand.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4" aria-label={`Book a courier for ${orderNumber}`}>
      <CsrfField csrf={csrf} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <input type="hidden" name="bookingKey" value={bookingKey} />
      <input type="hidden" name="weightGrams" value={String(comparison.weightGrams)} />
      <input type="hidden" name="quoteId" value={quote?.id ?? ''} />
      <input type="hidden" name="recommendedProvider" value={recommended ?? ''} />

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          <AutoText>Courier</AutoText>
        </legend>
        <div className="flex flex-wrap gap-2">
          {choosable.map((option) => (
            <label
              key={option.provider}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                chosen === option.provider
                  ? 'border-info-line bg-info-soft/50 font-semibold text-foreground'
                  : 'border-hairline bg-surface text-body',
              )}
            >
              <input
                type="radio"
                name="provider"
                value={option.provider}
                checked={chosen === option.provider}
                onChange={() => setChosen(option.provider)}
                className="size-4 accent-primary-action"
              />
              {names[option.provider] ?? providerName(option.provider)}
              {option.provider === recommended ? (
                <span className="text-xs font-medium text-success-ink">(recommended)</span>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>

      {overriding ? (
        <Field
          id={`selection-reason-${orderNumber}`}
          label={`Why ${name} instead of ${names[recommended] ?? providerName(recommended)}?`}
          hint={tx('Required when you do not take the recommendation. Kept on the shipment.')}
          error={mine ? state.fieldErrors?.selectionReason : undefined}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              name="selectionReason"
              rows={2}
              minLength={3}
              maxLength={300}
              required
              defaultValue={mine ? state.values?.selectionReason : undefined}
            />
          )}
        </Field>
      ) : null}

      <Field
        id={`booking-note-${orderNumber}`}
        label={tx('Note for the courier record')}
        hint={tx('Optional')}
      >
        {(control) => (
          <Input
            {...control}
            name="note"
            maxLength={300}
            defaultValue={mine ? state.values?.note : undefined}
          />
        )}
      </Field>

      <section
        aria-label={tx('Booking preview')}
        className="grid gap-2 rounded-xl border border-hairline bg-surface-muted/50 p-4 text-sm"
      >
        <p className="font-semibold text-foreground">
          <AutoText>Before you book</AutoText>
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">
            <AutoText>Courier</AutoText>
          </dt>
          <dd className="text-foreground">
            <AutoText value={name} />
          </dd>
          <dt className="text-muted-foreground">
            <AutoText>Deliver to</AutoText>
          </dt>
          <dd className="text-foreground">
            {order.area}, {order.district} ({order.division})
            {mapping?.label ? (
              <span className="block text-xs text-muted-foreground">
                Courier location: {mapping.label}
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">
            <AutoText>Cash to collect</AutoText>
          </dt>
          <dd className="text-foreground tabular-nums">
            <AutoText value={formatMoney(order.codDueMinor)} />
          </dd>
          <dt className="text-muted-foreground">
            <AutoText>Parcel weight</AutoText>
          </dt>
          <dd className="text-foreground">
            <AutoText value={formatWeight(comparison.weightGrams)} />
          </dd>
          <dt className="text-muted-foreground">
            <AutoText>Expected courier charge</AutoText>
          </dt>
          <dd className="flex flex-wrap items-center gap-2 text-foreground tabular-nums">
            {total === null ? 'No price' : formatMoney(total)}
            {quote ? <QuoteKindChip kind={quote.kind} /> : null}
          </dd>
          <dt className="text-muted-foreground">
            <AutoText>Customer paid for delivery</AutoText>
          </dt>
          <dd className="text-foreground tabular-nums">
            {formatMoney(order.shippingFeeMinor)}{' '}
            <span className="text-xs text-muted-foreground">(unchanged by booking)</span>
          </dd>
        </dl>
      </section>

      {mine && !state.outcome && state.status === 'error' ? (
        <ActionFeedback state={state} inline />
      ) : null}

      {failed ? (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setBookingKey(newBookingKey());
            onNewAttempt();
          }}
        >
          <AutoText>Start a new booking attempt</AutoText>
        </Button>
      ) : settled ? null : (
        <SubmitButton className="w-fit" pendingLabel={`Booking with ${name}…`}>
          <Send aria-hidden="true" />
          Book with {name}
        </SubmitButton>
      )}
    </form>
  );
}

export interface OrderCourierPanelProps {
  orderNumber: string;
  csrf: CsrfInput;
  context: OrderCourierContext;
  /** Null when the courier configuration could not be read. */
  mode: CourierMode | null;
  bookingEnabled: boolean | null;
  names: Readonly<Record<string, string>>;
  /** shipments.create: compare and book (the API checks it again). */
  canBook: boolean;
  /** shipments.read: link to shipment pages. */
  canOpenShipments: boolean;
  /**
   * Whether Nilzora can book through a courier API now (test mode, or live with a verified
   * booking API). When not, recording a portal booking is the way to ship.
   */
  apiBookable: boolean;
  /** The key of the portal-booking form, created once when the page rendered it. */
  portalBookingKey: string;
  providerOptions: readonly { value: string; label: string }[];
}

/**
 * The order's courier booking: weight, compare, choose, preview, then book. Rendered for
 * every state of the order so the last outcome stays on screen after the page refreshes.
 */
export function OrderCourierPanel({
  orderNumber,
  csrf,
  context,
  mode,
  bookingEnabled,
  names,
  canBook,
  canOpenShipments,
  apiBookable,
  portalBookingKey,
  providerOptions,
}: OrderCourierPanelProps) {
  const tx = useTx();
  const [compareState, compareAction] = useActionState(compareCouriersAction, IDLE_COMPARE);
  const [bookState, bookAction] = useActionState(bookShipmentAction, IDLE_BOOKING);
  const [hidden, setHidden] = useState<BookingState | null>(null);
  const comparison = compareState.status === 'success' ? compareState.comparison : undefined;
  const [portalState, portalAction] = useActionState(recordPortalBookingAction, IDLE_BOOKING);
  const showOutcome = bookState !== hidden;
  const canCompare = canBook && context.bookable && apiBookable;
  const canRecordPortal = canBook && context.bookable;
  const portalForm = (
    <PortalBookingForm
      orderNumber={orderNumber}
      csrf={csrf}
      initialBookingKey={portalBookingKey}
      providers={providerOptions}
      recommendedProvider={comparison?.recommendation.provider}
      defaultWeightKg={gramsToKgText(context.defaultParcelWeightGrams)}
      canOpenShipment={canOpenShipments}
      state={portalState}
      action={portalAction}
    />
  );

  return (
    <div className="grid gap-4">
      {showOutcome ? (
        <BookingOutcomeNotice state={bookState} canOpenShipment={canOpenShipments} />
      ) : null}
      {/* Once recorded, the order is no longer bookable: the outcome stays here. */}
      {!canRecordPortal ? (
        <BookingOutcomeNotice state={portalState} canOpenShipment={canOpenShipments} />
      ) : null}

      {mode === 'mock' ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <TestChip /> {COURIER_MODE_COPY.mock.label}: prices and bookings come from the test
          courier.
        </p>
      ) : null}

      {!context.bookable ? null : !canBook ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>Your account can see shipments but cannot book couriers.</AutoText>
        </p>
      ) : !apiBookable ? (
        <section
          aria-labelledby={`portal-heading-${orderNumber}`}
          className="grid gap-3 rounded-xl border border-info-line bg-info-soft/30 p-4"
        >
          <div className="grid gap-1">
            <h3
              id={`portal-heading-${orderNumber}`}
              className="font-display text-sm font-semibold text-foreground"
            >
              <AutoText>Book in the courier portal, then record it here</AutoText>
            </h3>
            <p className="text-sm text-muted-foreground">
              {mode === 'off'
                ? 'Courier connections are switched off on this server, so Nilzora cannot book for you.'
                : mode === 'live' && bookingEnabled === false
                  ? 'Real bookings are switched off on the server.'
                  : 'Booking through the courier APIs is not available yet (awaiting verified API documentation).'}{' '}
              Book the parcel in the Steadfast or Pathao merchant portal, then record its
              consignment here so it can be tracked and reconciled.
            </p>
          </div>
          {portalForm}
        </section>
      ) : null}

      {canCompare ? (
        <form action={compareAction} className="flex flex-wrap items-end gap-3">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <Field
            id={`parcel-weight-${orderNumber}`}
            label={tx('Parcel weight (kg)')}
            hint={`Default ${formatWeight(context.defaultParcelWeightGrams)}; change it for a heavier parcel.`}
            error={compareState.fieldErrors?.weight}
            className="w-full max-w-56"
            required
          >
            {(control) => (
              <Input
                {...control}
                name="weight"
                inputMode="decimal"
                autoComplete="off"
                maxLength={6}
                defaultValue={
                  compareState.values?.weight ?? gramsToKgText(context.defaultParcelWeightGrams)
                }
                className="tabular-nums"
              />
            )}
          </Field>
          <SubmitButton variant="outline" pendingLabel="Asking couriers…">
            <Scale aria-hidden="true" />
            {comparison ? 'Compare again' : 'Compare couriers'}
          </SubmitButton>
          {compareState.status === 'error' ? (
            <ActionFeedback state={compareState} inline className="basis-full" />
          ) : null}
        </form>
      ) : null}

      {canCompare && comparison && compareState.bookingKey ? (
        <div className="grid gap-4">
          {comparison.isMock ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <TestChip /> Test prices from the mock courier, not real courier charges.
            </p>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-hairline">
            <QuoteTable comparison={comparison} names={names} />
          </div>
          <div className="grid gap-1 rounded-xl border border-success-line bg-success-soft/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <Sparkles aria-hidden="true" className="size-4 text-success-ink" />
              {comparison.recommendation.provider
                ? `Recommended: ${names[comparison.recommendation.provider] ?? providerName(comparison.recommendation.provider)}`
                : 'No courier can be recommended'}
            </p>
            {comparison.recommendation.reasons.length > 0 ? (
              <ul className="list-disc pl-5 text-muted-foreground">
                {comparison.recommendation.reasons.map((reason) => (
                  <li key={reason}>
                    <AutoText value={reason} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <BookingForm
            key={compareState.bookingKey}
            orderNumber={orderNumber}
            csrf={csrf}
            context={context}
            comparison={comparison}
            initialBookingKey={compareState.bookingKey}
            names={names}
            state={bookState}
            action={bookAction}
            onNewAttempt={() => setHidden(bookState)}
          />
        </div>
      ) : null}

      {canCompare ? (
        <ActionDisclosure
          title={tx('Booked in the courier portal instead?')}
          description={tx('Record a parcel already booked in the courier’s merchant portal')}
          open={portalState.status !== 'idle'}
        >
          {portalForm}
        </ActionDisclosure>
      ) : null}
    </div>
  );
}
