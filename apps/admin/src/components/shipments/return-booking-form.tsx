'use client';

import { Button, Field, Input, NativeSelect } from '@nilzora/ui';
import { Send } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { bookReturnShipmentAction } from '@/lib/courier-actions';
import { BookingOutcomeNotice, newBookingKey } from './booking-panel';
import type { BookingState } from './courier-state';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const IDLE: BookingState = { status: 'idle' };

export interface ReturnBookingFormProps {
  returnId: string;
  kind: 'return_pickup' | 'exchange';
  csrf: CsrfInput;
  /** Created once when the page rendered the form; kept for every retry of it. */
  initialBookingKey: string;
  providers: readonly { value: string; label: string }[];
  defaultWeightKg: string;
  canOpenShipment: boolean;
}

/**
 * Books a courier to collect returned goods, or to deliver an exchange (with any cash to
 * collect for a price difference). Always one explicit staff step; the key stays the same
 * for every retry of this form, and only "Start a new attempt" after a refusal renews it.
 */
export function ReturnBookingForm({
  returnId,
  kind,
  csrf,
  initialBookingKey,
  providers,
  defaultWeightKg,
  canOpenShipment,
}: ReturnBookingFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(bookReturnShipmentAction, IDLE);
  const [bookingKey, setBookingKey] = useState(initialBookingKey);
  const [hidden, setHidden] = useState<BookingState | null>(null);
  const mine = state.bookingKey === bookingKey;
  const outcome = mine ? state.outcome : undefined;
  const id = (name: string) => `${kind}-${name}-${returnId}`;
  const exchange = kind === 'exchange';

  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="returnId" value={returnId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="bookingKey" value={bookingKey} />
      {state !== hidden ? (
        <BookingOutcomeNotice state={state} canOpenShipment={canOpenShipment} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={id('provider')}
          label={tx("Courier")}
          error={mine ? state.fieldErrors?.provider : undefined}
          required
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="provider"
              defaultValue={(mine ? state.values?.provider : undefined) ?? providers[0]?.value}
            >
              {providers.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id={id('weight')}
          label={tx("Parcel weight (kg)")}
          error={mine ? state.fieldErrors?.weight : undefined}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="weight"
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              defaultValue={(mine ? state.values?.weight : undefined) ?? defaultWeightKg}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
      {exchange ? (
        <Field
          id={id('cash')}
          label={tx("Cash to collect (৳)")}
          hint={tx("A price difference the courier collects; 0 for a like-for-like swap.")}
          error={mine ? state.fieldErrors?.cash : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="cash"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={(mine ? state.values?.cash : undefined) ?? '0'}
              className="tabular-nums"
            />
          )}
        </Field>
      ) : null}
      <Field id={id('note')} label={tx("Note")} hint={tx("Optional")}>
        {(control) => (
          <Input
            {...control}
            name="note"
            maxLength={300}
            defaultValue={mine ? state.values?.note : undefined}
          />
        )}
      </Field>
      {mine && !state.outcome && state.status === 'error' ? (
        <ActionFeedback state={state} inline />
      ) : null}
      {outcome === 'failed' ? (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setBookingKey(newBookingKey());
            setHidden(state);
          }}
        ><AutoText>Start a new booking attempt</AutoText></Button>
      ) : outcome ? null : (
        <SubmitButton variant="outline" className="w-fit" pendingLabel="Booking…">
          <Send aria-hidden="true" />
          {exchange ? 'Book exchange delivery' : 'Book return pickup'}
        </SubmitButton>
      )}
    </form>
  );
}
