import { cn } from '@nilzora/ui';
import { BrandGlyph } from '@/components/brand/social-icons';
import { appStoreUrl, playStoreUrl, type AppDownloadLinks } from '@/lib/app-links';

/*
 * Store download options
 * ----------------------
 * Each option is the platform's own mark beside the wording every store badge uses — "GET IT ON
 * / Google Play", "Download on the / App Store" — so it is recognised at a glance.
 *
 * The wording is rendered as text rather than as the published badge artwork on purpose: both
 * official badges are opaque black plates, and these options sit on a translucent strip, in the
 * footer's navy sheet and inside the header's glass popover. The marks themselves are the brands'
 * own shapes (see `brand/social-icons`), drawn in the surface's colour, never redrawn or distorted.
 *
 * Only the platforms the store actually published are rendered, so a visitor is never shown an
 * option that leads nowhere — and with neither listing there is nothing at all to show.
 */

const PLAY = {
  key: 'googlePlay',
  glyph: 'googlePlay',
  kicker: 'GET IT ON',
  store: 'Google Play',
} as const;

const APPLE = {
  key: 'appStore',
  glyph: 'apple',
  kicker: 'Download on the',
  store: 'App Store',
} as const;

export interface StoreOption {
  key: 'googlePlay' | 'appStore';
  glyph: 'googlePlay' | 'apple';
  kicker: string;
  store: string;
  /** The full phrase, which is also what a screen reader announces for the link. */
  label: string;
  href: string;
}

/** The options the store actually published, Android first, each with its validated link. */
export function publishedBadges(links: AppDownloadLinks): StoreOption[] {
  const options: StoreOption[] = [];
  const play = playStoreUrl(links.googlePlayUrl);
  if (play !== null) {
    options.push({
      ...PLAY,
      label: 'Get it on Google Play',
      href: play,
    });
  }
  const apple = appStoreUrl(links.appStoreUrl);
  if (apple !== null) {
    options.push({
      ...APPLE,
      label: 'Download on the App Store',
      href: apple,
    });
  }
  return options;
}

/** Two sizes: the trusted strip and the footer share the small one; the popover is larger. */
const SIZES = {
  sm: {
    link: 'gap-1.5 py-0.5',
    mark: 'size-4',
    kicker: 'text-[0.5rem]',
    store: 'text-[0.6875rem]',
  },
  md: { link: 'gap-2 py-1', mark: 'size-5', kicker: 'text-[0.5625rem]', store: 'text-sm' },
} as const;

export type StoreBadgeSize = keyof typeof SIZES;

/** `light` for the page's own surface, `dark` for the navy footer. */
export type StoreBadgeTone = 'light' | 'dark';

/**
 * One store option: the platform mark and its familiar two-line wording.
 *
 * The whole thing is the link — the mark is not a separate target — so a tap anywhere on it goes
 * to the same listing, and the accessible name is the full phrase rather than two disjoint words.
 */
export function StoreBadgeOption({
  option,
  size = 'sm',
  tone = 'light',
}: {
  option: StoreOption;
  size?: StoreBadgeSize;
  tone?: StoreBadgeTone;
}) {
  const scale = SIZES[size];
  return (
    <a
      href={option.href}
      target="_blank"
      rel="noopener noreferrer"
      // The two lines would run together in the accessible name ("Download on theApp Store"),
      // so the link is named by the phrase a person reads across both of them.
      aria-label={`${option.label} (opens in a new tab)`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current motion-reduce:transition-none',
        scale.link,
        tone === 'light' ? 'text-primary' : 'text-white',
      )}
    >
      <BrandGlyph name={option.glyph} className={cn('shrink-0', scale.mark)} />
      <span className="grid text-left leading-none whitespace-nowrap">
        <span className={cn('font-medium tracking-wide opacity-80', scale.kicker)}>
          {option.kicker}
        </span>
        <span className={cn('font-semibold', scale.store)}>{option.store}</span>
      </span>
    </a>
  );
}

/** The published options as a row of links, with no plate behind any of them. */
export function StoreBadgeOptions({
  links,
  size = 'sm',
  tone = 'light',
  className,
}: {
  links: AppDownloadLinks;
  size?: StoreBadgeSize;
  tone?: StoreBadgeTone;
  className?: string;
}) {
  const options = publishedBadges(links);
  if (options.length === 0) return null;
  return (
    <ul role="list" className={cn('flex items-center gap-2.5 sm:gap-3', className)}>
      {options.map((option) => (
        <li key={option.key} className="min-w-0">
          <StoreBadgeOption option={option} size={size} tone={tone} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The phone/tablet strip under the trusted section.
 *
 * One line, left to right: the heading, then one option per published store. A translucent sheet
 * that echoes the trusted strip above it — the same restrained blur, a hairline edge, no opaque
 * fill — so the two read as one block rather than as a banner bolted underneath.
 *
 * It never wraps: the wording is small and the gaps tighten on a narrow phone, which is what
 * keeps 360px inside the viewport without a horizontal scrollbar.
 */
export function AppDownloadStrip({
  links,
  className,
}: {
  links: AppDownloadLinks;
  className?: string;
}) {
  const options = publishedBadges(links);
  if (options.length === 0) return null;
  return (
    <section
      aria-label="Download the Nilzora apps"
      className={cn('mx-auto w-full max-w-6xl px-3 max-md:px-1.5 sm:px-6 lg:px-8', className)}
    >
      <div className="flex flex-nowrap items-center justify-center gap-x-2 rounded-xl border border-white/70 bg-white/55 px-2.5 py-1.5 max-md:rounded-lg shadow-sm shadow-brand-navy/5 backdrop-blur-md sm:gap-x-5 sm:px-4">
        <p className="text-[0.625rem] leading-tight font-semibold whitespace-nowrap text-foreground sm:text-xs">
          Download the Nilzora Apps
        </p>
        {options.map((option) => (
          <StoreBadgeOption key={option.key} option={option} size="sm" />
        ))}
      </div>
    </section>
  );
}
