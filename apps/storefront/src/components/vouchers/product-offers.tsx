'use client';

import { voucherUsePath, type Voucher } from '@nilzora/contracts';
import { cn, Dialog } from '@nilzora/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { formatMoney } from '@/lib/format';
import { collectVoucherAction } from '@/lib/voucher-actions';
import { voucherEligibility } from '@/lib/voucher-format';
import { VoucherCard } from './voucher-card';

/*
 * Offers on a product page: one row of compact tickets, each built from the same parts as the
 * Voucher Center's own card (a gradient stub with the offer, a perforated seam, the store's
 * surface and its two button styles), with the exact list (complete terms, dates, the admin's
 * description and a way to the Voucher Center) one tap away.
 *
 * Visible cards: a phone shows one whole ticket and about 30% of the next; a tablet or desktop
 * shows two whole tickets and about 10% of the third. The row snaps, scrolls with a finger or
 * a trackpad, and is focusable so the arrow keys move it.
 *
 * Everything shown comes from the API's own product-voucher answer. The strip only hides what
 * cannot be used (over, used, fully taken) and a targeted voucher that names other products; it
 * never decides applicability itself, and Collect/Use keep the store's existing collection and
 * usage flows.
 */

/** The row shows a handful; the full list shows every applicable voucher. */
const STRIP_LIMIT = 6;
/** Wide enough for a tablet, where the full list becomes a modal instead of a sheet. */
const WIDE = '(min-width: 40rem)';

const EXPIRY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Dhaka',
});

function subscribeWide(onChange: () => void): () => void {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE).matches : true),
    () => true,
  );
}

/** The stub's headline: "৳60", "10%" or "Free". */
function discountHeadline(voucher: Voucher): string {
  if (voucher.kind === 'free_delivery') return 'Free';
  return voucher.kind === 'percent' ? `${String(voucher.value)}%` : formatMoney(voucher.value);
}

/** "Min. spend ৳500", or a plain statement when there is no minimum. */
function minimumSpend(voucher: Voucher): string {
  return voucher.minOrderMinor > 0
    ? `Min. spend ${formatMoney(voucher.minOrderMinor)}`
    : 'No minimum spend';
}

/** "Till 30 Nov" or "No expiry", on the shop's own clock. */
function expiryLabel(voucher: Voucher): string {
  if (!voucher.endsAt) return 'No expiry';
  const date = new Date(voucher.endsAt);
  return Number.isNaN(date.getTime()) ? 'No expiry' : `Till ${EXPIRY.format(date)}`;
}

/**
 * The second line of a ticket: the minimum spend first, then what the voucher covers. The
 * minimum is always the leading words, so it stays legible even when the tail is truncated;
 * the admin's own description is shown in full in the expanded list.
 */
function secondLine(voucher: Voucher): string {
  return `${minimumSpend(voucher)} · ${voucherEligibility(voucher)}`;
}

/** Whether a voucher can still be collected and used on this product. */
function looksApplicable(voucher: Voucher, productSlug: string | undefined): boolean {
  if (
    voucher.state === 'expired' ||
    voucher.state === 'used' ||
    voucher.state === 'fully_collected'
  ) {
    return false;
  }
  if (
    voucher.scope === 'products' &&
    productSlug !== undefined &&
    !voucher.products.some((product) => product.slug === productSlug)
  ) {
    return false;
  }
  return true;
}

/** A sign-in that comes back to this product and finishes the collection it was asked for. */
function collectReturnPath(returnTo: string, voucherId: string): string {
  const separator = returnTo.includes('?') ? '&' : '?';
  return `${returnTo}${separator}collect=${encodeURIComponent(voucherId)}`;
}

/** The sign-in address for a guest who pressed Collect. */
function signInHref(returnTo: string, voucherId: string): Route {
  return `/login?next=${encodeURIComponent(collectReturnPath(returnTo, voucherId))}` as Route;
}

export interface ProductOffersProps {
  vouchers: readonly Voucher[];
  csrf: { name: string; token: string } | null;
  signedIn: boolean;
  /** Where sign-in sends the customer back to. */
  returnTo: string;
  /** The product being read, so a voucher naming other products is never offered. */
  productSlug?: string;
  /** A voucher the customer chose before signing in; collected as soon as the page returns. */
  collectVoucherId?: string;
}

