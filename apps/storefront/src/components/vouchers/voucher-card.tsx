import { voucherUsePath, type Voucher } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { CalendarClock, CheckCircle2, ShoppingBag, Truck } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import {
  voucherConditions,
  voucherDiscount,
  voucherEligibility,
  voucherInactive,
  voucherValidity,
} from '@/lib/voucher-format';
import { CollectVoucherButton } from './collect-voucher-button';

/*
 * A voucher as a ticket: the discount on a sky-to-primary stub, the conditions beside it,
 * a perforation between them. A voucher that is over or used stays readable but fades; the
 * listings themselves drop it 4 days after it ends (the API decides, not this card).
 */

const STATE_LABEL: Partial<Record<Voucher['state'], string>> = {
  used: 'Used',
  expired: 'Expired',
  upcoming: 'Coming soon',
  fully_collected: 'All collected',
};

export function VoucherCard({
  voucher,
  csrf,
  signedIn,
  returnTo,
  onCollected,
  showDescription = false,
}: {
  voucher: Voucher;
  csrf: { name: string; token: string } | null;
  signedIn: boolean;
  /** Where sign-in sends the customer back to. */
  returnTo: string;
  /** Told when the server confirmed a collection made from this card. */
  onCollected?: () => void;
  /**
   * Adds the admin's own description of the offer under its conditions. Off by default so the
   * Voucher Center keeps its established layout; the product page's expanded list turns it on.
   */
  showDescription?: boolean;
}) {
  const faded = voucherInactive(voucher);
  return (
    <article
      aria-label={`${voucher.title}: ${voucherDiscount(voucher)}`}
      className={cn(
        'relative flex min-h-36 overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md',
        faded && 'opacity-60 grayscale-[0.6] hover:shadow-xs',
      )}
    >
      <div className="relative flex w-24 shrink-0 flex-col items-center justify-center gap-1.5 bg-linear-to-br from-brand-sky via-primary to-primary-action-hover px-2 text-center text-white sm:w-32">
        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase opacity-90">Voucher</span>
        {voucher.kind === 'free_delivery' ? (
          <>
            <Truck aria-hidden="true" className="size-7" />
            <span className="text-[11px] font-semibold tracking-[0.14em]">FREE DELIVERY</span>
          </>
        ) : (
          <>
            <span className="font-display text-[1.6rem] leading-none font-bold tracking-tight sm:text-[1.7rem]">
              {voucher.kind === 'percent'
                ? `${String(voucher.value)}%`
                : voucherDiscount(voucher).replace(' OFF', '')}
            </span>
            <span className="text-[11px] font-semibold tracking-[0.18em]">OFF</span>
          </>
        )}
        {/* The perforation: two notches and a dashed edge. */}
        <span aria-hidden="true" className="absolute -top-2.5 -right-2.5 size-5 rounded-full bg-background" />
        <span aria-hidden="true" className="absolute -right-2.5 -bottom-2.5 size-5 rounded-full bg-background" />
        <span aria-hidden="true" className="absolute inset-y-3 right-0 border-r-2 border-dashed border-white/45" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2.5 p-3.5 sm:p-4">
        <div className="grid gap-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold text-foreground">{voucher.title}</h3>
            {STATE_LABEL[voucher.state] ? (
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border/70">
                {STATE_LABEL[voucher.state]}
              </span>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{voucherConditions(voucher)}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShoppingBag aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{voucherEligibility(voucher)}</span>
          </p>
          {showDescription && voucher.description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{voucher.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
            {voucherValidity(voucher)}
          </p>
          <VoucherAction
            voucher={voucher}
            csrf={csrf}
            signedIn={signedIn}
            returnTo={returnTo}
            onCollected={onCollected}
          />
        </div>
      </div>
    </article>
  );
}

function VoucherAction({
  voucher,
  csrf,
  signedIn,
  returnTo,
  onCollected,
}: {
  voucher: Voucher;
  csrf: { name: string; token: string } | null;
  signedIn: boolean;
  returnTo: string;
  onCollected?: () => void;
}): ReactNode {
  if (voucher.state === 'collected') {
    return <UseLink voucher={voucher} />;
  }
  if (voucher.state === 'used') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        <CheckCircle2 aria-hidden="true" className="size-4" /> Used
      </span>
    );
  }
  if (voucher.state !== 'available') return null;
  if (!signedIn || csrf === null) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(returnTo)}` as Route}
        className="inline-flex min-h-10 items-center rounded-full bg-primary-action px-5 text-sm font-semibold text-primary-action-foreground transition-colors hover:bg-primary-action-hover"
      >
        Sign in to collect
      </Link>
    );
  }
  return (
    <CollectVoucherButton
      voucherId={voucher.id}
      csrf={csrf}
      usePath={voucherUsePath(voucher)}
      onCollected={onCollected}
    />
  );
}

export function UseLink({ voucher }: { voucher: Voucher }) {
  return (
    <Link
      href={voucherUsePath(voucher) as Route}
      className="inline-flex min-h-10 items-center rounded-full border-2 border-primary px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary-action hover:text-primary-action-foreground"
    >
      Use
    </Link>
  );
}
