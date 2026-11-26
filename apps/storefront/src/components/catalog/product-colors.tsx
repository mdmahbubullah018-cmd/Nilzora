import type { ProductSummary } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';

/*
 * The colours a product is sold in, inside its card.
 *
 * Purely a preview: no button, no link, no handler. The card's own stretched link covers the
 * whole card, so the dots must not be focusable or clickable — the product page is where a
 * colour is chosen. A colour is drawn as a small disc with a hairline edge so white and the
 * palest shades stay visible, and anything past the fourth becomes a "+N" count.
 */

/** The most discs a card shows before the rest are summarised. */
const MAX_SWATCHES = 4;

export function ProductColors({
  colors,
  className,
}: {
  colors: ProductSummary['colors'];
  className?: string;
}) {
  if (colors === undefined || colors.length < 2) return null;
  const shown = colors.slice(0, MAX_SWATCHES);
  const rest = colors.length - shown.length;
  return (
    <p
      className={cn('flex items-center gap-1.5', className)}
      // One clear phrase for a screen reader; the discs themselves say nothing.
      aria-label={`Available in ${String(colors.length)} colours: ${colors
        .map((color) => color.value)
        .join(', ')}`}
    >
      {shown.map((color) => (
        <span
          key={color.valueSlug}
          aria-hidden="true"
          // 16px, fully round, one crisp 1px edge. No opacity, no shadow and no transform, so
          // the disc keeps hard edges at any device pixel ratio; the edge is what keeps white
          // and the palest shades visible on a white card.
          className="block size-4 shrink-0 rounded-full border border-border-strong"
          style={{ backgroundColor: color.swatchHex }}
        />
      ))}
      {rest > 0 ? (
        <span aria-hidden="true" className="text-[0.6875rem] font-semibold leading-none text-muted-foreground">
          +{rest}
        </span>
      ) : null}
    </p>
  );
}
