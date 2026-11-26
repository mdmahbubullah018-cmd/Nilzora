import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { theme } from '@/theme';

/*
 * The Nilzora shopping cart, drawn once for the whole app.
 *
 * The same silhouette the website and the admin use (see @nilzora/ui's CartGlyph): a shallow,
 * wide tray under a swept handle with two small wheels. `icons.cart` points here, so every
 * screen that asks for the cart — the tab bar, screen headers, the empty cart, checkout —
 * shows one drawing at the app's own stroke weight instead of a Lucide cart that was only
 * ever meant to stand in for it.
 */

/** The swept handle into the tray. */
const HANDLE = 'M2.75 3.5h1.98a1.15 1.15 0 0 1 1.12.9l.55 2.35';
/** The tray: wide, shallow, rounded. */
const TRAY =
  'M6.4 6.75h14.5a1.1 1.1 0 0 1 1.07 1.36l-1.28 5.1a1.8 1.8 0 0 1-1.75 1.35H9.5a1.8 1.8 0 0 1-1.76-1.4L6.4 6.75Z';

export interface CartGlyphProps {
  /** Rendered square, in points. */
  size?: number | string;
  strokeWidth?: number | string;
  /** Defaults to the body text colour. */
  color?: ColorValue | null;
  /** Accepted so the drawing can stand in for a Lucide icon, which the set passes; it has no fill. */
  fill?: ColorValue | null;
  /** Accepted for the same reason: the drawing is always decorative. */
  accessible?: boolean;
}

export function CartGlyph({
  size = theme.icon.size.md,
  strokeWidth = theme.icon.stroke.idle,
  color = theme.colors.body,
}: CartGlyphProps) {
  const side = typeof size === 'number' ? size : Number(size);
  const weight = typeof strokeWidth === 'number' ? strokeWidth : Number(strokeWidth);
  return (
    <Svg
      width={side}
      height={side}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.colors.body}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      <Path d={HANDLE} />
      <Path d={TRAY} />
      <Circle cx={9.9} cy={19.4} r={1.45} />
      <Circle cx={17.75} cy={19.4} r={1.45} />
    </Svg>
  );
}
