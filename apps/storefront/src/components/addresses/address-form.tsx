'use client';

import { BD_DISTRICTS, BD_DIVISIONS, isDistrictOf, type BdDivision } from '@nilzora/contracts';
import { Button, buttonClasses, Field, Input, NativeSelect } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useActionState, useState, useSyncExternalStore } from 'react';
// Type-only: auth-routes uses the server-only session package.
import type { AddressReturnPath } from '@/lib/auth-routes';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';
import type { AddressFormValues } from './address-values';

interface AddressFormFields {
  csrf: CsrfField;
  /** Set when editing: the action replaces this address. */
  addressId?: string;
  /** Where to go once saved; the action checks it against its own allow-list again. */
  next: AddressReturnPath;
  initial: AddressFormValues;
  /**
   * `offer` shows the "default address" checkbox. The default only moves to another
   * address, so it is not offered for the current default (`current`) or for a first
   * address, which becomes the default anyway (`first`).
   */
  defaultChoice: 'offer' | 'current' | 'first';
  submitLabel: string;
  cancelHref: Route;
}

export type AddressFormViewProps = AddressFormFields & FormStatusProps;

const noSubscription = () => () => undefined;

/** False in the server HTML (and without JavaScript), true once the page is interactive. */
function useInteractive(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function isDivision(value: string): value is BdDivision {
  return (BD_DIVISIONS as readonly string[]).includes(value);
}

/**
 * Division and district. Without JavaScript the district list shows every district,
 * grouped by division; once interactive it lists only the chosen division's districts.
 * The action (and the API) check the pairing either way.
 *
 * Both selects are uncontrolled (defaultValue): React resets a form after each action,
 * and a controlled select would then show its first option while state kept the old
 * value. State only drives the district filter; the district select is keyed by the
 * division so choosing another division starts it afresh.
 */
function LocationFields({
  initialDivision,
  initialDistrict,
  errors,
}: {
  initialDivision: string;
  initialDistrict: string;
  errors: Partial<Record<string, string>>;
}) {
  const interactive = useInteractive();
  const [division, setDivision] = useState(initialDivision);
  const filtered = interactive && isDivision(division);
  const districtDefault =
    isDistrictOf(division, initialDistrict) || !interactive ? initialDistrict : '';

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field id="address-division" label="Division" error={errors.division} required>
        {(control) => (
          <NativeSelect
            {...control}
            name="division"
            autoComplete="address-level1"
            defaultValue={initialDivision}
            onChange={(event) => setDivision(event.target.value)}
          >
            <option value="">Choose a division</option>
            {BD_DIVISIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="address-district" label="District" error={errors.district} required>
        {(control) => (
          <NativeSelect
            {...control}
            key={filtered ? division : 'all'}
            name="district"
            autoComplete="address-level2"
            defaultValue={districtDefault}
            disabled={interactive && !isDivision(division)}
          >
            <option value="">
              {interactive && !isDivision(division)
                ? 'Choose a division first'
                : 'Choose a district'}
            </option>
            {filtered
              ? BD_DISTRICTS[division].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              : BD_DIVISIONS.map((group) => (
                  <optgroup key={group} label={`${group} Division`}>
                    {BD_DISTRICTS[group].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </NativeSelect>
        )}
      </Field>
    </div>
  );
}

export function AddressFormView({
  csrf,
  addressId,
  next,
  initial,
  defaultChoice,
  submitLabel,
  cancelHref,
  state,
  formAction,
  pending,
}: AddressFormViewProps) {
  const errors = state.fieldErrors ?? {};
  // After an error the form keeps what was typed.
  const value = (field: keyof AddressFormValues) => state.values?.[field] ?? initial[field];
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="next" value={next} />
      {addressId ? <input type="hidden" name="addressId" value={addressId} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="address-recipient" label="Recipient name" error={errors.recipientName} required>
          {(control) => (
            <Input
              {...control}
              name="recipientName"
              autoComplete="name"
              maxLength={120}
              defaultValue={value('recipientName')}
            />
          )}
        </Field>
        <Field
          id="address-phone"
          label="Mobile phone"
          hint="The courier calls this number, e.g. 01712-345678."
          error={errors.phone}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              defaultValue={value('phone')}
            />
          )}
        </Field>
      </div>

      {/* Keyed by the values to show, so a form re-rendered after an error starts from them. */}
      <LocationFields
        key={`${value('division')}|${value('district')}`}
        initialDivision={value('division')}
        initialDistrict={value('district')}
        errors={errors}
      />

      <Field id="address-area" label="Area, thana or upazila" error={errors.area} required>
        {(control) => (
          <Input
            {...control}
            name="area"
            autoComplete="address-level3"
            maxLength={80}
            defaultValue={value('area')}
          />
        )}
      </Field>
      <Field
        id="address-line"
        label="House, road and block"
        hint="e.g. House 12, Road 5, Block C"
        error={errors.addressLine}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="addressLine"
            autoComplete="address-line1"
            maxLength={200}
            defaultValue={value('addressLine')}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="address-postal-code" label="Postal code (optional)" error={errors.postalCode}>
          {(control) => (
            <Input
              {...control}
              name="postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={4}
              defaultValue={value('postalCode')}
            />
          )}
        </Field>
        <Field id="address-landmark" label="Nearby landmark (optional)" error={errors.landmark}>
          {(control) => (
            <Input {...control} name="landmark" maxLength={120} defaultValue={value('landmark')} />
          )}
        </Field>
      </div>

      <Field
        id="address-label"
        label="Label (optional)"
        hint="A name to recognise it by, e.g. Home or Office."
        error={errors.label}
      >
        {(control) => (
          <Input {...control} name="label" maxLength={40} defaultValue={value('label')} />
        )}
      </Field>

      {defaultChoice === 'current' ? (
        <p className="text-sm text-muted-foreground">This is your default delivery address.</p>
      ) : defaultChoice === 'first' ? (
        <p className="text-sm text-muted-foreground">
          Your first address becomes your default delivery address.
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <input
            id="address-default"
            type="checkbox"
            name="isDefault"
            value="true"
            defaultChecked={state.values?.isDefault === 'true'}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <label htmlFor="address-default" className="cursor-pointer text-sm text-foreground">
            Use as my default delivery address
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses({ variant: 'outline' })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function AddressForm({ action, ...fields }: AddressFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <AddressFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
