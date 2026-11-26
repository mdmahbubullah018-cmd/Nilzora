import type { AdminOrderCoupon, OrderPreviewItem } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { TicketPercent } from 'lucide-react';
import { ProductTile } from '@/components/catalog/product-tile';
import { formatMoney, plural } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';
import { VariantOptions } from './variant-options';

/*
 * What an order holds, as the order list shows it: the first line's picture (the one the
 * customer saw when ordering), its name, its options and quantity, and how much more the
 * order holds. Pictures are decorative: every line's name is written beside it.
 */

/** "Size: M / Colour: Navy · × 2", or just the quantity for a simple product. */
export function lineDetail(line: Pick<OrderPreviewItem, 'variantLabel' | 'quantity'>): string {
  return line.variantLabel ? `${line.variantLabel} · × ${String(line.quantity)}` : `× ${String(line.quantity)}`;
}

export function OrderLinesPreview({
  preview,
  itemCount,
  className,
}: {
  preview: readonly OrderPreviewItem[];
  /** Units in the whole order (the preview holds at most three lines). */
  itemCount: number;
  className?: string;
}) {
  const [first, ...rest] = preview;
  if (!first) {
    return <span className="text-sm text-muted-foreground"><CountText count={itemCount} one="item" /></span>;
  }
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div className="relative shrink-0">
        <ProductTile image={first.image} size="md" />
        {rest.length > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-brand-navy text-[0.65rem] font-semibold text-white ring-2 ring-surface"
          >
            +{rest.length}
          </span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-0.5">
        {/* Names wrap to two lines (cells never wrap on their own), so a table row stays narrow. */}
        <span
          className="line-clamp-2 max-w-52 text-sm leading-snug font-medium whitespace-normal text-foreground"
          title={first.productName}
        >
          {first.productName}
        </span>
        <VariantOptions options={first.variantOptions} label={first.variantLabel} />
        <span className="text-xs text-muted-foreground">× {String(first.quantity)}</span>
        <span className="text-xs text-muted-foreground">
          {rest.length > 0
            ? `and ${plural(rest.length, 'more line')} · ${plural(itemCount, 'item')}`
            : plural(itemCount, 'item')}
        </span>
      </div>
    </div>
  );
}

/** The order's discount and the coupon or voucher behind it, as a small line. */
export function OrderDiscountNote({
  discountMinor,
  coupon,
  className,
}: {
  discountMinor: number;
  coupon: AdminOrderCoupon | null;
  className?: string;
}) {
  if (discountMinor <= 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-success-ink', className)}>
      <TicketPercent aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span>
        −{formatMoney(discountMinor)}
        {coupon ? (
          <>
            {' '}
            <span className="font-mono"><AutoText value={coupon.code} /></span>
          </>
        ) : null}
      </span>
    </span>
  );
}
