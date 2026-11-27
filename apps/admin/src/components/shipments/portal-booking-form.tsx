'use client';

import { Field, Input, NativeSelect, Textarea } from '@nilzora/ui';
import { ClipboardCheck } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { recordPortalBookingAction } from '@/lib/courier-actions';
import { BookingOutcomeNotice } from './booking-outcome';
import type { BookingState } from './courier-state';
import { providerName } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const IDLE: BookingState = { status: 'idle' };

export interface PortalBookingFormProps {
  orderNumber: string;
  /** A return pickup booked in the portal (the order's delivery when left out). */
  returnId?: string | undefined;
  csrf: CsrfInput;
  /** Created once when the page rendered this form; resent with every retry of it. */
  initialBookingKey: string;
  providers: readonly { value: string; label: string }[];
  /** The courier a comparison recommended, if any: choosing another needs a reason. */
  recommendedProvider?: string | null | undefined;
  defaultWeightKg: string;
  canOpenShipment: boolean;
  /**
   * The action state, when a parent keeps it (so the outcome survives this form leaving
   * the page after the order refreshes). Without it the form keeps its own.
   */
  state?: BookingState;
  action?: (formData: FormData) => void;
}

/**
 * Records a parcel staff already booked in the courier's own merchant portal: Nilzora sends
 * nothing to the courier, it only keeps the consignment so the shipment can be tracked and
 * reconciled. The main way to ship while a courier's API is not verified.
 */
export function PortalBookingForm({
  orderNumber,
  returnId,
  csrf,
  initialBookingKey,
  providers,
  recommendedProvider,
  defaultWeightKg,
  canOpenShipment,
  state: outerState,
  action: outerAction,
}: PortalBookingFormProps) {
  const tx = useTx();
  const [ownState, ownAction] = useActionState(recordPortalBookingAction, IDLE);
  const state = outerState ?? ownState;
  const action = outerAction ?? ownAction;
  // One key per form: a resubmit or a retry after no answer records the parcel once.
  const [bookingKey] = useState(initialBookingKey);
  const [provider, setProvider] = useState<string>(
    () =>
      providers.find((p) => p.value === recommendedProvider)?.value ?? providers[0]?.value ?? '',
  );
  const mine = state.bookingKey === bookingKey;
  const recorded = mine && state.outcome === 'booked';
  const values = mine ? state.values : undefined;
  const errors = mine ? state.fieldErrors : undefined;
  const overriding = Boolean(recommendedProvider) && provider !== recommendedProvider;
  const scope = returnId ? `portal-${returnId}` : `portal-${orderNumber}`;
  const id = (name: string) => `${scope}-${name}`;

  return (
    <form
      action={action}
      className="grid gap-3"
      aria-label={returnId ? 'Record a portal return pickup' : 'Record a portal booking'}
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {returnId ? <input type="hidden" name="returnId" value={returnId} /> : null}
      <input type="hidden" name="bookingKey" value={bookingKey} />
      <input type="hidden" name="recommendedProvider" value={recommendedProvider ?? ''} />
      {mine ? <BookingOutcomeNotice state={state} canOpenShipment={canOpenShipment} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('provider')} label={tx('Courier')} error={errors?.provider} required>
          {(control) => (
            <NativeSelect
              {...control}
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.currentTarget.value)}
            >
              {providers.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.value === recommendedProvider ? ' (recommended)' : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={id('weight')} label={tx('Parcel weight (kg)')} error={errors?.weight} required>
          {(control) => (
            <Input
              {...control}
              name="weight"
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              defaultValue={values?.weight ?? defaultWeightKg}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field
          id={id('consignment')}
          label={tx('Consignment id')}
          hint={tx('Exactly as the courier portal shows it.')}
          error={errors?.consignmentId}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="consignmentId"
              maxLength={80}
              autoComplete="off"
              defaultValue={values?.consignmentId}
            />
          )}
        </Field>
        <Field
          id={id('tracking')}
          label={tx('Tracking code')}
          hint={tx('Optional')}
          error={errors?.trackingCode}
        >
          {(control) => (
            <Input
              {...control}
              name="trackingCode"
              maxLength={80}
              autoComplete="off"
              defaultValue={values?.trackingCode}
            />
          )}
        </Field>
        <Field
          id={id('charge')}
          label={tx('Courier charge (৳)')}
          hint={tx(
            'What the portal quoted Nilzora. Optional; the customer’s shipping charge is unchanged.',
          )}
          error={errors?.charge}
        >
          {(control) => (
            <Input
              {...control}
              name="charge"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={values?.charge}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
      {overriding && recommendedProvider ? (
        <Field
          id={id('reason')}
          label={`Why ${providerName(provider)} instead of ${providerName(recommendedProvider)}?`}
          hint={tx('Required when you do not take the recommendation.')}
          error={errors?.selectionReason}
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
              defaultValue={values?.selectionReason}
            />
          )}
        </Field>
      ) : null}
      <Field
        id={id('note')}
        label={tx('Where and how it was booked')}
        hint={tx(
          '5 to 300 characters, e.g. “Booked in the Pathao merchant portal by Rafi at 3 pm”.',
        )}
        error={errors?.note}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            minLength={5}
            maxLength={300}
            defaultValue={values?.note}
          />
        )}
      </Field>
      {mine && state.status === 'error' ? <ActionFeedback state={state} inline /> : null}
      {recorded ? null : (
        <SubmitButton className="w-fit" pendingLabel="Recording…">
          <ClipboardCheck aria-hidden="true" />
          <AutoText>Record portal booking</AutoText>
        </SubmitButton>
      )}
    </form>
  );
}
