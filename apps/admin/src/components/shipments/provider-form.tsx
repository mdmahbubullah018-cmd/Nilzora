'use client';

import type { CourierProvider } from '@nilzora/contracts';
import { Button, Field, Input } from '@nilzora/ui';
import { Plug, Plus, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { checkCourierAction, saveCourierProviderAction } from '@/lib/courier-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

interface SettingRow {
  id: number;
  key: string;
  value: string;
}

function settingRows(settings: CourierProvider['settings']): SettingRow[] {
  return Object.entries(settings).map(([key, value], index) => ({
    id: index,
    key,
    value: value === null ? '' : String(value),
  }));
}

/**
 * A courier's switch, its non-secret settings (e.g. a Pathao store id), and the figures
 * internal estimates use (couriers.configure). Credentials are never typed or shown here:
 * they live only in the API's environment.
 */
export function ProviderForm({ provider, csrf }: { provider: CourierProvider; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveCourierProviderAction, IDLE_STATE);
  const [enabled, setEnabled] = useState(provider.isEnabled);
  const [rows, setRows] = useState<SettingRow[]>(() => settingRows(provider.settings));
  const [nextId, setNextId] = useState(rows.length);
  const id = (name: string) => `${provider.provider}-${name}`;

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="provider" value={provider.provider} />
      <label className="flex items-start gap-3 rounded-xl border border-hairline p-3 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          className="mt-0.5 size-5 accent-primary-action"
        />
        <span className="grid gap-0.5">
          <span className="font-semibold text-foreground">
            <AutoText>Enabled for real bookings</AutoText>
          </span>
          <span className="text-xs text-muted-foreground">
            Test-mode bookings do not need this. Real calls also need verified API documentation and
            server credentials.
          </span>
        </span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          <AutoText>Settings</AutoText>
        </legend>
        <p className="text-xs text-muted-foreground">
          Non-secret values only, such as a store id. Credentials are set on the server, never here;
          names that look like credentials are refused.
        </p>
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
          >
            <div className="grid gap-1">
              <label
                htmlFor={id(`key-${String(row.id)}`)}
                className="text-xs text-muted-foreground"
              >
                <AutoText>Name</AutoText>
              </label>
              <Input
                id={id(`key-${String(row.id)}`)}
                name="settingKey"
                value={row.key}
                maxLength={41}
                autoComplete="off"
                onChange={(event) => {
                  const key = event.currentTarget.value;
                  setRows((current) => current.map((r) => (r.id === row.id ? { ...r, key } : r)));
                }}
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor={id(`value-${String(row.id)}`)}
                className="text-xs text-muted-foreground"
              >
                <AutoText>Value</AutoText>
              </label>
              <Input
                id={id(`value-${String(row.id)}`)}
                name="settingValue"
                value={row.value}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRows((current) => current.map((r) => (r.id === row.id ? { ...r, value } : r)));
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove setting ${row.key || 'row'}`}
              onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            setRows((current) => [...current, { id: nextId, key: '', value: '' }]);
            setNextId(nextId + 1);
          }}
        >
          <Plus aria-hidden="true" />
          <AutoText>Add a setting</AutoText>
        </Button>
        {state.fieldErrors?.settings ? (
          <p role="alert" className="text-xs font-medium text-danger-ink">
            {state.fieldErrors.settings}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={id('cod-fee')}
          label={tx('COD fee (%)')}
          hint={tx('Of the cash collected, for internal estimates. Empty: unknown.')}
          error={state.fieldErrors?.codFee}
        >
          {(control) => (
            <Input
              {...control}
              name="codFee"
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              defaultValue={
                state.values?.codFee ??
                (provider.codFeeBp === null ? '' : String(provider.codFeeBp / 100))
              }
            />
          )}
        </Field>
        <Field
          id={id('return-charge')}
          label={tx('Return charge (৳)')}
          hint={tx('What the courier charges for a returned parcel. Empty: unknown.')}
          error={state.fieldErrors?.returnCharge}
        >
          {(control) => (
            <Input
              {...control}
              name="returnCharge"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={
                state.values?.returnCharge ??
                (provider.returnChargeMinor === null
                  ? ''
                  : String(provider.returnChargeMinor / 100))
              }
            />
          )}
        </Field>
      </div>
      <SubmitButton className="w-fit" pendingLabel="Saving…">
        Save {provider.displayName}
      </SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** Checks the connection: the test courier in test mode, a read-only call where verified. */
export function CheckConnectionForm({ provider, csrf }: { provider: string; csrf: CsrfInput }) {
  const [state, action] = useActionState(checkCourierAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton variant="outline" size="sm" className="w-fit" pendingLabel="Checking…">
        <Plug aria-hidden="true" />
        <AutoText>Check connection</AutoText>
      </SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}
