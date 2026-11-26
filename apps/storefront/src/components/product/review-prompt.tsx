'use client';

import type { ReviewableItem } from '@nilzora/contracts';
import { Button, Dialog } from '@nilzora/ui';
import { Star } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ProductImage } from '@/components/catalog/product-image';
import { ProductVisual } from '@/components/catalog/product-visual';
import { IDLE_STATE, type CsrfField, type FormAction } from '@/components/auth/form-kit';
import { formatLongDate } from '@/lib/format';
import { submitReviewAction } from '@/lib/review-actions';
import { ReviewForm } from './review-form';

/*
 * "How was your order?" on the account page
 * -----------------------------------------
 * The server names at most one delivered product this account has not reviewed and has not been
 * asked to stop showing (GET /me/reviews/prompt). One quiet dialog asks about it: "Write a review"
 * opens the same form as everywhere else, "Not now" is recorded on the server so the same product
 * is not asked about again, on any device. My Orders keeps offering the review either way.
 */
export function ReviewPrompt({
  item,
  csrf,
  dismissAction,
}: {
  item: ReviewableItem;
  csrf: CsrfField;
  dismissAction: FormAction;
}) {
  const [open, setOpen] = useState(true);
  const [writing, setWriting] = useState(false);
  const [, dismiss, dismissing] = useActionState(dismissAction, IDLE_STATE);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      title={writing ? `Review ${item.productName}` : 'How was your order?'}
      description={
        writing
          ? `Bought in order ${item.orderNumber}, delivered ${formatLongDate(item.deliveredAt)}.`
          : undefined
      }
      closeLabel="Close"
    >
      {writing ? (
        <ReviewForm
          productId={item.productId}
          slug={item.productSlug}
          csrf={csrf}
          action={submitReviewAction}
        />
      ) : (
        <div className="grid gap-5">
          <div className="flex items-center gap-3">
            {item.image === null ? (
              <ProductVisual size="sm" className="shrink-0 shadow-none" />
            ) : (
              <ProductImage
                image={item.image}
                productName={item.productName}
                decorative
                className="size-16 shrink-0 rounded-lg"
              />
            )}
            <div className="grid min-w-0 gap-0.5">
              <p className="line-clamp-2 text-sm font-semibold text-foreground">
                {item.productName}
              </p>
              {item.variantLabel === null ? null : (
                <p className="line-clamp-1 text-xs text-muted-foreground">{item.variantLabel}</p>
              )}
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
                Delivered · order {item.orderNumber}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            You received this product. A short review helps other shoppers choose.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <form
              action={(formData: FormData) => {
                setOpen(false);
                dismiss(formData);
              }}
            >
              <input type="hidden" name={csrf.name} value={csrf.token} />
              <input type="hidden" name="productId" value={item.productId} />
              <Button type="submit" variant="outline" loading={dismissing} className="w-full">
                Not now
              </Button>
            </form>
            <Button
              type="button"
              onClick={() => {
                setWriting(true);
              }}
            >
              Write a review
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
