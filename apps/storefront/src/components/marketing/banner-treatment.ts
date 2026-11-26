/*
 * Banner words, drawn on the artwork.
 *
 * A banner's words sit directly on the picture, in a container that is ~96% transparent: the
 * tint is a 4% wash, so the artwork stays the visual subject and the text never looks like it
 * lives inside a card. Legibility comes from contrast techniques instead of opacity — the blur
 * softens whatever sits behind the type, and the layered shadow keeps the letters readable over
 * both light and dark pictures.
 *
 * These strings are shared by every customer-facing banner placement (the hero carousel, the
 * campaign row and the category strip) so the treatment can never drift between them.
 */

/** The ~96% transparent container: a 4% wash, a hairline and a soft blur, no shadow. */
export const BANNER_CAPTION =
  'pointer-events-none z-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 rounded-lg bg-white/[0.04] px-3 py-2 ring-1 ring-white/15 ring-inset backdrop-blur-[2px] sm:px-3.5 sm:py-2.5';

/** A banner heading: white, tight and shadowed rather than boxed. */
export const BANNER_HEADING =
  'line-clamp-2 font-display text-sm font-semibold tracking-tight text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.55),0_0_10px_rgb(0_0_0/0.35)] sm:text-lg';

/** Supporting banner text, held to one or two lines. */
export const BANNER_SUBTEXT =
  'line-clamp-2 text-xs leading-snug text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:text-sm';

/** A banner's call to action: a label with an arrow, never an empty button. */
export const BANNER_CTA =
  'inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:text-sm';
