import { BRAND_ASSETS, BRAND_INTRINSIC, cn } from '@nilzora/ui';
import Image from 'next/image';

/*
 * The official Nilzora artwork, rendered through next/image so the storefront serves a
 * correctly sized, optimised copy instead of the 1023 px original.
 *
 * The file paths come from @nilzora/ui's brand module — the one place the official artwork is
 * named — and the files themselves are byte-identical copies of assets/brand in public/brand,
 * with only the empty transparent margin trimmed:
 *
 *   on-light: navy mark, "Nil" navy, "zora" blue    - white or light surfaces
 *   on-dark:  sky mark, "Nil" off-white, "zora" sky  - navy surfaces and banners
 *
 * The storefront is a light-mode site: it never sets [data-theme], so light surfaces use the
 * light artwork and only the navy hero overlay and the footer use the dark-surface one.
 */

export type LogoSurface = 'on-light' | 'on-dark';

const LOGO: Record<LogoSurface, string> = {
  'on-light': BRAND_ASSETS.logoOnLight,
  'on-dark': BRAND_ASSETS.logoOnDark,
};

const MARK = {
  navy: BRAND_ASSETS.markNavy,
  sky: BRAND_ASSETS.markSky,
} as const;

export interface NilzoraLogoProps {
  surface?: LogoSurface;
  className?: string;
  /** Empty alt text when the surrounding link or heading already names the brand. */
  decorative?: boolean;
  /** Load immediately (above the fold), instead of lazily. */
  priority?: boolean;
}

/** Full logo: mark plus "Nilzora" wordmark. Size it with a height class, e.g. `h-8`. */
export function NilzoraLogo({
  surface = 'on-light',
  className,
  decorative = false,
  priority = false,
}: NilzoraLogoProps) {
  return (
    <Image
      src={LOGO[surface]}
      width={BRAND_INTRINSIC.logo.width}
      height={BRAND_INTRINSIC.logo.height}
      alt={decorative ? '' : 'Nilzora'}
      loading={priority ? 'eager' : 'lazy'}
      sizes="180px"
      className={cn('h-8 w-auto select-none', className)}
    />
  );
}

export interface NilzoraMarkProps {
  tone?: keyof typeof MARK;
  className?: string;
  decorative?: boolean;
  /** Load immediately: only for a mark at the top of the page. */
  priority?: boolean;
}

/** The square app mark on its own. Size it with a `size-*` class. */
export function NilzoraMark({
  tone = 'navy',
  className,
  decorative = true,
  priority = false,
}: NilzoraMarkProps) {
  return (
    <Image
      src={MARK[tone]}
      width={256}
      height={256}
      alt={decorative ? '' : 'Nilzora'}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      sizes="96px"
      className={cn('size-12 select-none', className)}
    />
  );
}
