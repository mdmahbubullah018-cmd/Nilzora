'use client';

import type { DeliveryZone } from '@nilzora/contracts';
import { Button, Field, Input } from '@nilzora/ui';
import { Save } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { setDeliveryChargeAction } from '@/lib/settings-actions';

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending} className="rounded-xl max-sm:min-h-11">
      {pending ? null : <Save aria-hidden="true" strokeWidth={1.75} />}
      Save
      {/* Names which charge, for screen-reader users moving between the two buttons. */}
      <span className="sr-only">{` ${label.charAt(0).toLowerCase()}${label.slice(1)} charge`}</span>
    </Button>
  );
}

export interface DeliveryChargeFormProps {
  zone: DeliveryZone;
  label: string;
  /** The current charge in poisha; null while it is not set. */
  amountMinor: number | null;
  csrf: CsrfInput;
}

/** One zone's charge in taka, validated here and again by the API. */
export function DeliveryChargeForm({ zone, label, amountMinor, csrf }: DeliveryChargeFormProps) {
  const [state, action] = useActionState(setDeliveryChargeAction, IDLE_STATE);
  const current = amountMinor === null ? '' : String(amountMinor / 100);
  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="zone" value={zone} />
      <div className="flex flex-wrap items-end gap-3">
        <Field
          id={`charge-${zone}`}
          label={`${label} charge (৳)`}
          error={state.fieldErrors?.amount}
          className="w-full max-w-48"
          required
        >
          {(control) => (
            <Input
              {...control}
              name="amount"
              type="number"
              min={0}
              max={100000}
              step="0.01"
              inputMode="decimal"
              defaultValue={state.values?.amount ?? current}
              className="tabular-nums max-sm:h-11"
            />
          )}
        </Field>
        <SaveButton label={label} />
      </div>
      <ActionFeedback state={state} inline />
    </form>
  );
}
