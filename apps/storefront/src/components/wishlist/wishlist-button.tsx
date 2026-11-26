'use client';

import { cn } from '@nilzora/ui';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import { useWishlistOptional, type WishlistTarget } from './wishlist-provider';

/**
 * The heart that saves a product.
 *
 * It is a real button with an accessible name that says what pressing it will do, and the
 * saved state is announced (`aria-pressed`) so a screen reader hears the change. The fill
 * animation is a short, restrained pop that respects reduced-motion. When no provider is
 * mounted (a page rendered outside the shop layout), the heart is simply not shown rather
 * than pretending it worked.
 */
export function WishlistButton({
  product,
  className,
  size = 'sm',
}: {
  product: WishlistTarget & { name: string };
  className?: string;
  /** `sm` sits on a product card; `md` on the product page. */
  size?: 'sm' | 'md';
}) {
  const wishlist = useWishlistOptional();
  const [popped, setPopped] = useState(false);
  if (wishlist === undefined) return null;

  const saved = wishlist.has(product);
  const busy = wishlist.busy(product.id);
  const box = size === 'md' ? 'size-10' : 'size-9';
  const icon = size === 'md' ? 'size-5' : 'size-[1.15rem]';

  return (
    <button
      type="button"
      // z-10 keeps the heart above the card's full-surface link overlay.
      className={cn(
        'relative z-10 inline-flex touch-manipulation items-center justify-center rounded-full',
        'bg-surface/90 text-body shadow-sm ring-1 ring-border/70 backdrop-blur',
        'transition-[color,background-color,box-shadow,scale] duration-200 ease-soft',
        'hover:text-primary hover:ring-primary/40 active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        saved && 'text-offer ring-offer/30',
        busy && 'opacity-70',
        box,
        className,
      )}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${product.name} from your wishlist` : `Save ${product.name} to your wishlist`}
      disabled={busy}
      onClick={() => {
        if (!saved) setPopped(true);
        void wishlist.toggle(product).finally(() => setPopped(false));
      }}
    >
      <Heart
        aria-hidden="true"
        className={cn(
          icon,
          'transition-transform duration-200 ease-soft',
          saved ? 'fill-current' : 'fill-none',
          popped && 'scale-125',
          'motion-reduce:transition-none motion-reduce:scale-100',
        )}
        strokeWidth={saved ? 2 : 1.75}
      />
    </button>
  );
}
