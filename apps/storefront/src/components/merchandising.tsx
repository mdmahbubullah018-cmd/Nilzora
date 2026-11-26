import type { Banner, Brand } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { ArrowRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { brandHref } from '@/lib/catalog-query';
import { BrandMark } from './catalog/brand-mark';
import { productCountLabel } from './catalog/categories';
import {
  BANNER_CAPTION,
  BANNER_CTA,
  BANNER_HEADING,
  BANNER_SUBTEXT,
} from './marketing/banner-treatment';
import { ScrollRail } from './marketing/scroll-rail';

/*
 * Promotional banners and brand presentation. Banners and brands come from the API; the
 * database decides which banners are on show. Pictures are already-resized WebP from
 * the media service, so a plain <img> is used, lazily below the fold.
 */

/** A brand's logo tile (client-side, so a logo that fails to load can fall back to initials). */
export { BrandMark };

/**
 * A brand's tile: its logo in a contained band (never cropped or stretched, so a wide wordmark
 * and a square emblem carry the same weight) and its real product count. A brand with no logo
 * shows its initials in the same area.
 *
 * `compact` is the home page's shelf: the logo takes the whole card face instead of sitting in a
 * padded band, the description is dropped and the name is a step smaller, so five tiles share a
 * row without any of them looking cramped. The directory page keeps the roomier tile.
 *
 * No shadow on either: a hairline border separates the tile from the page.
 */
export function BrandTile({ brand, compact = false }: { brand: Brand; compact?: boolean }) {
  const count = productCountLabel(brand.productCount);
  if (compact) {
    // The home shelf's card follows the category cards beside it: a rounded, clipped surface
    // that holds its own highlight (nothing spills past the card), a contained logo that is a
    // little smaller than the card, then the name and the real product count, centred. No
    // border, no second panel and no shadow: the artwork is the content.
    return (
      <Link
        href={brandHref(brand.slug)}
        aria-label={`${brand.name}, ${count}`}
        className="group relative flex h-full flex-col items-center gap-1 overflow-hidden rounded-2xl px-2 pt-2 pb-2 text-center transition-colors duration-200 hover:bg-brand-soft/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
      >
        <span className="block w-[78%] shrink-0">
          <span className="relative block aspect-square w-full">
            <BrandMark
              brand={brand}
              shape="band"
              className="absolute inset-0 size-full transition-transform duration-300 ease-soft group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          </span>
        </span>
        <span className="w-full min-w-0">
          <span className="line-clamp-1 text-[0.8125rem] font-semibold text-foreground transition-colors duration-200 group-hover:text-primary">
            {brand.name}
          </span>
        </span>
        <span className="text-[0.6875rem] text-muted-foreground">{count}</span>
      </Link>
    );
  }

  // The directory tile: a proper card in the All Categories idiom — its mark inside the card,
  // then the name and the real product count beneath it, all inside the card's own boundary.
  return (
    <Link
      href={brandHref(brand.slug)}
      aria-label={`${brand.name}, ${count}`}
      className="group flex h-full flex-col items-center gap-2 overflow-hidden rounded-2xl border border-border/80 bg-surface p-3 text-center transition-colors duration-200 hover:border-primary/40 sm:p-4"
    >
      <span className="relative block aspect-4/3 w-full overflow-hidden">
        <BrandMark
          brand={brand}
          shape="band"
          className="absolute inset-0 size-full transition-transform duration-500 ease-soft group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </span>
      <span className="w-full min-w-0">
        <span className="line-clamp-2 text-sm font-semibold wrap-break-word text-foreground underline-offset-4 transition-colors duration-200 group-hover:text-primary group-hover:underline">
          {brand.name}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </Link>
  );
}

/** A grid of brand tiles for the brand directory; each tile is one link named by the brand. */
export function BrandGrid({ brands }: { brands: readonly Brand[] }) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {brands.map((brand) => (
        <li key={brand.slug}>
          <BrandTile brand={brand} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The picture's text alternative. The admin's description when there is one; otherwise the
 * heading for a picture-only banner, and nothing when the caption next to it already says it.
 */
export function bannerPictureAlt(
  banner: Pick<Banner, 'title' | 'imageAlt'>,
  hasWords: boolean,
): string {
  const described = banner.imageAlt?.trim() ?? '';
  if (described !== '') return described;
  return hasWords ? '' : banner.title;
}

/** The contract's own rule (bannerHrefSchema): a path inside the store, never another site. */
const INTERNAL_PATH = /^\/(?!\/)[A-Za-z0-9/_?=&%.~-]*$/;

/** A banner's destination, or null when it is not a link the store can open. */
function bannerHref(banner: Banner): Route | null {
  return banner.ctaHref !== null && INTERNAL_PATH.test(banner.ctaHref)
    ? (banner.ctaHref as Route)
    : null;
}

/**
 * The promotion strip: every campaign banner in one horizontally scrolling row.
 *
 * - One row at every width and never a second line: a phone sees one banner at a time (the next
 *   one peeking in, as the app does), and a tablet or desktop sees two full banners with the
 *   third showing a slice at the right edge. Anything beyond that one swipe — or one arrow —
 *   away.
 * - The frame is 12:5 at every width — the same shape the mobile app uses for the same banner —
 *   so a banner reads as a strip rather than a poster at every size and the picture keeps its
 *   proportions inside it: nothing is stretched. A phone-shaped picture, when the admin uploaded
 *   one, replaces the wide one on a small screen.
 * - A banner's words sit on the artwork itself, in a ~96% transparent container: the picture
 *   stays the subject and no solid panel is ever drawn over it.
 * - Every part of a banner is optional. A banner with no picture is a tinted card with its
 *   words; a banner with nothing but a picture is just the picture.
 * - Only a banner with a destination the store can open is a link; the rest is plain content,
 *   so nothing invites a tap that goes nowhere.
 * - No shadow: a hairline border separates the card from the page. The one movement on touch or
 *   hover is the picture easing in a fraction, and only when motion is welcome.
 */
export function CampaignBanners({ banners }: { banners: readonly Banner[] }) {
  if (banners.length === 0) return null;
  // One banner fills the row; a shop with only one has it span the row instead of leaving a gap.
  const solo = banners.length === 1;
  return (
    <section
      aria-label="Promotions"
      // The promo row follows the trusted band (and, on a phone, its store marks) directly:
      // 16px of breathing room instead of a whole empty band above the first card.
      className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8"
    >
      <ScrollRail
        label="promotions"
        // One row that scrolls sideways: the whole row on a phone, two banners wide from `sm`
        // (each half the row less half a gap), so a third waits to the right and is reached by
        // swiping or by the arrows. `snap-x` plus `snap-start` settles a swipe on a card.
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:gap-6 lg:px-0"
      >
        {banners.map((banner) => {
          const href = bannerHref(banner);
          const hasWords =
            banner.title !== '' || banner.subtitle !== null || banner.ctaLabel !== null;
          const card = (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface transition-colors duration-200 group-hover/banner:border-primary/40">
              {banner.image === null ? (
                hasWords ? (
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    {banner.title === '' ? null : (
                      <p className="line-clamp-2 font-display text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        {banner.title}
                      </p>
                    )}
                    {banner.subtitle === null ? null : (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {banner.subtitle}
                      </p>
                    )}
                    {banner.ctaLabel === null ? null : (
                      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-link">
                        {banner.ctaLabel}
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </span>
                    )}
                  </div>
                ) : null
              ) : (
                <div className="relative aspect-12/5 w-full overflow-hidden bg-brand-navy">
                  <picture>
                    {banner.mobileImage ? (
                      <source media="(max-width: 639px)" srcSet={banner.mobileImage.url} />
                    ) : null}
                    <img
                      src={banner.image.url}
                      alt={bannerPictureAlt(banner, hasWords)}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-soft group-hover/banner:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/banner:scale-100"
                    />
                  </picture>
                  {hasWords ? (
                    <div
                      className={cn(BANNER_CAPTION, 'absolute inset-x-0 bottom-0 rounded-b-2xl')}
                    >
                      <div className="grid min-w-0 gap-0.5">
                        {banner.title === '' ? null : (
                          <p className={BANNER_HEADING}>{banner.title}</p>
                        )}
                        {banner.subtitle === null ? null : (
                          <p className={BANNER_SUBTEXT}>{banner.subtitle}</p>
                        )}
                      </div>
                      {banner.ctaLabel === null ? null : (
                        <span className={BANNER_CTA}>
                          {banner.ctaLabel}
                          <ArrowRight aria-hidden="true" className="size-4" />
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );

          return (
            <li
              key={banner.id}
              // A phone shows one banner with the next peeking in. From `sm` two banners fill the
              // row and a slice of the third shows at the right edge: the divisor is a little
              // smaller there than from `lg` because a tablet row's own end padding makes the
              // visible slice wider, so the same divisor would show a quarter of a card instead
              // of the fifth that says "there is more" without shrinking the two that matter.
              className={cn(
                'group/banner shrink-0 snap-start',
                solo
                  ? 'w-full'
                  : 'w-[88%] sm:w-[calc((100%-2rem)/2.11)] lg:w-[calc((100%-3rem)/2.18)]',
              )}
            >
              {href === null ? (
                card
              ) : (
                <Link href={href} className="block h-full rounded-2xl">
                  {card}
                </Link>
              )}
            </li>
          );
        })}
      </ScrollRail>
    </section>
  );
}

/**
 * A short strip at the top of a category listing: secondary to the products, never a full hero.
 *
 * - The picture is a wide, shallow band with nothing opaque painted over it; a banner's words
 *   sit on the artwork in the same ~96% transparent container the other placements use.
 * - Words are optional. With no picture, the banner is a light tinted card with its words.
 * - A picture-only banner is just the picture (a link when it has a destination).
 */
export function CategoryBanner({ banner }: { banner: Banner }) {
  const hasWords = banner.title !== '' || banner.subtitle !== null || banner.ctaLabel !== null;
  const href = bannerHref(banner);
  const pictured = banner.image !== null;
  // On a pictured strip the whole band is the link, so the label is only a label.
  const button =
    banner.ctaLabel === null ? null : pictured ? (
      <span className={BANNER_CTA}>
        {banner.ctaLabel}
        <ArrowRight aria-hidden="true" className="size-4" />
      </span>
    ) : href === null ? (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-action px-4 py-2 text-sm font-semibold text-primary-action-foreground">
        {banner.ctaLabel}
      </span>
    ) : (
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-action px-4 py-2 text-sm font-semibold text-primary-action-foreground transition-colors hover:bg-primary-action-hover"
      >
        {banner.ctaLabel}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    );
  const words = hasWords ? (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <div className="grid max-w-2xl min-w-0 gap-0.5">
        {banner.title === '' ? null : (
          <p className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {banner.title}
          </p>
        )}
        {banner.subtitle ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{banner.subtitle}</p>
        ) : null}
      </div>
      {button}
    </div>
  ) : null;

  const picture = banner.image ? (
    <div className="relative aspect-3/1 w-full overflow-hidden bg-brand-soft sm:aspect-6/1">
      {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
      <img
        src={banner.image.url}
        alt={bannerPictureAlt(banner, hasWords)}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      {hasWords ? (
        <div className={cn(BANNER_CAPTION, 'absolute inset-x-0 bottom-0 rounded-b-none')}>
          <div className="grid min-w-0 gap-0.5">
            {banner.title === '' ? null : <p className={BANNER_HEADING}>{banner.title}</p>}
            {banner.subtitle ? <p className={BANNER_SUBTEXT}>{banner.subtitle}</p> : null}
          </div>
          {button}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <aside
      aria-label="Category offer"
      className={cn(
        'overflow-hidden rounded-2xl border border-border/80',
        picture ? 'bg-surface' : 'bg-brand-soft',
      )}
    >
      {/* A pictured strip with a destination is itself the link, words included. */}
      {picture && href !== null ? (
        <Link href={href} className="block">
          {picture}
        </Link>
      ) : (
        picture
      )}
      {/* Words on a pictured banner are drawn on the artwork, so only a picture-less banner
          shows them in their own row. */}
      {picture ? null : words}
    </aside>
  );
}
