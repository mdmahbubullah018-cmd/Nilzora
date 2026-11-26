import { BRAND_INTRINSIC, type BrandTone } from '../brand';
import { cn } from '../lib/cn';

/*
 * The official Nilzora lockup and mark, from assets/brand.
 *
 * These render the supplied artwork itself — never a redrawn or typographic approximation —
 * as a background image (see the `.nz-brand-*` rules in styles.css) so that exactly one tone
 * is downloaded and the tone can follow the theme with no JavaScript and no flash. The admin
 * sets `[data-theme]` from the visitor's saved preference, so a logo without `tone` switches
 * with the theme; `tone="dark"` pins the navy-surface artwork for a surface that stays navy.
 *
 * Sizes are the picture's height in pixels; the width follows the artwork's own aspect ratio,
 * so nothing is ever stretched.
 */

const sizes = {
  sm: 28,
  md: 36,
  lg: 48,
} as const;

export type LogoSize = keyof typeof sizes;
export type LogoTone = BrandTone;

export interface LogoMarkProps {
  size?: LogoSize;
  /** `dark` for a navy or dark surface; `light` for a white one; omit to follow the theme. */
  tone?: LogoTone;
  className?: string;
  /** Set when the mark sits next to visible brand text, so it is not announced twice. */
  decorative?: boolean;
}

/** The square app mark on its own. */
export function LogoMark({ size = 'md', tone = 'auto', className, decorative }: LogoMarkProps) {
  return (
    <span
      className={cn('nz-brand-mark', className)}
      style={{ height: sizes[size] }}
      data-tone={tone === 'auto' ? undefined : tone}
      data-brand-mark=""
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Nilzora'}
      aria-hidden={decorative ? true : undefined}
    />
  );
}

export interface LogoProps {
  size?: LogoSize;
  tone?: LogoTone;
  className?: string;
  /** Set when a surrounding link or heading already names the store. */
  decorative?: boolean;
}

/** The full lockup: the mark beside the "Nilzora" wordmark, exactly as supplied. */
export function Logo({ size = 'md', tone = 'auto', className, decorative = false }: LogoProps) {
  return (
    <span
      className={cn('nz-brand-logo', className)}
      style={{
        height: sizes[size],
        width: (sizes[size] * BRAND_INTRINSIC.logo.width) / BRAND_INTRINSIC.logo.height,
      }}
      data-tone={tone === 'auto' ? undefined : tone}
      data-brand-logo=""
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Nilzora'}
      aria-hidden={decorative ? true : undefined}
    />
  );
}
