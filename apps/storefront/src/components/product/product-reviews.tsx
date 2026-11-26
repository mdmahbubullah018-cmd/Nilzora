import type { MyReview, ProductReviewsResponse, RatingSummary } from '@nilzora/contracts';
import { buttonClasses, cn } from '@nilzora/ui';
import { BadgeCheck, ChevronDown, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { CsrfField } from '../auth/form-kit';
import { formatLongDate } from '@/lib/format';
import { submitReviewAction } from '@/lib/review-actions';
import { ReviewForm } from './review-form';
import { ReviewGallery } from './review-gallery';
import { BusinessReply, ReviewVoteControl } from './review-response';

/*
 * Reviews on the product page: the rating summary, the published reviews, and — for a
 * customer who received this product and has not reviewed it — the form. Everything
 * shown here came from the API: only approved reviews are public, the average and the
 * star counts are counted from them, and their photos come only with them.
 */

const counts = new Intl.NumberFormat('en-IN');

function Stars({
  rating,
  className,
  size = 'sm',
}: {
  rating: number;
  className?: string;
  size?: 'sm' | 'lg';
}) {
  return (
    <span className={className} role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              size === 'lg' ? 'size-5' : 'size-4',
              star <= Math.round(rating) ? 'fill-amber-500 text-amber-500' : 'text-border-strong',
            )}
          />
        ))}
      </span>
    </span>
  );
}

