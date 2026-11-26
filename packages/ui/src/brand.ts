/*
 * The one place the official Nilzora artwork is named.
 *
 * The files themselves live in `assets/brand` (the originals, never edited) and are copied,
 * trimmed of empty margin only, into each web app's `public/brand` and the app's
 * `assets/brand`; `assets/brand/build-app-assets.ps1` does that copying and builds the Android
 * icons from the same originals. This module names the copies so no component ever spells a
 * path out by hand.
 *
 * Two tones, because the artwork is drawn for two surfaces:
 *   light  navy mark, navy "Nil", blue "zora"   - white and light surfaces
 *   dark   sky mark, off-white "Nil", sky "zora" - navy and other dark surfaces
 */

export const BRAND_ASSETS = {
  logoOnLight: '/brand/nilzora-logo-on-light.png',
  logoOnDark: '/brand/nilzora-logo-on-dark.png',
  markNavy: '/brand/nilzora-mark-navy.png',
  markSky: '/brand/nilzora-mark-sky.png',
} as const;

export type BrandAssetName = keyof typeof BRAND_ASSETS;

/** The intrinsic size of the trimmed artwork, so callers can reserve space and avoid layout shift. */
export const BRAND_INTRINSIC = {
  logo: { width: 1023, height: 243 },
  mark: { width: 725, height: 724 },
} as const;

/** Which surface an asset is drawn for. `auto` follows the theme. */
export type BrandTone = 'auto' | 'light' | 'dark';

/** The full lockup for a surface that does not change with the theme. */
export function brandLogoPath(tone: 'light' | 'dark'): string {
  return tone === 'dark' ? BRAND_ASSETS.logoOnDark : BRAND_ASSETS.logoOnLight;
}

/** The square mark for a surface that does not change with the theme. */
export function brandMarkPath(tone: 'light' | 'dark'): string {
  return tone === 'dark' ? BRAND_ASSETS.markSky : BRAND_ASSETS.markNavy;
}
