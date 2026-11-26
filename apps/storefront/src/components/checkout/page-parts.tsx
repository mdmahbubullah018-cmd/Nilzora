import { cn } from '@nilzora/ui';
import { ChevronLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * Layout pieces shared by the cart, checkout, address and order pages, so they line
 * up with the account page and each other.
 */

const widths = { md: 'max-w-5xl', lg: 'max-w-7xl' } as const;

export function PageFrame({
  width = 'md',
  children,
}: {
  width?: keyof typeof widths;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto grid gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14', widths[width])}>
      {children}
    </div>
  );
}

/** Inline text link in the storefront's link colour. */
export const textLinkClasses =
  'rounded-sm font-semibold text-link underline-offset-4 hover:underline';

/** "Back to …" link above a page header. */
export function BackLink<T extends string>({
  href,
  children,
}: {
  href: Route<T>;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 justify-self-start rounded-sm text-sm font-medium text-link underline-offset-4 hover:underline"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}

/** A list of label/amount pairs, such as an order summary. */
export function SummaryList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-3 text-sm', className)}>{children}</dl>;
}

export function SummaryRow({
  label,
  children,
  total = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** The final amount: set apart and larger. */
  total?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4',
        total && 'border-t border-border pt-3',
      )}
    >
      <dt className={total ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{label}</dt>
      <dd
        className={cn(
          'text-right text-foreground tabular-nums',
          total ? 'font-display text-lg font-semibold' : 'font-medium',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** The small numbered badge that leads a checkout section's title. */
export function StepBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="mr-2.5 inline-grid size-6 place-items-center rounded-full bg-primary/10 align-middle text-xs font-bold text-primary"
    >
      {n}
    </span>
  );
}

/** Cart → Checkout → Confirmation: where the customer is, in three quiet steps. */
export function CheckoutProgress() {
  const steps = ['Cart', 'Checkout', 'Confirmation'];
  return (
    <ol aria-label="Order progress" className="flex items-center gap-2 text-xs font-medium">
      {steps.map((label, index) => {
        const state = index === 0 ? 'done' : index === 1 ? 'current' : 'next';
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
                state === 'current' && 'bg-primary text-white',
                state === 'done' && 'bg-primary/10 text-primary',
                state === 'next' && 'text-muted-foreground',
              )}
            >
              {index + 1}
              <span>{label}</span>
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="h-px w-4 bg-border sm:w-8" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** "1 item", "3 items". */
export function itemCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}
