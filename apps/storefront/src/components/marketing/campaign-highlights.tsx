import type { CampaignSummary } from '@nilzora/contracts';
import { Badge, cn } from '@nilzora/ui';
import { ArrowRight, CalendarClock, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

/** Every product on sale, newest first: where a campaign's "shop the sale" leads. */
const SALE_HREF = '/products?sort=featured' as Route;

/*
 * Discount campaigns on the storefront. The prices themselves are already correct in
 * every product payload — a campaign is resolved by the API before a card is rendered —
 * so these components only explain *why* a price is low and when the offer ends. They
 * never calculate a discount.
 */

/** "20% off" or "৳300 off"; the cap is mentioned only when it applies. */
export function campaignOffer(campaign: CampaignSummary): string {
  if (campaign.discountKind === 'fixed') return `${formatOfferMoney(campaign.discountValue)} off`;
  const cap =
    campaign.maxDiscountMinor === null
      ? ''
      : ` (up to ${formatOfferMoney(campaign.maxDiscountMinor)})`;
  return `${String(campaign.discountValue)}% off${cap}`;
}

/** Poisha as taka, without importing the admin's formatter. */
function formatOfferMoney(minor: number): string {
  const taka = minor / 100;
  return `৳${taka.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** The end of a campaign as a short date, on the shop's own clock (Asia/Dhaka). */
export function campaignEnds(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Dhaka',
  }).format(date);
}

/** A small label beside a price, so a shopper knows a promotion set it. */
export function CampaignLabel({
  campaign,
  className,
}: {
  campaign: { title: string; endsAt: string | null };
  className?: string;
}) {
  const ends = campaignEnds(campaign.endsAt);
  // A campaign without a title still marks the price: the label stays short and true.
  const label = campaign.title.trim() === '' ? 'On sale' : campaign.title;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-brand-violet/10 px-2 py-0.5 text-[11px] font-semibold text-brand-violet',
        className,
      )}
      title={ends === null ? label : `${label} · ends ${ends}`}
    >
      <Sparkles aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * A category page's promotion strip: the campaign that reaches this category, what it
 * takes off, how many products it covers and when it ends.
 */
export function CategoryCampaignStrip({ campaign }: { campaign: CampaignSummary }) {
  const ends = campaignEnds(campaign.endsAt);
  return (
    <aside
      aria-label="Current promotion"
      className="relative isolate flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-2xl bg-linear-to-r from-brand-navy via-brand-slate to-brand-violet/80 px-5 py-4 text-white shadow-md"
    >
      <div
        aria-hidden="true"
        className="absolute -top-16 right-6 size-40 rounded-full bg-brand-sky/20 blur-3xl"
      />
      <div className="relative grid gap-0.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase text-brand-muted-slate">
          <Sparkles aria-hidden="true" className="size-3.5" />
          Limited-time promotion
        </p>
        <p className="font-display text-lg font-semibold tracking-tight sm:text-xl">
          {campaign.title.trim() === '' ? campaignOffer(campaign) : campaign.title}
        </p>
        <p className="text-sm text-brand-muted-slate">
          {campaignOffer(campaign)} ·{' '}
          {campaign.productCount === 1 ? '1 product' : `${String(campaign.productCount)} products`}
          {ends === null ? '' : ` · ends ${ends}`}
        </p>
      </div>
      <Badge
        tone="violet"
        className="relative shrink-0 bg-white/15 text-white ring-1 ring-white/25"
      >
        {campaignOffer(campaign)}
      </Badge>
    </aside>
  );
}

/**
 * The home page's promotional band. It is deliberately compact: the lead campaign's own banner
 * sits in a 12:5 frame beside a short block of words (title, what it takes off, how many
 * products, when it ends) and one "shop the sale" button, so the band is about a third of a
 * screen rather than a full-width wall of artwork. Any other campaigns follow as one row of
 * small cards and are capped at three.
 *
 * The picture is the campaign's own banner, uploaded in Discounts & campaigns and served as
 * WebP by the media service; it is drawn in the 12:5 frame the upload guidance asks for, so the
 * artwork is never stretched or cut. Without a picture the band is the words alone.
 *
 * Everything here comes from the campaign itself: the discount is the API's own figure and no
 * end date, product count or saving is ever invented. The cards stay flat on a hairline border
 * (the store's language), and the only movement is the arrow that eases in on hover.
 */
export function HomeCampaignSection({ campaigns }: { campaigns: readonly CampaignSummary[] }) {
  if (campaigns.length === 0) return null;
  const [lead, ...rest] = campaigns;
  if (lead === undefined) return null;
  const href = SALE_HREF;
  const leadEnds = campaignEnds(lead.endsAt);
  const leadOffer = campaignOffer(lead);
  const leadTitle = lead.title.trim();

  return (
    <section
      id="campaigns"
      aria-labelledby="campaigns-heading"
      className="border-y border-border/70 bg-surface-muted/60 py-6 sm:py-8"
    >
      <div className="mx-auto grid max-w-7xl gap-4 px-4 sm:px-8">
        <div className="grid items-center gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {lead.banner === null ? null : (
            <Link
              href={href}
              aria-label={`${lead.title}: ${leadOffer}. Shop the sale`}
              className="group relative isolate block aspect-12/5 w-full overflow-hidden rounded-2xl border border-border/80 bg-brand-navy"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- already-resized WebP from the media service */}
              <img
                src={lead.banner.url}
                alt=""
                loading="eager"
                decoding="async"
                className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-500 ease-soft group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            </Link>
          )}

          <div className="grid gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-brand-violet uppercase">
              <Sparkles aria-hidden="true" className="size-3.5" />
              On sale now
            </p>
            <h2
              id="campaigns-heading"
              className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
            >
              {/* A campaign may have no title of its own: the offer speaks for it. */}
              {leadTitle === '' ? leadOffer : leadTitle}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {leadTitle === '' ? null : (
                <>
                  <span className="font-semibold text-brand-violet">{leadOffer}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>
                {lead.productCount === 1 ? '1 product' : `${String(lead.productCount)} products`}
              </span>
              {leadEnds === null ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock aria-hidden="true" className="size-3.5" />
                    Ends {leadEnds}
                  </span>
                </>
              )}
            </p>
            <Link
              href={href}
              className="group mt-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-brand-navy px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-slate"
            >
              Shop the sale
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
          </div>
        </div>

        {rest.length > 0 ? (
          <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.slice(0, 3).map((campaign) => {
              const ends = campaignEnds(campaign.endsAt);
              return (
                <li key={campaign.id}>
                  <Link
                    href={SALE_HREF}
                    className="group flex h-full items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface p-2.5 transition-colors duration-200 hover:border-brand-violet/40"
                  >
                    {campaign.banner === null ? null : (
                      <span className="relative block aspect-12/5 w-24 shrink-0 overflow-hidden rounded-lg bg-brand-navy">
                        {/* eslint-disable-next-line @next/next/no-img-element -- already-resized WebP from the media service */}
                        <img
                          src={campaign.banner.thumbUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 size-full object-cover"
                        />
                      </span>
                    )}
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {/* Without a title the offer is the card's label, not an empty line. */}
                        {campaign.title.trim() === '' ? campaignOffer(campaign) : campaign.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {campaign.title.trim() === '' ? null : (
                          <>
                            <span className="font-semibold text-brand-violet">
                              {campaignOffer(campaign)}
                            </span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {ends === null
                              ? `${String(campaign.productCount)} products`
                              : `Ends ${ends}`}
                          </span>
                        </span>
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-brand-violet opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
