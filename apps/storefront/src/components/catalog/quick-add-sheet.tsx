'use client';

import { MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { Button, buttonClasses, CartGlyph, Dialog, Skeleton } from '@nilzora/ui';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { productHref } from '@/lib/catalog-query';
import { QuantityStepper } from './add-to-cart-form';
import { Price } from './price';
import { VariantOptions } from './variant-options';
import {
  attributeGroups,
  initialSelection,
  variantFor,
  variantOrderable,
  type ProductOptions,
} from './variant-selection';

/** What the sheet shows: options still loading, options that could not be read, or the options. */
export type QuickAddSheetContent =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; product: ProductOptions };

export interface QuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: QuickAddSheetContent;
  productName: string;
  productSlug: string;
  /** Tries to read the product's options again after a failure. */
  onRetry: () => void;
  /** The cart action, as `useActionState` hands it out: it takes the form's data. */
  action: (formData: FormData) => void;
  /** An add is in flight. */
  pending: boolean;
  /** Why the last add from this sheet was refused, in the action's own words. */
  error?: string | undefined;
}

/**
 * The choice a product with variants needs before it can go in the cart, opened from a product
 * card. It posts the exact variant to the same cart action as the product page, whose server
 * check is what actually refuses an add without one: nothing here picks a default for the
 * customer, and pressing "Add to cart" with something missing only points at it.
 */
export function QuickAddSheet({
  open,
  onOpenChange,
  content,
  productName,
  productSlug,
  onRetry,
  action,
  pending,
  error,
}: QuickAddSheetProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Select options"
      description={productName}
      closeLabel="Close options"
    >
      {/* Unmounted while closed, so every opening starts from a clean choice. */}
      {!open ? null : content.status === 'loading' ? (
        <div role="status" aria-live="polite" className="grid gap-4">
          <span className="sr-only">Loading options…</span>
          <Skeleton className="h-6 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-16 rounded-full" />
            <Skeleton className="h-11 w-16 rounded-full" />
            <Skeleton className="h-11 w-16 rounded-full" />
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      ) : content.status === 'error' ? (
        <div className="grid gap-4">
          <p role="alert" className="text-sm text-foreground">
            We could not load this product’s options, so it was not added to your cart.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={onRetry} className="w-full sm:w-auto">
              Try again
            </Button>
            <Link
              href={productHref(productSlug)}
              className={buttonClasses({ variant: 'outline', className: 'w-full sm:w-auto' })}
            >
              Select options on the product page
            </Link>
          </div>
        </div>
      ) : (
        <QuickAddOptions
          product={content.product}
          action={action}
          pending={pending}
          error={error}
        />
      )}
    </Dialog>
  );
}

function QuickAddOptions({
  product,
  action,
  pending,
  error,
}: {
  product: ProductOptions;
  action: (formData: FormData) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const variants = product.variants;
  const groups = useMemo(() => attributeGroups(variants), [variants]);
  // A product with a single variant has it chosen already; any other starts with nothing chosen.
  const [selected, setSelected] = useState(() => initialSelection(variants));
  const [attempted, setAttempted] = useState(false);

  const chosen = variantFor(variants, groups, selected);
  const complete = groups.length > 0 && groups.every((group) => selected[group.slug] !== undefined);
  const soldOut = chosen !== undefined && !variantOrderable(chosen);
  const limit = chosen ? Math.min(chosen.maxOrderQuantity, MAX_LINE_QUANTITY) : MAX_LINE_QUANTITY;
  const prefix = `quick-${product.id}`;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Without a complete, sold combination nothing is posted: the missing choice is pointed out.
    if (chosen === undefined || soldOut) {
      event.preventDefault();
      setAttempted(true);
    }
  };

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="grid gap-5">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="productSlug" value={product.slug} />
      {chosen === undefined ? null : <input type="hidden" name="variantId" value={chosen.id} />}
      <input type="hidden" name="limit" value={limit} />
      <Price
        priceMinor={chosen?.priceMinor ?? product.priceMinor}
        compareAtPriceMinor={chosen ? chosen.compareAtPriceMinor : product.compareAtPriceMinor}
        size="md"
        showSaving
      />
      {groups.length === 0 ? (
        <p role="alert" className="text-sm text-foreground">
          This product’s options cannot be chosen here.{' '}
          <Link
            href={productHref(product.slug)}
            className="font-semibold underline underline-offset-4"
          >
            Open the product page
          </Link>
        </p>
      ) : (
        <VariantOptions
          variants={variants}
          groups={groups}
          selected={selected}
          idPrefix={prefix}
          showRequired={attempted}
          requiredVerb="Select"
          invalid={attempted}
          onSelect={(next) => {
            setSelected(next);
          }}
        />
      )}
      {attempted && complete && chosen === undefined ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          This combination is not sold. Select another option.
        </p>
      ) : null}
      <QuantityStepper key={chosen?.id ?? 'none'} limit={limit} idPrefix={prefix} />
      <p id={`${prefix}-limit`} className="-mt-3 text-xs text-muted-foreground">
        {chosen === undefined
          ? 'Choose your options to see how many you can order.'
          : limit < 1
            ? 'This option is sold out right now.'
            : limit === 1
              ? 'You can order 1 of this product at a time.'
              : `You can order up to ${limit} of this product at a time.`}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={soldOut}
        aria-describedby={`${prefix}-limit`}
        className="w-full"
      >
        {pending ? null : <CartGlyph size={18} />}
        Add to cart
      </Button>
    </form>
  );
}
