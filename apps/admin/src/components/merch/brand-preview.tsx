import type { AdminBrand } from '@nilzora/contracts';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
/* @/lib/format */
import { BrandLogo } from './brand-logo';
import { brandInitials } from './brand-initials';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';

/*
 * How a brand reaches customers, drawn from the same data the store reads: its card in the
 * homepage's brand row (the logo on a square panel, the name beneath) and its own page (the
 * identity row, then the banner as a separate picture). Nothing is invented: a brand without a
 * logo shows its initials, exactly as the store does, and a hidden brand says it is not shown.
 */

export function BrandPreview({
  brand,
  storeUrl,
}: {
  brand: AdminBrand;
  /** The public store's origin, or null when this workspace has none to link to. */
  storeUrl: string | null;
}) {
  const address = `/${brand.slug}`;
  return (
    <section aria-label={`How ${brand.name} appears to customers`} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {brand.isActive ? (
            <Eye aria-hidden="true" className="size-4 text-success-ink" strokeWidth={1.75} />
          ) : (
            <EyeOff
              aria-hidden="true"
              className="size-4 text-muted-foreground"
              strokeWidth={1.75}
            />
          )}
          Customer view
        </h3>
        {brand.isActive && storeUrl ? (
          <a
            href={`${storeUrl}${address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline max-sm:min-h-11"
          >
            Open in the store
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only"><AutoText>(opens in a new tab)</AutoText></span>
          </a>
        ) : null}
      </div>

      {brand.isActive ? null : (
        <p className="rounded-xl border border-hairline bg-neutral-soft px-3 py-2 text-xs text-muted-foreground">
          This brand is hidden: customers see neither its tile nor its page. The preview shows how
          it will look once it is visible.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
        {/* The homepage card: the brand's logo on a square panel with the name beneath it. The
            banner is not used here — this row is about the makers' marks. */}
        <div className="grid content-start gap-2 rounded-2xl border border-border/80 bg-surface p-2.5">
          <span className="flex aspect-square justify-center overflow-hidden rounded-xl bg-surface p-3 ring-1 ring-border/60">
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time
              <img
                src={brand.logo.thumbUrl}
                alt=""
                className="size-full object-contain"
              />
            ) : (
              <span className="grid size-full place-items-center font-display text-2xl font-semibold text-info-ink">
                {brandInitials(brand.name)}
              </span>
            )}
          </span>
          <span className="flex items-baseline justify-between gap-2 px-0.5">
            <span className="line-clamp-1 min-w-0 text-xs font-semibold wrap-break-word text-foreground">
              {brand.name}
            </span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">
              {brand.productCount}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">Homepage brand card</span>
        </div>

        {/* The brand's own page: the identity row, then its banner as a separate picture. */}
        <div className="grid content-start gap-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-start gap-3 p-3">
              <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface p-1.5 ring-1 ring-border/60">
                <BrandLogo brand={brand} className="size-full bg-transparent ring-0" />
              </span>
              <div className="grid min-w-0 gap-1">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"><AutoText>Brand</AutoText></span>
                <span className="font-display text-base font-semibold wrap-break-word text-foreground">
                  {brand.name}
                </span>
                <span className="text-xs text-muted-foreground"><CountText count={brand.productCount} one="product" /></span>
              </div>
            </div>
            {brand.banner ? (
              <div className="relative aspect-12/5 w-full border-t border-border/70 bg-brand-navy">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time */}
                <img
                  src={brand.banner.thumbUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              </div>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            Brand page: logo above{brand.banner ? ' the banner' : ' the name, with no banner'}
          </span>
        </div>
      </div>
    </section>
  );
}
