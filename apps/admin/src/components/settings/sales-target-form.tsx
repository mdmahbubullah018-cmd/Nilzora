'use client';

import { Button, Field, Input } from '@nilzora/ui';
import { Target } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { setSalesTargetAction } from '@/lib/settings-actions';
import { useTx } from '@/lib/i18n/provider';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending} className="rounded-xl max-sm:min-h-11">
      {pending ? null : <Target aria-hidden="true" strokeWidth={1.75} />}
      Save target
    </Button>
  );
}

export interface SalesTargetFormProps {
  /** The current target in poisha; null when none is set, undefined when it could not be read. */
  targetMinor: number | null | undefined;
  csrf: CsrfInput;
}

/** The monthly revenue target in taka; empty clears it. Validated here and by the API. */
export function SalesTargetForm({ targetMinor, csrf }: SalesTargetFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(setSalesTargetAction, IDLE_STATE);
  const current = targetMinor === null || targetMinor === undefined ? '' : String(targetMinor / 100);
  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      <div className="flex flex-wrap items-end gap-3">
        <Field
          id="sales-target"
          label={tx("Monthly revenue target (৳)")}
          hint={tx("Leave empty to remove the target from the dashboard.")}
          error={state.fieldErrors?.target}
          className="w-full max-w-64"
        >
          {(control) => (
            <Input
              {...control}
              name="target"
              type="number"
              min={0}
              max={1_000_000_000}
              step="0.01"
              inputMode="decimal"
              placeholder={tx("e.g. 500000")}
              defaultValue={state.values?.target ?? current}
              className="tabular-nums max-sm:h-11"
            />
          )}
        </Field>
        <SaveButton />
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
