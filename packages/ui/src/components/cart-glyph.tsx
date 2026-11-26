import type { LucideIcon, LucideProps } from 'lucide-react';
import { forwardRef, type SVGProps } from 'react';
import { cn } from '../lib/cn';

/**
 * The Nilzora shopping cart.
 *
 * One drawing for every cart on the site and in the admin: a shallow, wide tray under a
 * swept handle, with two small wheels. It stands in for the mixed Lucide carts that used to
 * mark cart actions, so the header, the empty-cart states, the add-to-cart buttons and the
 * admin's order screens all show the same silhouette at the same stroke weight.
 *
 * It draws in `currentColor` unless a `color` is given, so a caller colours it with a text
 * class (`text-primary` in the header, `text-muted-foreground` for a quiet one).
 */

/** The swept handle into the tray. */
const HANDLE = 'M2.75 3.5h1.98a1.15 1.15 0 0 1 1.12.9l.55 2.35';
/** The tray itself: wide, shallow, with rounded corners. */
const TRAY =
  'M6.4 6.75h14.5a1.1 1.1 0 0 1 1.07 1.36l-1.28 5.1a1.8 1.8 0 0 1-1.75 1.35H9.5a1.8 1.8 0 0 1-1.76-1.4L6.4 6.75Z';

export interface CartGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'children'> {
  /** Rendered square, in CSS pixels. */
  size?: number | string;
  /** Outline weight; 1.75 matches the interface's other outline icons. */
  strokeWidth?: number | string;
  /** Defaults to the surrounding text colour. */
  color?: string;
  /** Accessible name. Left out, the drawing is decorative and hidden from screen readers. */
  title?: string;
}

export const CartGlyph = forwardRef<SVGSVGElement, CartGlyphProps>(function CartGlyph(
  { size = 24, strokeWidth = 1.75, color = 'currentColor', title, className, ...rest },
  ref,
) {
  const decoration =
    title === undefined
      ? { 'aria-hidden': true as const, focusable: 'false' as const }
      : { role: 'img' };
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      {...decoration}
      {...rest}
    >
      {title === undefined ? null : <title>{title}</title>}
      <path d={HANDLE} />
      <path d={TRAY} />
      <circle cx="9.9" cy="19.4" r="1.45" />
      <circle cx="17.75" cy="19.4" r="1.45" />
    </svg>
  );
});

/**
 * The same drawing dressed as a Lucide icon, for the places that take an `icon` component
 * (the admin's page toolbars, navigation entries and report tiles). It keeps their existing
 * `size`/`strokeWidth`/`color` conventions, so swapping the icon needs no other change.
 *
 * The cast is only for the ref type: this package and its consumers resolve separate copies
 * of React's types, which makes the two ref shapes nominally different.
 */
export const CartIcon = forwardRef<SVGSVGElement, LucideProps>(function CartIcon(
  { size = 24, strokeWidth = 1.75, color = 'currentColor', className },
  ref,
) {
  return (
    <CartGlyph
      ref={ref}
      size={typeof size === 'number' ? size : Number(size)}
      strokeWidth={typeof strokeWidth === 'number' ? strokeWidth : Number(strokeWidth)}
      color={color}
      className={className}
    />
  );
}) as unknown as LucideIcon;
