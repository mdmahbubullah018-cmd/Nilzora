'use client';

import {
  COURIER_PROVIDER_IDS,
  type CourierRateCard,
  type CourierSettings,
} from '@nilzora/contracts';
import { Field, Input, NativeSelect } from '@nilzora/ui';
import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  deleteRateCardAction,
  saveCourierSettingsAction,
  saveRateCardAction,
} from '@/lib/courier-actions';
import { ActionDisclosure } from './shipment-actions';
import { gramsToKgText, providerName } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Default parcel weight, quote validity, preferred courier and history sample. */
export function CourierSettingsForm({
  settings,
  csrf,
}: {
  settings: CourierSettings;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveCourierSettingsAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="default-weight"
          label={tx("Default parcel weight (kg)")}
          hint={tx("Prefilled on every booking; staff can change it per parcel.")}
          error={state.fieldErrors?.weight}
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
                state.values?.weight ?? gramsToKgText(settings.defaultParcelWeightGrams)
              }
            />
          )}
        </Field>
        <Field
          id="quote-validity"
          label={tx("Quote validity (minutes)")}
          hint={tx("How long a compared price can be booked.")}
          error={state.fieldErrors?.quoteValidityMinutes}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="quoteValidityMinutes"
              type="number"
              min={1}
              max={1440}
              defaultValue={
                state.values?.quoteValidityMinutes ?? String(settings.quoteValidityMinutes)
              }
            />
          )}
        </Field>
        <Field
          id="preferred-courier"
          label={tx("Preferred courier")}
          hint={tx("Breaks ties in the recommendation.")}
          error={state.fieldErrors?.preferredProvider}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="preferredProvider"
              defaultValue={state.values?.preferredProvider ?? settings.preferredProvider ?? ''}
            >
              <option value=""><AutoText>No preference</AutoText></option>
              {COURIER_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {providerName(id)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id="history-sample"
          label={tx("Minimum delivery history")}
          hint={tx("Shipments needed before a courier’s delivery rate counts.")}
          error={state.fieldErrors?.minHistorySample}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="minHistorySample"
              type="number"
              min={1}
              max={10000}
              defaultValue={state.values?.minHistorySample ?? String(settings.minHistorySample)}
            />
          )}
        </Field>
      </div>
      <SubmitButton className="w-fit" pendingLabel="Saving…"><AutoText>Save courier settings</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** Adds a rate, or edits one when `rate` is given. */
export function RateCardForm({ rate, csrf }: { rate?: CourierRateCard; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveRateCardAction, IDLE_STATE);
  const key = rate?.id ?? 'new';
  const id = (name: string) => `rate-${key}-${name}`;
  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      {rate ? <input type="hidden" name="rateCardId" value={rate.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('provider')} label={tx("Courier")} error={state.fieldErrors?.provider} required>
          {(control) => (
            <NativeSelect
              {...control}
              name="provider"
              defaultValue={state.values?.provider ?? rate?.provider ?? COURIER_PROVIDER_IDS[0]}
            >
              {COURIER_PROVIDER_IDS.map((provider) => (
                <option key={provider} value={provider}>
                  {providerName(provider)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={id('zone')} label={tx("Zone")} error={state.fieldErrors?.zone} required>
          {(control) => (
            <NativeSelect
              {...control}
              name="zone"
              defaultValue={state.values?.zone ?? rate?.zone ?? 'inside_dhaka'}
            >
              <option value="inside_dhaka"><AutoText>Inside Dhaka</AutoText></option>
              <option value="outside_dhaka"><AutoText>Outside Dhaka</AutoText></option>
            </NativeSelect>
          )}
        </Field>
        <Field
          id={id('weight')}
          label={tx("Up to weight (kg)")}
          error={state.fieldErrors?.weight}
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
                state.values?.weight ?? (rate ? gramsToKgText(rate.weightUpToGrams) : '')
              }
            />
          )}
        </Field>
        <Field id={id('charge')} label={tx("Charge (৳)")} error={state.fieldErrors?.charge} required>
          {(control) => (
            <Input
              {...control}
              name="charge"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={state.values?.charge ?? (rate ? String(rate.chargeMinor / 100) : '')}
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={rate?.isActive ?? true}
          className="size-4 accent-primary-action"
        /><AutoText>Active (used for Internal Estimates)</AutoText></label>
      <SubmitButton size="sm" className="w-fit" pendingLabel="Saving…">
        {rate ? 'Save rate' : 'Add rate'}
      </SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** Edit and remove controls for one rate row. */
export function RateCardRowActions({ rate, csrf }: { rate: CourierRateCard; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(deleteRateCardAction, IDLE_STATE);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <ActionDisclosure title={tx("Edit")}>
          <RateCardForm rate={rate} csrf={csrf} />
        </ActionDisclosure>
        <ConfirmForm
          action={action}
          csrf={csrf}
          trigger={
            <>
              <Trash2 aria-hidden="true" />
              <span className="sr-only"><AutoText>Remove this rate</AutoText></span>
            </>
          }
          title={tx("Remove this rate?")}
          description={tx("Internal Estimates stop using it. Shipments already booked keep their charges.")}
          confirmLabel={tx("Remove rate")}
          hiddenFields={{ rateCardId: rate.id }}
          error={state.status === 'error' ? state.message : undefined}
        />
      </div>
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}

/** The "Add a rate" disclosure above the table. */
export function AddRateCard({ csrf }: { csrf: CsrfInput }) {
  const tx = useTx();
  return (
    <ActionDisclosure title={tx("Add a negotiated rate")} description={tx("One courier, zone and weight band")}>
      <RateCardForm csrf={csrf} />
    </ActionDisclosure>
  );
}
