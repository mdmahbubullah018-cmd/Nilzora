import type { AdminShoppingZoneDetail } from '@nilzora/contracts';
import { ArrowRight } from 'lucide-react';
import { AutoText } from '@/components/i18n/translate';

/*
 * The zone tile, drawn with the same words the storefront uses. An admin editing a zone
 * sees exactly what a shopper will get, including the branded tile that stands in for a
 * zone with no picture.
 *
 * The frame is the storefront's own: 3:2 on a phone and 3:1 on a desktop, with the words in a
 * translucent fade along the bottom - the picture is never blurred or covered.
 */

/**
 * Tints for a zone without a picture. Purely a fallback: the picture is the real design and
 * every zone should have one; this keeps the rail looking finished until it does.
 */
const FALLBACK_TINTS = [
  'from-primary to-violet',
  'from-violet to-primary-hover',
  'from-primary-hover to-primary',
  'from-moderator to-violet',
] as const;

export function zoneFallbackTint(displayOrder: number): string {
  const tints = FALLBACK_TINTS;
  return tints[Math.abs(displayOrder) % tints.length] ?? tints[0];
}

export function ZoneTilePreview({
  zone,
  className,
}: {
  zone: Pick<
    AdminShoppingZoneDetail,
    'name' | 'banner' | 'bannerAlt' | 'displayOrder' | 'productCount'
  >;
  className?: string;
}) {
  const products = `${String(zone.productCount)} ${zone.productCount === 1 ? 'product' : 'products'}`;
  return (
    <div
      className={[
        'w-full overflow-hidden rounded-xl border border-hairline bg-surface',
        className ?? '',
      ].join(' ')}
    >
      {/* The picture in the frame the storefront draws (3:2 on a phone, 3:1 on a desktop). */}
      <div className="relative aspect-3/2 w-full bg-brand-navy lg:aspect-3/1">
        {zone.banner ? (
          // eslint-disable-next-line @next/next/no-img-element -- the stored picture, exactly as made
          <img
            src={zone.banner.url}
            alt={zone.bannerAlt ?? ''}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className={`absolute inset-0 bg-linear-to-br ${zoneFallbackTint(zone.displayOrder)}`}
          >
            <span className="absolute -right-6 -bottom-8 size-32 rounded-full bg-white/10" />
            <span className="absolute -top-10 -left-6 size-24 rounded-full bg-white/10" />
            <span className="absolute top-1/2 left-1/2 size-16 -translate-1/2 rounded-2xl bg-white/15" />
          </div>
        )}
      </div>
      {/* The words under the picture, exactly where the storefront puts them. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate text-sm font-semibold text-foreground">
            <AutoText value={zone.name} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <AutoText value={products} />
          </p>
          {zone.banner ? null : (
            <p className="text-[11px] font-medium text-muted-foreground">
              <AutoText>Branded tile, no picture</AutoText>
            </p>
          )}
        </div>
        <p className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link">
          Shop
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </p>
      </div>
    </div>
  );
}

/**
 * The zone card as the app draws it: the whole card is the artwork, with the name, the count
 * and "Shop" inside a navy fade along the bottom edge. An admin deciding what to upload sees
 * the real composition — a picture whose subject sits low will be covered by those words.
 *
 * `mobileBanner` is the app's own picture; when a zone has none, the card falls back to the
 * website's picture and then to the branded tile, which is what the phone will really show.
 */
export function ZoneAppCardPreview({
  zone,
  className,
}: {
  zone: Pick<
    AdminShoppingZoneDetail,
    'name' | 'banner' | 'bannerAlt' | 'mobileBanner' | 'displayOrder' | 'productCount'
  >;
  className?: string;
}) {
  const picture = zone.mobileBanner ?? zone.banner;
  const products = `${String(zone.productCount)} ${zone.productCount === 1 ? 'product' : 'products'}`;
  return (
    <div
      className={[
        'relative aspect-3/2 w-full overflow-hidden rounded-xl bg-brand-navy',
        className ?? '',
      ].join(' ')}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- the stored picture, exactly as made
        <img
          src={picture.url}
          alt={zone.mobileBanner ? '' : (zone.bannerAlt ?? '')}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`absolute inset-0 bg-linear-to-br ${zoneFallbackTint(zone.displayOrder)}`}
        >
          <span className="absolute -right-6 -bottom-8 size-32 rounded-full bg-white/10" />
          <span className="absolute -top-10 -left-6 size-24 rounded-full bg-white/10" />
        </div>
      )}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-brand-navy/85 via-brand-navy/35 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 grid gap-0.5 p-3">
        <p className="truncate text-sm font-semibold text-white">
          <AutoText value={zone.name} />
        </p>
        <p className="truncate text-xs text-white/85">
          <AutoText value={products} />
        </p>
        <p className="text-xs font-semibold text-white">
          <AutoText>Shop →</AutoText>
        </p>
      </div>
    </div>
  );
}
