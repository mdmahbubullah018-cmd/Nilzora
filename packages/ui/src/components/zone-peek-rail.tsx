import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/*
 * The Shopping Zone row: compact collection banners across the visible width, with a deliberate
 * slice of the next one showing at the right edge.
 *
 * The composition is the point. Two full banners carry the message on a phone; from a laptop
 * three fit side by side, which is what keeps the section a slim band instead of a wall of
 * posters. The peeking slice says "there are more collections" without a scroll hint nobody
 * reads. One geometry rule makes that true at every width: a card is its share of what is left
 * after the gaps and the peek.
 *
 * Both numbers are fixed here rather than in each caller, so the storefront, the admin preview
 * and any later surface cannot drift apart. The row scrolls sideways with snap points, so a
 * swipe lands on a banner rather than between two; overflow is contained by the row itself.
 */

const GAP_CLASS = 'gap-3 sm:gap-4 lg:gap-5';
/**
 * Half the row (less two gaps and a 2.25rem peek) on a phone, and a third of it (less three
 * gaps and a 3.5rem peek) from `lg`, where three banners share the width. With only one or two
 * collections there is nothing to peek at, so from `lg` they take half the row each and the
 * section does not leave a lone tile stranded in empty space.
 */
const MOBILE_CARD = 'w-[calc((100%_-_1.5rem_-_2.25rem)/2)]';
const THREE_UP = `${MOBILE_CARD} sm:w-[calc((100%_-_2rem_-_2.75rem)/2)] lg:w-[calc((100%_-_2.5rem_-_3.5rem)/3)]`;
const TWO_UP = `${MOBILE_CARD} lg:w-[calc((100%_-_1.25rem)/2)]`;

export interface ZonePeekItem {
  /** Stable key for the banner (a zone id, or any unique string in a preview). */
  key: string;
  content: ReactNode;
}

/**
 * One wide collection banner per view, like the app's carousel: the whole row less a slice of
 * the next banner (2.25rem on a phone, 4rem from `lg`) so the peek still says "there are more".
 * A single collection takes the full row.
 */
const BANNER = 'w-[calc(100%_-_2.25rem_-_0.75rem)] sm:w-[calc(100%_-_2.75rem_-_1rem)]';
/** From `lg` the banners sit two to a row (one gap between them), with no peek. */
const BANNER_DESKTOP = 'lg:w-[calc((100%_-_1.25rem)/2)]';

export function ZonePeekRail({
  items,
  label,
  className,
  variant = 'peek',
}: {
  items: readonly ZonePeekItem[];
  /** What the row holds, for a screen reader ("collections"). */
  label: string;
  className?: string;
  /**
   * `peek` (default): compact cards, two on a phone and three from `lg` (the admin preview).
   * `banner`: one wide banner per view with the next one peeking (the storefront, matching the app).
   */
  variant?: 'peek' | 'banner';
}) {
  if (items.length === 0) return null;
  const cardWidth =
    variant === 'banner'
      ? items.length === 1
        ? 'w-full'
        : `${BANNER} ${BANNER_DESKTOP}`
      : items.length >= 3
        ? THREE_UP
        : TWO_UP;
  return (
    <ul
      aria-label={label}
      className={cn(
        // Bleeds to the page edge so the peek is not cut by the container's padding, then pads
        // the first banner back into line with the section heading.
        '-mx-4 flex snap-x snap-mandatory overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0',
        GAP_CLASS,
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.key} className={cn(cardWidth, 'shrink-0 snap-start')}>
          {item.content}
        </li>
      ))}
    </ul>
  );
}