/** The average, the count and one bar per star level, from the API's own tally. */
function RatingOverview({ summary }: { summary: RatingSummary }) {
  return (
    <section
      aria-label="Rating summary"
      className="grid gap-4 rounded-xl border border-border bg-surface-muted/50 p-4"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="font-display text-4xl leading-none font-semibold text-foreground tabular-nums">
          {summary.averageRating.toFixed(1)}
          <span className="text-base font-medium text-muted-foreground"> / 5</span>
        </p>
        <div className="grid gap-1.5 pb-0.5">
          <Stars rating={summary.averageRating} size="lg" />
          <p className="text-xs text-muted-foreground">
            {counts.format(summary.reviewCount)} {summary.reviewCount === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </div>
      <ul role="list" aria-label="Reviews by star rating" className="grid gap-1.5">
        {(['5', '4', '3', '2', '1'] as const).map((star) => {
          const count = summary.distribution[star] ?? 0;
          const percent = summary.reviewCount > 0 ? (count / summary.reviewCount) * 100 : 0;
          return (
            <li
              key={star}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
            >
              <span className="inline-flex items-center gap-1 text-foreground tabular-nums">
                {star}
                <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
                <span className="sr-only">{star === '1' ? ' star' : ' stars'}:</span>
              </span>
              <span
                aria-hidden="true"
                className="h-2 overflow-hidden rounded-full bg-surface-muted"
              >
                <span
                  className="block h-full rounded-full bg-amber-500"
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-right text-muted-foreground tabular-nums">
                {counts.format(count)}
                <span className="sr-only">{count === 1 ? ' review' : ' reviews'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface ProductReviewsProps {
  productId: string;
  slug: string;
  reviews: ProductReviewsResponse | undefined;
  mine: MyReview | undefined;
  csrf: CsrfField | undefined;
  /**
   * What the session lookup said, kept apart from `mine` on purpose: a read that failed is
   * not a visitor who is signed out, and only the latter may be offered a sign-in link.
   */
  viewer?: 'signed_in' | 'signed_out' | 'unknown' | undefined;
  /** The same page showing more reviews, when there are more than shown. */
  moreHref?: Route | undefined;
}

export function ProductReviews({
  productId,
  slug,
  reviews,
  mine,
  csrf,
  viewer = 'unknown',
  moreHref,
}: ProductReviewsProps) {
  const summary = reviews?.summary;
  const canWrite =
    mine !== undefined && mine.review === null && mine.eligible && csrf !== undefined;
  const shown = reviews?.reviews.length ?? 0;
  const signIn = `/login?next=${encodeURIComponent(`/products/${slug}#reviews`)}` as Route;

  return (
    <div className="grid gap-6">
      {reviews === undefined ? (
        <p className="text-sm text-muted-foreground">Reviews could not be loaded right now.</p>
      ) : null}

      {summary !== undefined && summary.reviewCount > 0 ? (
        <RatingOverview summary={summary} />
      ) : reviews !== undefined ? (
        <p className="text-sm text-muted-foreground">
          No reviews yet. Buyers can review a product once they receive it.
        </p>
      ) : null}

      {reviews !== undefined && shown > 0 ? (
        <ul className="grid min-w-0">
          {reviews.reviews.map((review) => (
            <li
              key={review.id}
              className="grid min-w-0 gap-2.5 border-t border-border py-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} />
                  {review.title ? (
                    <p className="text-sm font-semibold wrap-break-word text-foreground">
                      {review.title}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{formatLongDate(review.createdAt)}</p>
              </div>
              <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-line text-body">
                {review.body}
              </p>
              <ReviewGallery images={review.images} author={review.authorName} />
              {review.reply === null ? null : <BusinessReply reply={review.reply} />}
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 font-medium wrap-break-word text-foreground">
                  {review.authorName}
                </span>
                {review.verified ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <BadgeCheck aria-hidden="true" className="size-3.5 text-green-600" />
                      Verified purchase
                    </span>
                  </>
                ) : null}
              </p>
              <ReviewVoteControl
                reviewId={review.id}
                slug={slug}
                csrf={csrf}
                helpfulCount={review.helpfulCount}
                notHelpfulCount={review.notHelpfulCount}
                viewerVote={review.viewerVote}
                enabled={viewer === 'signed_in'}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {reviews !== undefined && moreHref && reviews.total > shown ? (
        <div className="grid justify-items-center gap-1">
          <Link
            href={moreHref}
            scroll={false}
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            <ChevronDown aria-hidden="true" />
            Show more reviews
          </Link>
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {counts.format(shown)} of {counts.format(reviews.total)}
          </p>
        </div>
      ) : null}

      {canWrite ? (
        <section className="grid gap-3 rounded-xl border border-border p-4">
          <h3 className="text-base font-semibold text-foreground">Write a review</h3>
          <p className="text-sm text-muted-foreground">
            You bought this product, so you can review it. Reviews appear once the store has checked
            them.
          </p>
          <ReviewForm productId={productId} slug={slug} csrf={csrf} action={submitReviewAction} />
        </section>
      ) : mine?.review != null ? (
        <section className="grid gap-1 rounded-xl border border-border p-4">
          <h3 className="text-base font-semibold text-foreground">Your review</h3>
          <p className="text-sm text-muted-foreground">
            {mine.review.status === 'approved'
              ? 'Published.'
              : mine.review.status === 'rejected'
                ? `Not published${mine.review.moderationNote ? `: ${mine.review.moderationNote}` : '.'}`
                : 'Waiting for the store to check it.'}
          </p>
        </section>
      ) : mine !== undefined && !mine.eligible ? (
        <p className="text-sm text-muted-foreground">
          You can review this product once an order containing it has been delivered.
        </p>
      ) : mine === undefined && viewer === 'signed_out' ? (
        <p className="text-sm text-muted-foreground">
          <Link href={signIn} className={buttonClasses({ variant: 'link', size: 'sm' })}>
            Sign in
          </Link>{' '}
          to review a product you received.
        </p>
      ) : mine === undefined ? (
        // Signed in (or unable to tell): never send this visitor to sign in for a read that
        // merely failed. Their review may well exist; the same address settles it.
        <p className="text-sm text-muted-foreground">
          We couldn’t check your review just now.{' '}
          <Link
            href={`/products/${slug}#reviews` as Route}
            className={buttonClasses({ variant: 'link', size: 'sm' })}
          >
            Try again
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
