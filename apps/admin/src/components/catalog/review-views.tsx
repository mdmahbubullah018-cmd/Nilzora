import type { AdminReview, ReviewStatus } from '@nilzora/contracts';
import { MessageSquareQuote, SearchX, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Chip,
  FilterBar,
  FilterChips,
  Pagination,
  SearchFilter,
  Tabs,
  withQuery,
} from '@/components/admin-kit';
import type { StatusTone } from '@/components/admin-kit/status-tones';
import type { CsrfInput } from '@/components/auth/csrf-field';
/* @/lib/format */
import { EmptyPanel } from './catalog-ui';
import { ReviewModerationActions } from './review-moderation';
import { ReviewReplyEditor } from './review-reply';
import { DateTimeText } from '@/components/i18n/format-text';

/*
 * Customer product reviews awaiting a decision. This is separate from content
 * moderation: it is a shopper's rating and words about a product, not a product's
 * description. Only approved reviews are visible on the storefront.
 */

export const REVIEWS_PATH = '/admin/reviews' as Route;

const STATUS_STYLE: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Awaiting review', tone: 'warning' },
  approved: { label: 'Published', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

function StatusBadge({ status }: { status: ReviewStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <Chip tone={style.tone} dot>
      {style.label}
    </Chip>
  );
}

/** Five stars with the rating spoken for screen readers. */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${String(rating)} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          strokeWidth={1.75}
          className={
            star <= rating ? 'size-3.5 fill-warning text-warning' : 'size-3.5 text-border-strong'
          }
        />
      ))}
    </span>
  );
}

export interface ReviewFilters {
  status?: ReviewStatus | undefined;
  q?: string | undefined;
}

export function reviewListHref(filters: ReviewFilters, page = 1): Route {
  return withQuery(REVIEWS_PATH, {
    status: filters.status,
    q: filters.q,
    page: page > 1 ? page : undefined,
  });
}

export interface ReviewListViewProps {
  reviews: readonly AdminReview[];
  filters: ReviewFilters;
  page: number;
  total: number;
  totalPages: number;
  pageSize: number;
  csrf: CsrfInput;
}

export function ReviewListView({
  reviews,
  filters,
  page,
  total,
  totalPages,
  pageSize,
  csrf,
}: ReviewListViewProps) {
  return (
    <div className="grid gap-4">
      <Tabs
        label="Review status"
        current={filters.status ?? 'pending'}
        items={[
          {
            key: 'pending',
            label: 'Awaiting review',
            href: reviewListHref({ ...filters, status: 'pending' }),
          },
          {
            key: 'approved',
            label: 'Published',
            href: reviewListHref({ ...filters, status: 'approved' }),
          },
          {
            key: 'rejected',
            label: 'Rejected',
            href: reviewListHref({ ...filters, status: 'rejected' }),
          },
          {
            key: 'all',
            label: 'All reviews',
            href: reviewListHref({ ...filters, status: undefined }),
          },
        ]}
      />

      <FilterBar
        action={REVIEWS_PATH}
        label="Filter reviews"
        hidden={{ status: filters.status }}
        resetHref={REVIEWS_PATH}
      >
        <SearchFilter label="Search" defaultValue={filters.q} placeholder="Product name" />
      </FilterBar>
      {filters.q ? (
        <FilterChips
          chips={[
            {
              key: 'q',
              label: `“${filters.q}”`,
              removeHref: reviewListHref({ ...filters, q: undefined }),
            },
          ]}
          clearHref={REVIEWS_PATH}
        />
      ) : null}

      {reviews.length === 0 ? (
        <section className="nz-panel nz-panel-sheen rounded-2xl border">
          <EmptyPanel
            icon={filters.q ? SearchX : MessageSquareQuote}
            title={filters.q ? 'No reviews match this product' : 'Nothing waiting'}
            description={
              filters.status === 'pending' || filters.status === undefined
                ? 'New reviews from customers arrive here before they appear on the storefront.'
                : 'No review has this status yet.'
            }
            className="py-14"
          />
        </section>
      ) : (
        <ul aria-label="Reviews" className="nz-stagger grid gap-4">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="nz-panel nz-panel-sheen grid gap-4 rounded-2xl border p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={review.rating} />
                    <StatusBadge status={review.status} />
                    <span className="text-xs text-muted-foreground">
                      <DateTimeText value={review.createdAt} style="datetime" />
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {review.title ?? 'No title'}
                  </p>
                  <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-line text-body">
                    {review.body}
                  </p>
                  {review.images.length > 0 ? (
                    // The customer's own photos, so a moderator judges them in place. Each one
                    // opens at full size; the thumbnails are the media service's own variants.
                    <ul role="list" className="flex flex-wrap gap-2 pt-1">
                      {review.images.map((image) => (
                        <li key={image.id}>
                          <a
                            href={image.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="nz-tap block size-16 overflow-hidden rounded-lg border border-border ring-1 ring-border/60 transition-colors hover:border-primary/50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time */}
                            <img
                              src={image.thumbUrl}
                              alt={`Photo ${String(review.images.indexOf(image) + 1)} of the review`}
                              loading="lazy"
                              decoding="async"
                              className="size-full object-cover"
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="grid shrink-0 gap-0.5 text-xs text-muted-foreground sm:text-right">
                  <Link
                    href={`/admin/products/${review.productId}` as Route}
                    className="nz-tap max-w-48 truncate font-medium text-link underline-offset-4 hover:underline"
                  >
                    {review.productName}
                  </Link>
                  <span>{review.authorName ?? review.authorEmail ?? 'Account removed'}</span>
                </div>
              </div>

              {review.moderationNote ? (
                <p className="rounded-xl bg-neutral-soft px-3 py-2 text-xs text-body">
                  Note: {review.moderationNote}
                </p>
              ) : null}

              <ReviewModerationActions reviewId={review.id} status={review.status} csrf={csrf} />
              <ReviewReplyEditor
                reviewId={review.id}
                reply={review.reply}
                status={review.status}
                csrf={csrf}
              />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        noun="reviews"
        hrefFor={(next) => reviewListHref(filters, next)}
      />
    </div>
  );
}
