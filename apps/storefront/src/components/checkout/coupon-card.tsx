import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@nilzora/ui';
import { Tag, Ticket, X } from 'lucide-react';

/*
 * The coupon section of checkout. Applying a code reloads the page with `?coupon=CODE`,
 * so the discount is always the one the API calculated inside the quote: the browser
 * never works out an amount and never sends one. A plain GET form, so it works without
 * JavaScript, and every state has its own address.
 */

export interface CouponCardProps {
  /** The code the customer submitted, when one is in the address. */
  applied: string | undefined;
  /** The applied coupon's description, for a friendlier line. */
  description?: string | null;
  /** Why the last code did not apply, in the API's own words. */
  problem?: string | null;
  /** The checkout page itself; the form adds only the fields below. */
  actionPath: string;
  /** Values the form must keep, e.g. the chosen delivery address. */
  hidden?: Readonly<Record<string, string | undefined>>;
  /** Where "Remove" goes: this page without the code, keeping the address. */
  removeHref: string;
  /** The discount, already formatted, when a code applied. */
  discountLabel?: string | null;
  /**
   * The customer's collected vouchers that can be chosen now, each with the address that
   * applies it (the same `coupon` parameter: one voucher or one code, never both).
   */
  vouchers?: readonly { code: string; title: string; summary: string; href: string }[];
  /** True when the applied code is a collected voucher. */
  isVoucher?: boolean;
}

export function CouponCard({
  applied,
  description,
  problem,
  actionPath,
  hidden = {},
  removeHref,
  discountLabel,
  vouchers = [],
  isVoucher = false,
}: CouponCardProps) {
  const active = applied !== undefined && (problem === null || problem === undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Voucher or coupon</CardTitle>
        <p className="text-sm text-muted-foreground">Use one voucher or one coupon code on this order.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-green-900">
              {isVoucher ? (
                <Ticket aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <Tag aria-hidden="true" className="size-4 shrink-0" />
              )}
              <span className={isVoucher ? '' : 'font-mono'}>{isVoucher ? 'Voucher applied' : applied}</span>
              {description ? <span className="font-normal">— {description}</span> : null}
            </p>
            <span className="flex items-center gap-3">
              {discountLabel ? (
                <span className="font-semibold text-green-900 tabular-nums">{discountLabel}</span>
              ) : null}
              <a
                href={removeHref}
                className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-green-900 underline underline-offset-4"
              >
                <X aria-hidden="true" className="size-3.5" />
                Remove
              </a>
            </span>
          </div>
        ) : null}

        {problem !== null && problem !== undefined ? (
          <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {problem}
          </p>
        ) : null}

        {vouchers.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium text-foreground">Your vouchers</p>
            <ul className="grid gap-2">
              {vouchers.map((voucher) => {
                const chosen = active && applied === voucher.code;
                return (
                  <li key={voucher.code}>
                    <a
                      href={voucher.href}
                      aria-current={chosen ? 'true' : undefined}
                      className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${chosen ? 'border-primary bg-sky-50' : 'border-border hover:border-primary'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Ticket aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{voucher.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{voucher.summary}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-primary">{chosen ? 'Applied' : 'Use'}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">Or enter a coupon code instead:</p>
          </div>
        ) : null}

        <form action={actionPath} method="get" className="flex flex-wrap items-end gap-2">
          {Object.entries(hidden).map(([name, value]) =>
            value === undefined ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}
          <label htmlFor="checkout-coupon" className="sr-only">
            Coupon code
          </label>
          <Input
            id="checkout-coupon"
            name="coupon"
            defaultValue={isVoucher ? '' : (applied ?? '')}
            placeholder="Enter a code"
            maxLength={32}
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full max-w-52 font-mono uppercase"
          />
          <Button type="submit" variant="outline">
            {active ? 'Update' : 'Apply'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
