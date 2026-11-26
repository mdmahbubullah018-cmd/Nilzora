import type { Category } from '@nilzora/contracts';
import { CategoryCard } from '@/components/catalog/categories';
import { ScrollRail } from './scroll-rail';

/** Six departments in one row, with the full directory one link away. */
export const SHOWCASE_CATEGORIES = 6;

/**
 * The home page's departments, as picture cards in ONE row at every width: a snap-scrolling
 * rail on phones (three whole cards plus a narrow sliver of the fourth, so the row reads as
 * continuing) and the full six across from `lg`. Cards keep one shape throughout — the cover
 * fills the card and the name sits on its lower edge — and never wrap onto a second line.
 *
 * The rail bleeds to the screen edge on phones so a swipe starts under the thumb, exactly as
 * the product rail does; from `lg` the six fit, so it is a plain row with no scrolling.
 *
 * The category directory page keeps its own four-across tiles; this row is the home page's.
 */
export function CategoryShowcase({ categories }: { categories: readonly Category[] }) {
  const shown = categories.slice(0, SHOWCASE_CATEGORIES);
  if (shown.length === 0) return null;
  return (
    <ScrollRail
      label="categories"
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:gap-3 sm:px-6 lg:mx-0 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {shown.map((category) => (
        <li
          key={category.slug}
          // Three whole cards fill a phone's row; subtracting 26px instead of the row's three
          // 10px gaps lets each card sit a little wider, so the fourth shows as a ~12px sliver
          // (~3% of the screen) rather than disappearing under the rail's end padding.
          className="w-[calc((100%-1.625rem)/3)] shrink-0 snap-start sm:w-[calc((100%-3rem)/5)] lg:w-[calc((100%-5rem)/6)]"
        >
          <CategoryCard
            category={category}
            ratio="aspect-[4/5] sm:aspect-[5/4]"
            compact
            className="h-full"
          />
        </li>
      ))}
    </ScrollRail>
  );
}
