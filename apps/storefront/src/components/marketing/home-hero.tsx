import type { HeroSlide } from '@/lib/hero-slides';
import { HeroCarousel } from './hero-carousel';
import { HeroFallback } from './hero-fallback';

/*
 * Banner frame
 * ------------
 * The banner model has one landscape image (the API keeps it at most 1600px on its long side;
 * there is no separate phone image), so one picture has to serve every screen. The frame is
 * sized before anything loads (no layout shift), and the recommended 3:1 upload (1920 x 640)
 * fits each size with little cropping (object-cover, centred):
 *
 *   phones   12:5,  inset below the header     shows the central ~80% of the width
 *   tablets  10:3,  inset below the header     the whole picture
 *   desktop  var(--nz-hero-h), under the header  ~13% trimmed top/bottom full width
 *
 * Every frame is deliberately wider than it is tall: the banner is a wide, horizontal strip, not
 * a tall poster. The phone frame still leaves room under the artwork for the benefits panel,
 * which tucks a few pixels into the bottom edge instead of sitting in a gap below it.
 */
const TILE =
  // Phones (below 768px): the banner runs edge to edge, square and without the stage's ring.
  'relative overflow-hidden rounded-xl ring-1 ring-white/10 aspect-[12/5] max-md:rounded-none max-md:ring-0 md:aspect-[10/3] md:rounded-2xl lg:aspect-auto lg:h-(--nz-hero-h)';

/**
 * The top of the home page: the admin's banners (or the fallback) on a navy stage that starts at
 * the very top of the page, under the transparent header. The stage ends at the banner's own
 * bottom edge (no bottom padding), so the benefits panel that follows can tuck a few pixels into
 * the artwork instead of sitting in a gap below it.
 *
 * The banner takes the whole stage: the app download lives in the header popover, under the
 * trusted band on a phone, and in the footer, so the artwork is never narrowed to make room for
 * a second column of promotion.
 */
export function HomeHero({ slides }: { slides: readonly HeroSlide[] }) {
  const fallback = <HeroFallback />;

  return (
    // The navy stage is for tablets and desktops; on a phone the banner sits straight on the page.
    <div className="relative isolate -mt-(--nz-header-h) bg-brand-navy max-md:bg-transparent">
      <div className="mx-auto grid max-w-(--nz-stage-max) gap-(--nz-stage-gap) px-(--nz-stage-pad) pt-(--nz-header-h) pb-0 max-md:px-0 lg:pt-(--nz-stage-pad) lg:pb-0">
        <div className={TILE}>
          {slides.length > 0 ? <HeroCarousel slides={slides} fallback={fallback} /> : fallback}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[calc(var(--nz-header-h)*1.6)] bg-linear-to-b from-brand-navy/60 via-brand-navy/20 to-transparent lg:block"
      />
    </div>
  );
}
