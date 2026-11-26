'use client';

import type { RatingSummary } from '@nilzora/contracts';
import { Dialog } from '@nilzora/ui';
import { Star } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/*
 * Reviews on the product page live in a panel instead of a long section under the page, so
 * the product itself stays compact. The panel content is rendered on the server and handed
 * to this client shell: the API read, the summary and the form are the ones that were always
 * here, only their container is new. A trigger opens the same panel for every entry point.
 */

const counts = new Intl.NumberFormat('en-IN');

function reviewCount(summary: RatingSummary): string {
  return `${counts.format(summary.reviewCount)} ${summary.reviewCount === 1 ? 'review' : 'reviews'}`;
}

interface ReviewsContextValue {
  show: () => void;
  summary: RatingSummary | undefined;
}

const ReviewsContext = createContext<ReviewsContextValue | null>(null);

function useReviews(): ReviewsContextValue {
  const opened = useContext(ReviewsContext);
  if (opened === null) {
    throw new Error('Review triggers must be rendered inside ProductReviewsDrawer');
  }
  return opened;
}

/** What a screen reader hears on the trigger: the rating, when there is one. */
function triggerLabel(summary: RatingSummary | undefined): string {
  if (summary === undefined || summary.reviewCount === 0) return 'Reviews';
  return `Reviews · ${summary.averageRating.toFixed(1)} out of 5 · ${reviewCount(summary)}`;
}

/** The panel's subtitle, beside its title. */
function panelDescription(summary: RatingSummary | undefined): string {
  if (summary === undefined) return 'Reviews could not be loaded right now.';
  if (summary.reviewCount === 0) return 'No reviews yet.';
  return `${summary.averageRating.toFixed(1)} out of 5 · ${reviewCount(summary)}`;
}

export interface ProductReviewsDrawerProps {
  summary: RatingSummary | undefined;
  /** The server-rendered review content shown inside the panel. */
  panel: ReactNode;
  children: ReactNode;
}

/**
 * Wraps the product page. Children are the page itself; the drawer, its trigger and the
 * review panel sit beside them. `#reviews` in the address opens the panel, so the sign-in
 * return path and a shared link land on the reviews rather than the top of the page.
 */
export function ProductReviewsDrawer({ summary, panel, children }: ProductReviewsDrawerProps) {
  /*
   * A link ending in #reviews — the sign-in return path, or a shared one — starts with the
   * panel open. The address is read in the browser only: the server always renders the panel
   * closed and the markup is the same either way.
   */
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#reviews',
  );
  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const value = useMemo<ReviewsContextValue>(() => ({ show, summary }), [show, summary]);

  return (
    <ReviewsContext.Provider value={value}>
      {children}
      <ReviewsTrigger />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        side="right"
        title="Ratings & reviews"
        description={panelDescription(summary)}
        closeLabel="Close reviews"
        className="max-sm:w-full max-sm:max-w-full"
      >
        {panel}
      </Dialog>
    </ReviewsContext.Provider>
  );
}

/**
 * The compact entry into the reviews: a slim tab on the right edge, at every screen size. From the
 * large breakpoint the page leaves a matching gutter there; on a phone it is thin enough to sit
 * over the page margin, mid-screen, clear of the tab bar and the bottom controls.
 */
export function ReviewsTrigger() {
  const { show, summary } = useReviews();
  const label = triggerLabel(summary);

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-label={label}
        className="fixed top-1/2 right-0 z-30 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-xl border border-r-0 border-border bg-surface/95 px-2 py-3 text-foreground shadow-md backdrop-blur transition hover:bg-surface-muted active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
        data-slot="reviews-trigger"
      >
        <Star aria-hidden="true" className="size-4 fill-amber-500 text-amber-500" />
        <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180">
          Reviews
        </span>
      </button>
    </>
  );
}

/** The rating beside the product title: a quiet second way into the same panel. */
export function ReviewsSummaryButton() {
  const { show, summary } = useReviews();
  if (summary === undefined || summary.reviewCount === 0) return null;
  return (
    <button
      type="button"
      onClick={show}
      aria-haspopup="dialog"
      aria-label={`${summary.averageRating.toFixed(1)} out of 5 from ${reviewCount(summary)}. Open reviews.`}
      className="inline-flex items-center gap-2 justify-self-start rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="font-semibold text-foreground tabular-nums">
        {summary.averageRating.toFixed(1)}
      </span>
      <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
      <span>{reviewCount(summary)}</span>
    </button>
  );
}
