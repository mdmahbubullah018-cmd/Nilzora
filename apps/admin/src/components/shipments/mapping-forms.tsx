'use client';

import { COURIER_PROVIDER_IDS, type CourierLocationMapping } from '@nilzora/contracts';
import { Button, Field, Input, NativeSelect } from '@nilzora/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { deleteLocationMappingAction, saveLocationMappingAction } from '@/lib/courier-actions';
import { providerName } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

interface DestinationRow {
  id: number;
  key: string;
  value: string;
}

function rowsOf(destination: Record<string, unknown> | undefined): DestinationRow[] {
  const entries = Object.entries(destination ?? {}).filter(
    ([, value]) => typeof value === 'string' || typeof value === 'number',
  );
  const rows = entries.map(([key, value], index) => ({ id: index, key, value: String(value) }));
  return rows.length > 0 ? rows : [{ id: 0, key: '', value: '' }];
}

export interface MappingFormProps {
  csrf: CsrfInput;
  /** Every Bangladesh district, for the district choice. */
  districts: readonly string[];
  /** Editing keeps courier, district and area (they identify the mapping). */
  mapping?: CourierLocationMapping;
}

/**
 * Adds or edits the courier's own location (e.g. Pathao city, zone and area ids) for a
 * district, or one area of it. The fields follow the courier's API; names start with a
 * lower-case letter (cityId, zoneId) and whole numbers are sent as numbers.
 */
export function MappingForm({ csrf, districts, mapping }: MappingFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(saveLocationMappingAction, IDLE_STATE);
  const [rows, setRows] = useState<DestinationRow[]>(() => rowsOf(mapping?.destination));
  const [nextId, setNextId] = useState(rows.length);
  const scope = mapping?.id ?? 'new';
  const id = (name: string) => `mapping-${scope}-${name}`;
  const editing = Boolean(mapping);

  return (
    <form
      action={action}
      className="grid gap-3"
      aria-label={editing ? 'Edit location mapping' : 'Add a location mapping'}
    >
      <CsrfField csrf={csrf} />
      {mapping ? (
        <>
          <input type="hidden" name="provider" value={mapping.provider} />
          <input type="hidden" name="district" value={mapping.district} />
          <input type="hidden" name="area" value={mapping.area} />
        </>
      ) : null}
      {editing ? null : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id={id('provider')}
            label={tx('Courier')}
            error={state.fieldErrors?.provider}
            required
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="provider"
                defaultValue={state.values?.provider ?? COURIER_PROVIDER_IDS[0]}
              >
                {COURIER_PROVIDER_IDS.map((provider) => (
                  <option key={provider} value={provider}>
                    {providerName(provider)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id={id('district')}
            label={tx('District')}
            error={state.fieldErrors?.district}
            required
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="district"
                defaultValue={state.values?.district ?? ''}
              >
                <option value="" disabled>
                  <AutoText>Choose a district</AutoText>
                </option>
                {districts.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id={id('area')}
            label={tx('Area')}
            hint={tx('Optional. Empty: the whole district.')}
            error={state.fieldErrors?.area}
          >
            {(control) => (
              <Input {...control} name="area" maxLength={80} defaultValue={state.values?.area} />
            )}
          </Field>
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          <AutoText>Courier location</AutoText>
        </legend>
        <p className="text-xs text-muted-foreground">
          The ids the courier’s API expects, e.g.{' '}
          <span className="font-mono">
            <AutoText>cityId</AutoText>
          </span>
          ,{' '}
          <span className="font-mono">
            <AutoText>zoneId</AutoText>
          </span>
          ,{' '}
          <span className="font-mono">
            <AutoText>areaId</AutoText>
          </span>
          . Up to 12 fields.
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
                <AutoText>Field</AutoText>
              </label>
              <Input
                id={id(`key-${String(row.id)}`)}
                name="destKey"
                value={row.key}
                maxLength={41}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
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
                name="destValue"
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
              aria-label={`Remove field ${row.key || 'row'}`}
              disabled={rows.length === 1}
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
          disabled={rows.length >= 12}
          onClick={() => {
            setRows((current) => [...current, { id: nextId, key: '', value: '' }]);
            setNextId(nextId + 1);
          }}
        >
          <Plus aria-hidden="true" />
          <AutoText>Add a field</AutoText>
        </Button>
        {state.fieldErrors?.destination ? (
          <p role="alert" className="text-xs font-medium text-danger-ink">
            {state.fieldErrors.destination}
          </p>
        ) : null}
      </fieldset>

      <Field
        id={id('label')}
        label={tx('Label')}
        hint={tx('Optional, e.g. “Dhaka › Mirpur”.')}
        error={state.fieldErrors?.label}
      >
        {(control) => (
          <Input
            {...control}
            name="label"
            maxLength={160}
            defaultValue={state.values?.label ?? mapping?.label ?? ''}
          />
        )}
      </Field>
      <SubmitButton size="sm" className="w-fit" pendingLabel="Saving…">
        {editing ? 'Save mapping' : 'Add mapping'}
      </SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** Removes a mapping after confirmation. */
export function DeleteMappingForm({
  mapping,
  csrf,
}: {
  mapping: CourierLocationMapping;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(deleteLocationMappingAction, IDLE_STATE);
  const place = mapping.area ? `${mapping.area}, ${mapping.district}` : mapping.district;
  return (
    <div className="grid gap-1">
      <ConfirmForm
        action={action}
        csrf={csrf}
        trigger={
          <>
            <Trash2 aria-hidden="true" />
            <span className="sr-only">
              Remove the {providerName(mapping.provider)} mapping for {place}
            </span>
          </>
        }
        title={`Remove the ${providerName(mapping.provider)} location for ${place}?`}
        description={tx(
          'Bookings to this place will need the courier location again (or fall back to a district-wide mapping).',
        )}
        confirmLabel={tx('Remove mapping')}
        hiddenFields={{ mappingId: mapping.id }}
        error={state.status === 'error' ? state.message : undefined}
      />
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}
