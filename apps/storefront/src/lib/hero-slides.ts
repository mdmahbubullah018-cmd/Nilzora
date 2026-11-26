import type { Banner } from '@nilzora/contracts';
import { colors } from '@nilzora/design-tokens';
import type { Route } from 'next';

/*
 * Home hero slides
 * ----------------
 * The hero shows the pictures an admin uploaded as `home_hero` banners and nothing else: any
 * message lives inside the artwork itself, so the banner's title is used only as the image's
 * text alternative. The API returns at most five, already ordered by the admin.
 */

export const MAX_HERO_SLIDES = 5;

export interface HeroSlide {
  id: string;
  /**
   * Text alternative for the artwork: the admin's picture description, or the heading of a
   * picture-only banner; empty when the caption beside it already says it.
   */
  alt: string;
  /** Optional words, shown in a small light panel; all null for a picture-only banner. */
  heading?: string | null;
  text?: string | null;
  ctaLabel?: string | null;
  /** A path inside the store, or null when the banner is not a link. */
  href: Route | null;
  /** Landscape artwork for tablets and larger screens. */
  desktopSrc: string;
  /**
   * Artwork for phones, when the admin uploaded one for the banner (`mobileImage`). Without it
   * phones show the landscape artwork in full.
   */
  mobileSrc: string | null;
}

/** The contract's own rule (bannerHrefSchema): a path inside the store, never another site. */
const INTERNAL_PATH = /^\/(?!\/)[A-Za-z0-9/_?=&%.~-]*$/;

function internalPath(href: string | null): Route | null {
  return href !== null && INTERNAL_PATH.test(href) ? (href as Route) : null;
}

/** Whether this payload follows the optional-text model, in which a banner's words may be shown. */
function captioned(banner: Banner): boolean {
  return banner.imageAlt !== undefined;
}

/**
 * The picture's description. A heading, when there is one, is shown in the slide's caption (and
 * names its link), so it is not repeated as the image's alternative text. Older payloads without
 * `imageAlt` fall back to the title, as before.
 */
function heroAlt(banner: Banner): string {
  const described = banner.imageAlt?.trim() ?? '';
  if (described !== '') return described;
  return banner.imageAlt === undefined ? banner.title : '';
}

/** Banners with a picture, as carousel slides. Banners without a picture are skipped. */
export function heroSlides(banners: readonly Banner[]): HeroSlide[] {
  return banners
    .flatMap((banner) =>
      banner.image === null
        ? []
        : [
            {
              id: banner.id,
              alt: heroAlt(banner),
              // Until the API sends `imageAlt` (the optional-text model) a hero was artwork only: its
              // words lived in the picture and were never drawn, so no caption is built for it.
              heading: captioned(banner) && banner.title !== '' ? banner.title : null,
              text: captioned(banner) ? banner.subtitle : null,
              // A button label only means something when the slide is a link.
              ctaLabel:
                captioned(banner) && internalPath(banner.ctaHref) !== null ? banner.ctaLabel : null,
              href: internalPath(banner.ctaHref),
              desktopSrc: banner.image.url,
              mobileSrc: banner.mobileImage?.url ?? null,
            },
          ],
    )
    .slice(0, MAX_HERO_SLIDES);
}

/*
 * DEV-ONLY SAMPLE BANNERS
 * -----------------------
 * Clearly labelled stand-in artwork so the carousel (autoplay, dots, arrows, swipe and the
 * phone/desktop art direction) can be previewed before an admin has uploaded any banner.
 * Active only under `next dev` with NILZORA_DEV_SAMPLE_BANNERS=1. A production build never
 * returns these, whatever the variable says.
 */

function sampleSvg(width: number, height: number, label: string, size: string): string {
  // On desktop the header covers about the top fifth of the banner.
  const safeTop = Math.round(height * 0.2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.navy}"/><stop offset="0.6" stop-color="${colors.slate}"/><stop offset="1" stop-color="${colors.primary}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<rect x="0" y="0" width="100%" height="${safeTop}" fill="${colors.navy}" fill-opacity="0.35"/>
<line x1="0" y1="${safeTop}" x2="${width}" y2="${safeTop}" stroke="${colors.sky}" stroke-width="3" stroke-dasharray="14 10"/>
<text x="50%" y="${safeTop - 18}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height * 0.035)}" fill="${colors.mutedSlate}">Header area: keep text out of this band</text>
<text x="50%" y="56%" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.round(width * 0.055)}" fill="${colors.softBackground}">DEV SAMPLE BANNER ${label}</text>
<text x="50%" y="66%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(width * 0.032)}" fill="${colors.sky}">${size}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function devSampleSlides(): HeroSlide[] {
  if (process.env.NODE_ENV !== 'development') return [];
  if (process.env.NILZORA_DEV_SAMPLE_BANNERS !== '1') return [];
  return [1, 2, 3].map((n) => ({
    id: `dev-sample-${n}`,
    alt: `Development sample banner ${n}`,
    href: n === 1 ? '/products' : null,
    desktopSrc: sampleSvg(1920, 640, `${n} / 3`, 'Banner artwork · 1920 × 640 (3:1)'),
    // The banner API has a single image, so the samples do too.
    mobileSrc: null,
  }));
}
