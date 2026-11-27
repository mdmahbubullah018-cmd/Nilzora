'use client';

import { PAYMENT_METHODS } from '@nilzora/contracts';
import { Alert, Button, cn } from '@nilzora/ui';
import { Banknote, Check } from 'lucide-react';
import { useActionState, useState } from 'react';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import type { ActionState } from '@/components/admin-kit/act';
import { saveCodAvailabilityAction } from '@/lib/settings-actions';
import { AutoText } from '@/components/i18n/translate';

/*
 * The payment step, as the store controls it.
 *
 * Only cash on delivery has a switch: it is the only method with a real integration behind it.
 * bKash and Nagad are listed with a "Coming soon" badge and no control at all, so no setting
 * can switch on a payment that cannot take money yet.
 */

const IDLE: ActionState = { status: 'idle' };

export function PaymentMethodsForm({ codEnabled, csrf }: { codEnabled: boolean; csrf: CsrfInput }) {
  const [state, action, pending] = useActionState(saveCodAvailabilityAction, IDLE);
  const [enabled, setEnabled] = useState(codEnabled);

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="codEnabled" value={enabled ? 'on' : 'off'} />

      <ul role="list" className="grid gap-2">
        <li>
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
              enabled ? 'border-info-line bg-info-soft/40' : 'border-hairline bg-surface',
            )}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              className="mt-0.5 size-5 accent-primary-action"
              aria-describedby="cod-note"
            />
            <span className="grid gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Banknote aria-hidden="true" className="size-4 text-primary" strokeWidth={1.75} />
                <span className="font-semibold text-foreground">
                  <AutoText>Cash on Delivery</AutoText>
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    enabled
                      ? 'bg-success/15 text-success'
                      : 'bg-surface-muted text-muted-foreground',
                  )}
                >
                  {enabled ? 'Available' : 'Off'}
                </span>
              </span>
              <span id="cod-note" className="text-sm text-muted-foreground">
                Customers pay the courier when the parcel arrives. Turning this off closes checkout:
                the order function refuses a cash order until it is on again.
              </span>
            </span>
          </label>
        </li>
        {PAYMENT_METHODS.filter((method) => method.status === 'coming_soon').map((method) => (
          <li
            key={method.id}
            className="flex items-start gap-3 rounded-xl border border-dashed border-hairline bg-surface-muted/40 p-4"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 place-items-center rounded border border-hairline text-muted-foreground"
            >
              <Check className="size-3 opacity-0" />
            </span>
            <span className="grid gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">
                  <AutoText value={method.label} />
                </span>
                <span className="rounded-full bg-brand-violet/12 px-2 py-0.5 text-[11px] font-semibold text-brand-violet">
                  <AutoText>Coming soon</AutoText>
                </span>
              </span>
              <span className="text-sm text-muted-foreground">
                {method.description} There is no switch for it until the payment integration exists,
                so it can never be switched on by accident.
              </span>
            </span>
          </li>
        ))}
      </ul>

      {state.status !== 'idle' && state.message ? (
        <Alert tone={state.status === 'success' ? 'success' : 'danger'}>
          <span aria-live="polite">
            <AutoText value={state.message} />
          </span>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={pending}>
          <AutoText>Save payment methods</AutoText>
        </Button>
      </div>
    </form>
  );
}
