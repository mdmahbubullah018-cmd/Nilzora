import { cn } from '@nilzora/ui';
import { createElement } from 'react';
import {
  CookingPot,
  Footprints,
  Headphones,
  Package,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Watch,
  type LucideIcon,
} from 'lucide-react';

/*
 * The branded placeholder tile: an icon for the product's category on a soft surface.
 * It stands in wherever there is no product picture (none uploaded yet, a failed load,
 * or a cart/order line whose data carries no picture; see product-image.tsx). It is
 * decorative; the product name is always shown as text nearby.
 */

const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'home-kitchen': CookingPot,
  fashion: Shirt,
  electronics: Headphones,
  'beauty-care': Sparkles,
  groceries: ShoppingBasket,
};

/** Categories not in the table get an icon from the words in their slug. */
const KEYWORD_ICONS: readonly (readonly [RegExp, LucideIcon])[] = [
  [/shoe|footwear|sneaker|sandal|boot/, Footprints],
  [/watch/, Watch],
  [/bag|accessor|belt|wallet/, ShoppingBag],
  [/beauty|skin|cosmetic|serum|care|makeup|fragrance/, Sparkles],
  [/fashion|cloth|wear|shirt|dress|panjabi|kameez|burqa|apparel/, Shirt],
  [/kitchen|home/, CookingPot],
  [/electron|phone|gadget|audio/, Headphones],
  [/grocer|food/, ShoppingBasket],
];

export function categoryIcon(categorySlug: string | null | undefined): LucideIcon {
  if (!categorySlug) return Package;
  if (Object.hasOwn(CATEGORY_ICONS, categorySlug)) return CATEGORY_ICONS[categorySlug] ?? Package;
  return KEYWORD_ICONS.find(([pattern]) => pattern.test(categorySlug))?.[1] ?? Package;
}

const sizes = {
  sm: { box: 'size-16 rounded-md', icon: 'size-6' },
  md: { box: 'aspect-square w-full rounded-lg', icon: 'size-12' },
  lg: { box: 'aspect-square w-full rounded-xl', icon: 'size-20' },
} as const;

export interface ProductVisualProps {
  categorySlug?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}

export function ProductVisual({ categorySlug, size = 'md', className }: ProductVisualProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center bg-surface-muted text-brand-slate ring-1 ring-border ring-inset',
        sizes[size].box,
        className,
      )}
    >
      {/* The icon comes from a fixed table; createElement keeps it a plain lookup. */}
      {createElement(categoryIcon(categorySlug), {
        className: cn('text-primary/70', sizes[size].icon),
        strokeWidth: 1.5,
      })}
    </div>
  );
}
