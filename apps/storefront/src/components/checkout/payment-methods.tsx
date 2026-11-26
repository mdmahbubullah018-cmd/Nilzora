'use client';

import { PAYMENT_METHODS, type PaymentMethodId } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Banknote, Smartphone, Wallet, type LucideIcon } from 'lucide-react';

/*
 * The payment step of the checkout.
 *
 * Cash on delivery is the only method that works, and it is the only one that can be chosen.
 * bKash and Nagad are shown, in their own brand colours, with a "Coming soon" badge and a
 * disabled control: there is no gateway behind them, so no customer can select one, and the
 * order function refuses anything that is not cash anyway. The radios carry no form name, so
 * nothing here is submitted: the order API still accepts only a cash order.
 */

const ICONS: Record<PaymentMethodId, LucideIcon> = {
  cod: Banknote,
  bkash: Wallet,
  nagad: Smartphone,
};

/** Each brand's own colour, used for its tile and badge only. */
const BRAND: Record<PaymentMethodId, string> = {
  cod: 'var(--nz-color-primary)',
  bkash: '#E2136E',
  nagad: '#EE1C25',
};

export function PaymentMethods({ codAvailable }: { codAvailable: boolean }) {
  const methods = PAYMENT_METHODS;
  const unavailable = methods.every(
    (method) => method.status !== 'available' || (method.id === 'cod' && !codAvailable),
  );

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">Payment method</legend>
      <ul role="list" className="grid gap-2">
        {methods.map((method) => {
          const selectable = method.status === 'available' && (method.id !== 'cod' || codAvailable);
          const Icon = ICONS[method.id];
          return (
            <li key={method.id}>
              <label
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 transition-colors',
                  selectable
                    ? 'cursor-pointer border-primary/40 bg-primary/4'
                    : 'border-border/70 bg-surface-muted/40',
                )}
              >
                <input
                  type="radio"
                  name="payment-method-choice"
                  value={method.id}
                  defaultChecked={method.id === 'cod' && codAvailable}
                  disabled={!selectable}
                  aria-describedby={`pay-${method.id}-note`}
                  className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                />
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    color: BRAND[method.id],
                    backgroundColor: `color-mix(in srgb, ${BRAND[method.id]} 10%, transparent)`,
                  }}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{method.label}</span>
                    {method.status === 'available' ? (
                      codAvailable ? (
                        <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                          Available
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          Off
                        </span>
                      )
                    ) : (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{
                          color: BRAND[method.id],
                          backgroundColor: `color-mix(in srgb, ${BRAND[method.id]} 12%, transparent)`,
                        }}
                      >
                        {method.badge ?? 'Coming soon'}
                      </span>
                    )}
                  </span>
                  <span id={`pay-${method.id}-note`} className="text-xs text-muted-foreground">
                    {method.status === 'available'
                      ? method.description
                      : `${method.description} Not available yet.`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {unavailable ? (
        <p className="text-xs text-danger">
          No payment method is available right now, so orders cannot be placed.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          bKash and Nagad are coming soon. Until then every order is paid in cash on delivery.
        </p>
      )}
    </fieldset>
  );
}
