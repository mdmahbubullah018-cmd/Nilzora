import { Badge, cn } from '@nilzora/ui';
import { formatMoney } from '@/lib/format';

/** Whole-percent saving against the former price, or null when there is none. */
export function savingPercent(
  priceMinor: number,
  compareAtPriceMinor: number | null,
): number | null {
  if (compareAtPriceMinor === null || compareAtPriceMinor <= priceMinor) return null;
  const percent = Math.floor(((compareAtPriceMinor - priceMinor) / compareAtPriceMinor) * 100);
  return percent >= 1 ? percent : null;
}

const sizes = {
  sm: { price: 'text-base', former: 'text-xs' },
  md: { price: 'text-lg', former: 'text-sm' },
  lg: { price: 'text-3xl', former: 'text-base' },
} as const;

export interface PriceProps {
  priceMinor: number;
  compareAtPriceMinor?: number | null;
  size?: keyof typeof sizes;
  /** Show the offer badge ("Save 18%") next to the price. */
  showSaving?: boolean;
  className?: string;
}

/** A selling price from the API, with the former price struck through when higher. */
export function Price({
  priceMinor,
  compareAtPriceMinor = null,
  size = 'md',
  showSaving = false,
  className,
}: PriceProps) {
  const saving = savingPercent(priceMinor, compareAtPriceMinor);
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <span
        className={cn('font-display font-semibold text-foreground tabular-nums', sizes[size].price)}
      >
        <span className="sr-only">Price: </span>
        {formatMoney(priceMinor)}
      </span>
      {saving !== null && compareAtPriceMinor !== null ? (
        <>
          <span
            className={cn('text-muted-foreground tabular-nums line-through', sizes[size].former)}
          >
            <span className="sr-only">Was </span>
            {formatMoney(compareAtPriceMinor)}
          </span>
          {showSaving ? <Badge tone="offer">Save {saving}%</Badge> : null}
        </>
      ) : null}
    </p>
  );
}
