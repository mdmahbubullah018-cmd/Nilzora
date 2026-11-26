import { Image, StyleSheet, View } from 'react-native';

/*
 * The official Nilzora lockup, from assets/brand.
 *
 * The files in assets/brand are byte-identical to the ones the two web apps serve (only the
 * empty transparent margin is trimmed), and `assets/brand/build-app-assets.ps1` also builds the
 * launcher icon, splash and notification artwork from the same originals — so the phone, the
 * storefront and the admin show one logo, not three approximations.
 *
 * The app is a light-mode product (`userInterfaceStyle: "light"` in app.json), so it uses the
 * light-surface artwork (navy mark, navy "Nil", blue "zora") everywhere. Nothing here is
 * stretched: the height is fixed and the width follows the artwork's own aspect ratio, which is
 * read from the bundled file, so a re-exported image cannot distort the logo.
 */

const artwork = {
  light: require('../../assets/brand/nilzora-logo-on-light.png') as number,
  dark: require('../../assets/brand/nilzora-logo-on-dark.png') as number,
} as const;

/** The square app mark on its own, for a small slot such as a conversation avatar. */
const marks = {
  navy: require('../../assets/brand/nilzora-mark-navy.png') as number,
  sky: require('../../assets/brand/nilzora-mark-sky.png') as number,
} as const;

/** The trimmed artwork's size, matching assets/brand (1023 x 243). */
const RATIO = 1023 / 243;

const sizes = {
  sm: 22,
  md: 30,
  lg: 40,
} as const;

export type LogoSize = keyof typeof sizes;
/** `light` for the app's white and soft-grey surfaces, `dark` for the navy brand panels. */
export type LogoSurface = keyof typeof artwork;

export interface LogoProps {
  size?: LogoSize;
  /** The artwork for the surface behind it; a navy panel needs the on-dark file. */
  surface?: LogoSurface;
  /** Set when a surrounding heading already names the store, so it is not announced twice. */
  decorative?: boolean;
}

/** Mark plus the "Nilzora" wordmark, exactly as supplied. */
export function Logo({ size = 'md', surface = 'light', decorative = false }: LogoProps) {
  const height = sizes[size];
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : 'Nilzora'}
      aria-hidden={decorative ? true : undefined}
      style={styles.wrapper}
      testID="brand-logo"
    >
      <Image
        source={artwork[surface]}
        style={{ height, width: Math.round(height * RATIO) }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        testID="brand-logo-image"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'row', alignItems: 'center' },
});

export interface LogoMarkProps {
  /** The picture's height in pixels; the width follows the artwork, so it is never stretched. */
  size?: number;
  /** `navy` for a light surface, `sky` for a navy or photo panel. */
  tone?: keyof typeof marks;
  /** Set when a surrounding heading already names the store, so it is not announced twice. */
  decorative?: boolean;
}

/** The square Nilzora mark on its own: the official artwork, at one small size. */
export function LogoMark({ size = 28, tone = 'navy', decorative = false }: LogoMarkProps) {
  return (
    <Image
      source={marks[tone]}
      style={{ height: size, width: size, borderRadius: Math.round(size * 0.28) }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : 'Nilzora'}
      aria-hidden={decorative ? true : undefined}
      testID="brand-mark"
    />
  );
}