export function ProductOffers({
  vouchers,
  csrf,
  signedIn,
  returnTo,
  productSlug,
  collectVoucherId,
}: ProductOffersProps) {
  const wide = useIsWide();
  const rail = useRef<HTMLUListElement>(null);
  const resumed = useRef(false);
  const inFlight = useRef(false);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [collected, setCollected] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const applicable = useMemo(
    () => vouchers.filter((voucher) => looksApplicable(voucher, productSlug)),
    [vouchers, productSlug],
  );
  const strip = applicable.slice(0, STRIP_LIMIT);

  /** The voucher as this page now knows it: a collection shows everywhere at once. */
  const stateOf = useCallback(
    (voucher: Voucher): Voucher =>
      voucher.state === 'available' && collected.has(voucher.id)
        ? { ...voucher, state: 'collected' }
        : voucher,
    [collected],
  );

  const measure = useCallback(() => {
    const element = rail.current;
    if (element === null) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdges({
      start: element.scrollLeft <= 1,
      end: max <= 1 || element.scrollLeft >= max - 1,
    });
  }, []);

  useEffect(() => {
    const element = rail.current;
    if (element === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const page = (direction: -1 | 1) => {
    const element = rail.current;
    if (element === null) return;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({
      left: direction * element.clientWidth,
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  const collect = useCallback(
    async (voucher: Voucher) => {
      if (csrf === null || inFlight.current) return;
      inFlight.current = true;
      setPendingId(voucher.id);
      // Optimistic: the ticket turns into "Collected" at once, and is put back if refused.
      setCollected((previous) => new Set(previous).add(voucher.id));
      setToast({ tone: 'success', message: 'Voucher collected' });
      try {
        const form = new FormData();
        form.set(csrf.name, csrf.token);
        form.set('voucherId', voucher.id);
        const answer = await collectVoucherAction(form);
        if (answer.ok) return;
        setCollected((previous) => {
          const next = new Set(previous);
          next.delete(voucher.id);
          return next;
        });
        setToast({
          tone: 'error',
          message: answer.message ?? 'That voucher could not be collected.',
        });
        if (answer.signedOut) {
          window.location.assign(signInHref(returnTo, voucher.id));
          return;
        }
      } catch {
        setCollected((previous) => {
          const next = new Set(previous);
          next.delete(voucher.id);
          return next;
        });
        setToast({ tone: 'error', message: 'That voucher could not be collected.' });
      } finally {
        inFlight.current = false;
        setPendingId(null);
      }
    },
    [csrf, returnTo],
  );

  // Back from sign-in with "collect this voucher": finish what the shopper started, once,
  // then drop the marker from the address so a reload does not repeat it.
  useEffect(() => {
    if (!signedIn || csrf === null || collectVoucherId === undefined || resumed.current) return;
    resumed.current = true;
    window.history.replaceState(window.history.state, '', returnTo);
    const target = applicable.find(
      (voucher) =>
        voucher.id === collectVoucherId &&
        voucher.state === 'available' &&
        !collected.has(voucher.id),
    );
    if (target === undefined) return;
    // A tick later, so the collection (and its optimistic state) is a normal event, not a
    // state update inside this effect.
    const timer = window.setTimeout(() => {
      void collect(target);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [signedIn, csrf, collectVoucherId, applicable, collected, collect, returnTo]);

  if (applicable.length === 0) return null;

  return (
    <section aria-labelledby="product-vouchers" className="grid gap-2">
      <div aria-hidden="true" className="h-2 bg-[#F1F5F9]" />

      <div className="flex items-center justify-between gap-2">
        <h2
          id="product-vouchers"
          className="text-[14px] leading-5 font-medium text-brand-navy"
        >
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="group flex min-h-8 cursor-pointer items-center gap-0.5 rounded-md transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Vouchers
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </button>
        </h2>

        {edges.start && edges.end ? null : (
          <div className="hidden items-center gap-1.5 md:flex">
            <button
              type="button"
              aria-label="Previous vouchers"
              onClick={() => page(-1)}
              disabled={edges.start}
              className="relative grid size-7 cursor-pointer place-items-center rounded-full border border-border bg-surface text-brand-navy transition-colors before:absolute before:-inset-2 hover:border-primary/40 hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:text-brand-navy"
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Next vouchers"
              onClick={() => page(1)}
              disabled={edges.end}
              className="relative grid size-7 cursor-pointer place-items-center rounded-full border border-border bg-surface text-brand-navy transition-colors before:absolute before:-inset-2 hover:border-primary/40 hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:text-brand-navy"
            >
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/*
        One carousel at every width. A phone shows one whole ticket and about 30% of the next
        (2 × 100% = 1 card + gap + 0.3 card); from `md` two whole tickets and about 10% of the
        third. Both are shares of the row, so they hold at any column width. The row itself is
        focusable, so a keyboard scrolls it with the arrow keys as well as tabbing to a card.
      */}
      <ul
        ref={rail}
        role="list"
        aria-label="Vouchers for this product"
        tabIndex={0}
        onScroll={measure}
        className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 scroll-smooth scrollbar-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:scroll-auto"
      >
        {strip.map((voucher) => {
          const shown = stateOf(voucher);
          const collected = shown.state === 'collected';
          // The row's own 12px side padding is part of the visible width, so the card's share
          // adds it back; without that the peek shows more than the intended slice on a phone.
          return (
            <li
              key={voucher.id}
              className="w-[calc((100%+4px)/1.3)] shrink-0 snap-start md:w-[calc((100%-4px)/2.1)]"
            >
              <article
                aria-label={`${voucher.title}: ${discountHeadline(voucher)}`}
                className="flex h-24 overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow duration-200 focus-within:shadow-md hover:shadow-md"
              >
                {/* The stub carries the offer, exactly as the Voucher Center's ticket does. */}
                <div className="relative flex w-[76px] shrink-0 flex-col items-center justify-center gap-0.5 bg-linear-to-br from-brand-sky via-primary to-primary-action-hover px-1.5 text-center text-white">
                  <span className="text-[8.5px] leading-[10px] font-semibold tracking-[0.16em] uppercase opacity-90">
                    Voucher
                  </span>
                  <span className="font-display text-[20px] leading-[23px] font-bold tracking-tight">
                    {discountHeadline(voucher)}
                  </span>
                  <span className="text-[9.5px] leading-[12px] font-semibold tracking-[0.14em]">
                    {voucher.kind === 'free_delivery' ? 'DELIVERY' : 'OFF'}
                  </span>
                  {/* The perforation: two notches and a dashed edge. */}
                  <span
                    aria-hidden="true"
                    className="absolute -top-[5px] -right-[5px] size-[10px] rounded-full bg-background"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -right-[5px] -bottom-[5px] size-[10px] rounded-full bg-background"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-3 right-0 border-r-2 border-dashed border-white/45"
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 px-3 py-2">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="line-clamp-2 text-[13px] leading-[17px] font-semibold text-foreground">
                      {voucher.title}
                    </p>
                    <p className="truncate text-[11px] leading-[15px] text-muted-foreground">
                      {secondLine(voucher)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[10.5px] leading-4 text-muted-foreground">
                      {expiryLabel(voucher)}
                    </span>
                    <VoucherActionPill
                      voucher={voucher}
                      collected={collected}
                      pending={pendingId === voucher.id}
                      href={signedIn && csrf !== null ? undefined : signInHref(returnTo, voucher.id)}
                      onCollect={() => {
                        void collect(voucher);
                      }}
                    />
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={listOpen}
        onOpenChange={setListOpen}
        title="Vouchers"
        description="Collect a voucher here, then choose it at checkout."
        side={wide ? 'center' : 'bottom'}
        className={wide ? 'max-w-2xl' : undefined}
      >
        <ul role="list" className="grid gap-3 pb-1">
          {applicable.map((voucher) => (
            <li key={voucher.id}>
              <VoucherCard
                voucher={stateOf(voucher)}
                csrf={csrf}
                signedIn={signedIn}
                returnTo={collectReturnPath(returnTo, voucher.id)}
                showDescription
                onCollected={() => {
                  setCollected((previous) => new Set(previous).add(voucher.id));
                  setToast({ tone: 'success', message: 'Voucher collected' });
                }}
              />
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-border pt-4 text-center text-sm text-muted-foreground">
          <Link
            href="/vouchers"
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            Open the Voucher Center
          </Link>{' '}
          to see every voucher and the ones you collected.
        </p>
      </Dialog>

      {toast === null ? null : <Toast tone={toast.tone}>{toast.message}</Toast>}
    </section>
  );
}

/**
 * The ticket's action, in the same two styles the Voucher Center uses: a filled Collect pill
 * and an outlined Use. A voucher this account already collected offers Use, which follows the
 * store's existing voucher path (its qualifying category or product); a guest's Collect is a
 * sign-in link that returns to this page and finishes the collection; a voucher that has not
 * opened yet says so and is not clickable. The pill is 28px tall with a 44px press area.
 */
function VoucherActionPill({
  voucher,
  collected,
  pending,
  href,
  onCollect,
}: {
  voucher: Voucher;
  collected: boolean;
  pending: boolean;
  /** A guest's press is a sign-in link rather than a collection. */
  href?: Route;
  onCollect: () => void;
}): ReactNode {
  const base =
    "relative inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[11px] font-semibold whitespace-nowrap transition-colors before:absolute before:-inset-x-2 before:-inset-y-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  if (collected) {
    return (
      <Link
        href={voucherUsePath(voucher) as Route}
        className={cn(base, 'border border-primary text-primary hover:bg-primary hover:text-white')}
      >
        Use
      </Link>
    );
  }
  if (voucher.state === 'upcoming') {
    return (
      <span className={cn(base, 'cursor-default bg-surface-muted text-muted-foreground')}>
        Soon
      </span>
    );
  }
  if (href !== undefined) {
    return (
      <Link
        href={href}
        aria-label="Collect voucher"
        className={cn(base, 'bg-primary-action text-primary-action-foreground hover:bg-primary-action-hover')}
      >
        Collect
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label="Collect voucher"
      aria-busy={pending}
      disabled={pending}
      onClick={onCollect}
      className={cn(
        base,
        'bg-primary-action text-primary-action-foreground hover:bg-primary-action-hover disabled:opacity-70',
      )}
    >
      {pending ? 'Collecting…' : 'Collect'}
    </button>
  );
}

function Toast({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-medium text-white shadow-lg sm:bottom-8',
        tone === 'success' ? 'bg-brand-navy' : 'bg-red-600',
      )}
    >
      {children}
    </div>
  );
}
