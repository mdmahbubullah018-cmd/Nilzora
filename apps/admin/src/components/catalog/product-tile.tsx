import { LOW_STOCK_THRESHOLD, type ProductImage } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  CookingPot,
  Headphones,
  Package,
  Shirt,
  ShoppingBasket,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { StockBadge, stockLevel } from '@/components/admin-kit/status-badge';
import { formatCount } from '@/lib/format';

/*
 * A product's primary picture when it has one; otherwise the same calm tile as the
 * storefront: the category's icon on a soft surface. It is decorative; the product name
 * is always written next to it.
 */

const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'home-kitchen': CookingPot,
  fashion: Shirt,
  electronics: Headphones,
  'beauty-care': Sparkles,
  groceries: ShoppingBasket,
};

export function categoryIcon(categorySlug: string | null | undefined): LucideIcon {
  if (!categorySlug || !Object.hasOwn(CATEGORY_ICONS, categorySlug)) return Package;
  return CATEGORY_ICONS[categorySlug] ?? Package;
}

const tileSizes = {
  sm: { box: 'size-10 rounded-md', icon: 'size-5' },
  md: { box: 'size-14 rounded-lg', icon: 'size-6' },
  lg: { box: 'size-20 rounded-xl', icon: 'size-9' },
} as const;

export function ProductTile({
  categorySlug,
  image,
  size = 'sm',
  className,
}: {
  categorySlug?: string | null;
  /** The product's primary picture, when it has one. */
  image?: Pick<ProductImage, 'thumbUrl'> | null | undefined;
  size?: keyof typeof tileSizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden bg-surface-muted ring-1 ring-border ring-inset',
        tileSizes[size].box,
        className,
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time
        <img
          src={image.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        // The icon comes from a fixed table; createElement keeps it a plain lookup.
        createElement(categoryIcon(categorySlug), {
          className: cn('text-primary/70', tileSizes[size].icon),
          strokeWidth: 1.5,
        })
      )}
    </span>
  );
}

/** The quantity a full stock bar stands for: well clear of the low-stock threshold. */
export const STOCK_BAR_FULL = LOW_STOCK_THRESHOLD * 4;

const barTones = { out: 'bg-danger', low: 'bg-warning', in: 'bg-success' } as const;

/** How full the stock bar is, 0 to 100. */
export function stockBarPercent(quantity: number): number {
  if (quantity <= 0) return 0;
  return Math.max(4, Math.min(100, (quantity / STOCK_BAR_FULL) * 100));
}

/**
 * A stock level: the exact units, a bar (decorative) and the band as a badge, so the
 * level reads in words and numbers, never colour alone.
 */
export function StockMeter({
  quantity,
  showBadge = true,
  className,
}: {
  quantity: number;
  showBadge?: boolean;
  className?: string;
}) {
  const level = stockLevel(quantity);
  return (
    <div className={cn('grid min-w-32 gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            level === 'in' ? 'text-foreground' : 'text-body',
          )}
        >
          {formatCount(quantity)}
          <span className="font-normal text-muted-foreground">
            {quantity === 1 ? ' unit' : ' units'}
          </span>
        </span>
        {showBadge ? <StockBadge quantity={quantity} /> : null}
      </div>
      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <span
          className={cn('block h-full rounded-full', barTones[level])}
          style={{ width: `${String(stockBarPercent(quantity))}%` }}
        />
      </span>
    </div>
  );
}
