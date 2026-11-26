'use client';

import { buttonClasses, CartGlyph } from '@nilzora/ui';
import Link from 'next/link';
import { useCartCount } from '@/components/cart/use-cart-count';
import { countLabel } from '@/lib/count-label';

/*
 * The header's cart link. The unit count itself comes from useCartCount, which the mobile
 * tab bar shares, so both show the same number from the same request.
 */

export function cartLabel(count: number | null): string {
  if (count === null) return 'Cart';
  return `Cart, ${count} ${count === 1 ? 'item' : 'items'}`;
}

export function CartLink({
  className = buttonClasses({ variant: 'ghost', size: 'icon', className: 'relative' }),
}: {
  /** The link's own classes; must keep it `relative` for the count badge. */
  className?: string;
} = {}) {
  const count = useCartCount();
  const shown = countLabel(count);
  return (
    <Link href="/cart" aria-label={cartLabel(count)} className={className}>
      {/*
        The cart takes the same two-tone logic as the logo: white over the navy banner (the
        header's transparent state), the brand's primary blue on the frosted light bar. The
        header publishes that state as `data-solid`, so no colour is hard-coded here and the
        icon follows the bar wherever it is used.
      */}
      <CartGlyph size={22} className="group-data-[solid=true]/header:text-primary" />
      {shown ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary-action px-1 text-[0.6875rem] leading-none font-semibold text-primary-action-foreground tabular-nums ring-2 ring-background"
        >
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
