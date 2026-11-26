import type { Brand } from '@nilzora/contracts';
import { BrandTile } from '@/components/merchandising';
import { ScrollRail } from './scroll-rail';

/** Ten brands in one row, five in view at a time; the full directory is one link away. */
export const SHELF_BRANDS = 10;

/**
 * Brands on the storefront home page: one row of bare logos, four across from `lg` and a
 * swipeable rail on smaller screens.
 *
 * Nothing is drawn around the artwork: the brand's own logo is contained in a square area and
 * the name sits under it in plain type — the same restraint the category row beside it keeps for
 * its covers. The brand's banner is never used here. A phone shows two whole brands and a
 * narrow sliver of the third (about 3% of the screen) so the row reads as continuing, and the
 * full directory is one link away.
 *
 * Every visible brand is eligible, including one with no products yet: a brand is created and
 * switched on in the admin workspace, and shoppers see it on the next revalidation instead of
 * waiting for its first product. Brands with something on sale come first, so the shelf still
 * leads with what can be bought, and the rest follow in name order.
 */
export function BrandShelf({ brands }: { brands: readonly Brand[] }) {
  const ordered = [...brands]
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name))
    .slice(0, SHELF_BRANDS);
  if (ordered.length === 0) return null;
  return (
    <ScrollRail
      label="brands"
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:mx-0 lg:px-0"
    >
      {ordered.map((brand) => (
        <li
          key={brand.slug}
          // Two whole brands fill the row's content width and the third shows about a fifth of
          // itself: 2.2 cards plus the row's own gaps is the width, so the row reads as
          // continuing without hiding what is next. From `lg` the four fit and nothing scrolls.
          className="w-[calc((100%-1.5rem)/2.2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/2.2)] lg:w-[calc((100%-3rem)/4)]"
        >
          <BrandTile brand={brand} compact />
        </li>
      ))}
    </ScrollRail>
  );
}
