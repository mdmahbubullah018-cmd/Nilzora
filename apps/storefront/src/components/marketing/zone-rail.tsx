import type { ShoppingZone } from '@nilzora/contracts';
import { ZonePeekRail } from '@nilzora/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { zoneHref } from '@/lib/catalog-query';
import { AutoAdvanceRail } from './auto-advance-rail';

/*
 * Shopping zones as a shopper sees them: the same banner carousel as the app's "Shop by
 * collection" — one wide collection banner per view, with a slice of the next one at the edge.
 *
 * Each banner is the collection's own artwork, full bleed, with its name, its description (or
 * product count) and a "Shop" cue laid on a navy fade along the bottom edge. The fade is what
 * keeps the white type legible on any picture (dark enough behind the words even on a white
 * one); the cue is an outline, not a filled button, so the artwork shows through it. Every word
 * comes from the collection itself: no offer or discount text is invented here.
 *
 * The geometry lives in @nilzora/ui (ZonePeekRail, `banner` variant). The rail moves on by
 * itself (AutoAdvanceRail): it scrolls to the next collection every few seconds and rests
 * whenever it is off screen, hovered, focused, touched, paused with its Pause button, or the
 * visitor prefers reduced motion. Each banner says where it sits ("Collection 2 of 5") to a
 * screen reader.
 *
 * A zone without a picture gets a branded tile built from its name and brand colours, so a
 * half-set-up store never shows a broken banner. A zone with nothing on its shelf is left out:
 * an empty collection is a dead end, and its products in other zones (or in plain browsing)
 * still reach shoppers.
 */

/** The tints a zone falls back to, mirrored from the admin preview so both agree. */
const FALLBACK_TINTS = [
  'from-primary to-violet',
  'from-violet to-primary-hover',
  'from-primary-hover to-primary',
  'from-moderator to-violet',
] as const;

export function zoneTint(displayOrder: number): string {
  const tints = FALLBACK_TINTS;
  return tints[Math.abs(displayOrder) % tints.length] ?? tints[0];
}

export function ZoneTile({
  zone,
  tintIndex,
  eager,
  total,
}: {
  zone: ShoppingZone;
  /** Where the tile sits in the rail, so neighbouring fallbacks never share a tint. */
  tintIndex: number;
  eager: boolean;
  /** How many tiles the rail holds, so the spoken name can say "Collection 2 of 5". */
  total?: number;
}) {
  const count = `${String(zone.productCount)} ${zone.productCount === 1 ? 'product' : 'products'}`;
  const label = `${zone.name}, ${count}`;
  return (
    <Link
      href={zoneHref(zone.slug)}
      aria-label={
        total === undefined
          ? `Shop the ${label}`
          : `Shop the ${label}. Collection ${String(tintIndex + 1)} of ${String(total)}`
      }
      className={`group relative block aspect-16/7 min-h-36 w-full overflow-hidden rounded-2xl bg-brand-navy transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none motion-safe:active:scale-[0.99] ${total === 1 ? 'lg:aspect-3/1' : 'lg:aspect-5/2'}`}
    >
      {zone.banner ? (
        // eslint-disable-next-line @next/next/no-img-element -- already resized WebP from the media service
        <img
          src={zone.banner.url}
          alt={zone.bannerAlt ?? ''}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`absolute inset-0 bg-linear-to-br ${zoneTint(tintIndex)}`}
        >
          <span className="absolute -top-8 -left-6 size-28 rounded-full bg-white/10" />
          <span className="absolute -right-8 -bottom-10 size-44 rounded-full bg-white/10" />
        </span>
      )}
      {/* The navy fade the words sit on: strongest at the bottom edge, gone by mid-banner. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-4/5 bg-linear-to-t from-brand-navy/95 via-brand-navy/70 to-transparent"
      />
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5 lg:p-6">
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate font-display text-lg font-semibold tracking-tight text-white sm:text-xl xl:text-2xl">
            {zone.name}
          </span>
          <span className="truncate text-xs text-white sm:text-sm">
            {zone.description ?? count}
          </span>
        </span>
        {/* A cue, not a second button (the whole banner is the link): plain words over the fade,
            with no border, fill or pill around them. White on the fade stays well above 4.5:1. */}
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-white sm:text-sm">
          Shop
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </span>
    </Link>
  );
}

/** Zones worth showing: active ones with something on the shelf, first shown first. */
export function shoppableZones(zones: readonly ShoppingZone[]): ShoppingZone[] {
  return zones.filter((zone) => zone.productCount > 0);
}

/** The row itself; nothing at all when no zone can be shopped. */
export function ZoneRail({ zones }: { zones: readonly ShoppingZone[] }) {
  const shoppable = shoppableZones(zones);
  if (shoppable.length === 0) return null;
  return (
    <AutoAdvanceRail itemCount={shoppable.length}>
      <ZonePeekRail
        label="collections"
        variant="banner"
        // A little room on the top and, from lg, the sides, so a focus ring (2px + 2px offset) on
        // the first banner is not cut off by the row's own overflow. The negative margins give the
        // room back, so the rail sits exactly where it did.
        className="-mt-1 scroll-pl-1 pt-1 lg:-mx-1 lg:px-1"
        items={shoppable.map((zone, index) => ({
          key: zone.id,
          content: (
            <ZoneTile zone={zone} tintIndex={index} eager={index < 2} total={shoppable.length} />
          ),
        }))}
      />
    </AutoAdvanceRail>
  );
}
