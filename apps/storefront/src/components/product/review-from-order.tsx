'use client';

import type { ReviewStatus } from '@nilzora/contracts';
import { Button, Dialog } from '@nilzora/ui';
import { CircleCheck, Star } from 'lucide-react';
import { useState } from 'react';
import type { CsrfField } from '@/components/auth/form-kit';
import { submitReviewAction } from '@/lib/review-actions';
import { ReviewForm } from './review-form';

const STATUS_WORDS: Record<ReviewStatus, string> = {
  pending: 'Your review is waiting for the store to check it.',
  approved: 'Your review is published.',
  rejected: 'Your review was not published.',
};

/**
 * "Rate this product" on a delivered order line. It opens the product page's own review form
 * — same fields, same server action, same validation — with the product already known, so the
 * customer never has to find the product again. Once the server confirms the review, the
 * button is replaced by the review's status, so the line never offers a review that exists.
 */
export function ReviewFromOrder({
  productId,
  productSlug,
  productName,
  csrf,
}: {
  productId: string;
  productSlug: string;
  productName: string;
  csrf: CsrfField;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <CircleCheck aria-hidden="true" className="size-3.5" />
        {STATUS_WORDS.pending}
      </p>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="justify-self-start"
      >
        <Star aria-hidden="true" className="size-4" />
        Rate this product
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Review ${productName}`}
        description="Your rating and review are shown once the store has checked them."
        closeLabel="Close review form"
      >
        <ReviewForm
          productId={productId}
          slug={productSlug}
          csrf={csrf}
          action={submitReviewAction}
          onSubmitted={() => {
            setSubmitted(true);
          }}
        />
      </Dialog>
    </>
  );
}

/** The line shown instead of the action when this product already has a review. */
export function ReviewAlreadySubmitted({ status }: { status: ReviewStatus }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
      {STATUS_WORDS[status]}
    </p>
  );
}
