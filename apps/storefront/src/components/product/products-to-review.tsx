'use client';

import { REVIEW_REMINDER_DAYS, type ReviewableItem } from '@nilzora/contracts';
import { Badge, Button, Card, CardContent, Dialog } from '@nilzora/ui';
import { Star } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { CsrfField } from '@/components/auth/form-kit';
import { productHref } from '@/components/cart/cart-line';
import { ProductImage } from '@/components/catalog/product-image';
import { ProductVisual } from '@/components/catalog/product-visual';
import { formatLongDate } from '@/lib/format';
import { submitReviewAction } from '@/lib/review-actions';
import { ReviewForm } from './review-form';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long ago the parcel arrived, in whole days. Counted from calendar days rather than
 * elapsed hours so "delivered yesterday evening" is one day ago this morning, which is how a
 * customer counts it.
 */
export function daysSinceDelivery(deliveredAt: string, now: string): number {
  const arrived = Date.parse(deliveredAt);
  const today = Date.parse(now);
  if (Number.isNaN(arrived) || Number.isNaN(today)) return 0;
  return Math.max(0, Math.floor((today - arrived) / DAY_MS));
}

export function deliveredAgoLabel(days: number): string {
  if (days === 0) return 'Delivered today';
  if (days === 1) return 'Delivered yesterday';
  return `Delivered ${String(days)} days ago`;
}

/**
 * The products a customer received but has not reviewed. Each row is the whole way to write
 * the review — same form, same server action, same validation as the product page — and the
 * row leaves the list as soon as the server confirms the review, so no one is asked twice.
 *
 * Nothing is sent to the customer: the reminder is the section itself, which appears from the
 * day of delivery and marks the products that have been waiting longer than the store's
 * reminder window.
 */
export function ProductsToReview({
  items,
  csrf,
  now,
}: {
  items: readonly ReviewableItem[];
  csrf: CsrfField;
  /** The server's clock, so the "days ago" wording is the same on both renders. */
  now: string;
}) {
  const [reviewed, setReviewed] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<ReviewableItem | null>(null);

  const waiting = items.filter((item) => !reviewed.includes(item.productId));
  // The dialog stays mounted after the review is saved: the form still has photos to send,
  // and it reports their progress itself.
  if (waiting.length === 0 && open === null) return null;

  return (
    <>
      {waiting.length === 0 ? null : (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-1">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-foreground">
                <Star aria-hidden="true" className="size-5 fill-amber-500 text-amber-500" />
                Products to review
                <Badge tone="warning">{waiting.length}</Badge>
              </h2>
              <p className="text-sm text-muted-foreground">
                You received these, so your rating is the one other shoppers trust. You can review
                each one once.
              </p>
            </div>

            <ul className="grid divide-y divide-border">
              {waiting.map((item) => {
                const days = daysSinceDelivery(item.deliveredAt, now);
                const href = productHref(item.productSlug);
                const name = 'line-clamp-2 text-sm font-medium wrap-break-word text-foreground';
                return (
                  <li
                    key={item.productId}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {item.image === null ? (
                        <ProductVisual size="sm" className="shrink-0 shadow-none" />
                      ) : (
                        <ProductImage
                          image={item.image}
                          productName={item.productName}
                          decorative
                          className="size-14 shrink-0 rounded-lg shadow-sm"
                        />
                      )}
                      <div className="grid min-w-0 gap-0.5">
                        {href === null ? (
                          <p className={name}>{item.productName}</p>
                        ) : (
                          <Link
                            href={href}
                            className={`rounded-sm underline-offset-4 hover:underline ${name}`}
                          >
                            {item.productName}
                          </Link>
                        )}
                        {item.variantLabel === null ? null : (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {item.variantLabel}
                          </p>
                        )}
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <Link
                            href={`/account/orders/${item.orderNumber}`}
                            className="rounded-sm underline-offset-4 hover:underline"
                          >
                            Order {item.orderNumber}
                          </Link>
                          <span aria-hidden="true" className="hidden sm:inline">
                            ·
                          </span>
                          <time dateTime={item.deliveredAt}>{deliveredAgoLabel(days)}</time>
                          {days >= REVIEW_REMINDER_DAYS ? (
                            <Badge tone="neutral">Still waiting for your review</Badge>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOpen(item);
                      }}
                      aria-haspopup="dialog"
                      className="nz-btn-tinted justify-self-start"
                    >
                      <Star aria-hidden="true" className="size-4" />
                      Write a review
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        title={open === null ? 'Write a review' : `Review ${open.productName}`}
        description={
          open === null
            ? undefined
            : `Bought in order ${open.orderNumber}, delivered ${formatLongDate(open.deliveredAt)}.`
        }
        closeLabel="Close review form"
      >
        {open === null ? null : (
          <ReviewForm
            productId={open.productId}
            slug={open.productSlug}
            csrf={csrf}
            action={submitReviewAction}
            onSubmitted={() => {
              setReviewed((current) =>
                current.includes(open.productId) ? current : [...current, open.productId],
              );
            }}
          />
        )}
      </Dialog>
    </>
  );
}
