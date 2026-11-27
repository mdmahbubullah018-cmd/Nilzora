import type { AdminBanner } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { bannerName } from '@/lib/banner-name';
import { AutoText } from '@/components/i18n/translate';

/**
 * The frame each placement shows its picture in on the storefront. Kept in one place so the
 * admin's preview and the customer-facing result can never drift apart.
 */
export const BANNER_FRAME: Record<AdminBanner['placement'], string> = {
  home_hero: 'aspect-[12/5]',
  home_secondary: 'aspect-[12/5]',
  category: 'aspect-[6/1]',
};

/** The picture guidance shown beside an upload for each placement. */
export const BANNER_GUIDANCE: Record<AdminBanner['placement'], string> = {
  home_hero: 'Wide and shallow — around 1920 × 800 px (12:5).',
  home_secondary: 'Wide and shallow — around 1920 × 800 px (12:5).',
  category: 'A short band — around 1920 × 320 px (6:1).',
};

export interface BannerPreviewValues {
  placement: AdminBanner['placement'];
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
}

/** The words a banner would show, or null when it is picture-only. */
function hasWords(values: BannerPreviewValues): boolean {
  return values.title !== '' || values.subtitle !== null || values.ctaLabel !== null;
}

/**
 * A banner drawn the way the storefront draws it: the picture in the placement's wide frame,
 * with any words on the artwork in the same ~96% transparent container (a 4% wash, white type
 * and a soft shadow) the customer actually sees. A banner without words shows only its picture;
 * a banner without a picture is the tinted card the storefront falls back to.
 *
 * The same component backs the saved banners list and the live preview inside the form, so what
 * an admin approves is what a shopper gets.
 */
export function BannerPreview({
  values,
  compact = false,
  label,
}: {
  values: BannerPreviewValues;
  compact?: boolean;
  label: string;
}) {
  const words = hasWords(values);
  return (
    <div
      className="grid overflow-hidden rounded-xl border border-hairline bg-surface"
      aria-label={label}
      role="img"
    >
      <div className={cn('relative overflow-hidden bg-brand-soft', BANNER_FRAME[values.placement])}>
        {values.imageUrl === null ? (
          <>
            <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              <AutoText>No picture yet</AutoText>
            </span>
            {words ? (
              <div className="absolute inset-0 grid content-center p-2.5">
                <div className="grid min-w-0 gap-0.5">
                  {values.title === '' ? null : (
                    <p className="line-clamp-2 font-display text-sm font-semibold text-foreground">
                      {values.title}
                    </p>
                  )}
                  {values.subtitle === null ? null : (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      <AutoText value={values.subtitle} />
                    </p>
                  )}
                  {values.ctaLabel === null ? null : (
                    <span className="mt-0.5 inline-flex items-center gap-1 justify-self-start text-xs font-semibold text-link">
                      {values.ctaLabel} →
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
            <img src={values.imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
            {words ? (
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 bg-white/4 px-2.5 py-2 ring-1 ring-white/15 ring-inset backdrop-blur-[2px]',
                  compact ? '' : 'sm:px-3',
                )}
              >
                <div className="grid min-w-0 gap-0.5">
                  {values.title === '' ? null : (
                    <p
                      className={cn(
                        'line-clamp-2 font-display font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]',
                        compact ? 'text-xs' : 'text-sm',
                      )}
                    >
                      {values.title}
                    </p>
                  )}
                  {values.subtitle === null ? null : (
                    <p className="line-clamp-1 text-[0.6875rem] text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
                      {values.subtitle}
                    </p>
                  )}
                </div>
                {values.ctaLabel === null || compact ? null : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
                    {values.ctaLabel}
                    <span aria-hidden="true">→</span>
                  </span>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The preview of a saved banner. */
export function SavedBannerPreview({
  banner,
  compact = false,
}: {
  banner: AdminBanner;
  compact?: boolean;
}) {
  return (
    <BannerPreview
      compact={compact}
      label={`Preview of ${bannerName(banner)}`}
      values={{
        placement: banner.placement,
        title: banner.title,
        subtitle: banner.subtitle,
        ctaLabel: banner.ctaLabel,
        imageUrl: banner.image?.url ?? null,
      }}
    />
  );
}
