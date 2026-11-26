'use client';

import { MAX_LINE_QUANTITY, productVariantSchema } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
// Type-only: the session package is server-only, so client code must not import its values.
import type { FormState } from '@nilzora/web-session';
import { Check, Plus, SlidersHorizontal } from 'lucide-react';
import { startTransition, useActionState, useEffect, useState } from 'react';
import { addToCartAction } from '@/lib/cart-actions';
import { announceCartChange } from '@/lib/cart-events';
import { addedCount } from './add-to-cart-form';
import { QuickAddSheet, type QuickAddSheetContent } from './quick-add-sheet';
import type { ProductOptions } from './variant-selection';

const IDLE: FormState = { status: 'idle' };

/**
 * A card's list entry does not say whether the product has variants, so this asks the catalog
 * (through the options route) at the moment of the press. Anything short of a clear answer is a
 * failure: a product is never assumed to be variant-free.
 */
async function loadOptions(slug: string): Promise<ProductOptions | null> {
  try {
    const response = await fetch(`/api/catalog/product-options?slug=${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { product?: Partial<ProductOptions> } | null;
    const product = body?.product;
    const variants = productVariantSchema.array().safeParse(product?.variants);
    if (
      product === undefined ||
      typeof product.id !== 'string' ||
      typeof product.slug !== 'string' ||
      typeof product.name !== 'string' ||
      typeof product.priceMinor !== 'number' ||
      !variants.success
    ) {
      return null;
    }
    return { ...(product as ProductOptions), variants: variants.data };
  } catch {
    return null;
  }
}

/**
 * One unit into the cart from a product card, through the same action as the product
 * page (which checks the request's origin; the API prices and limits the cart).
 * It sits above the card's full-size link, so it stays its own tap target.
 *
 * A product without variants goes in with one press. A product with variants (even a single
 * one) opens a sheet to choose them first, and one whose options cannot be read right now is
 * not added at all: the sheet offers to try again or to open the product page.
 */
export function QuickAdd({
  productId,
  productSlug,
  productName,
  maxOrderQuantity,
}: {
  productId: string;
  productSlug: string;
  productName: string;
  maxOrderQuantity: number;
}) {
  const [state, action, pending] = useActionState(addToCartAction, IDLE);
  const [checking, setChecking] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The sheet stays mounted once opened, so closing it returns focus to this button.
  const [sheetUsed, setSheetUsed] = useState(false);
  const [content, setContent] = useState<QuickAddSheetContent>({ status: 'loading' });
  const [hasOptions, setHasOptions] = useState(false);
  // Which of the two ways of adding the latest result belongs to.
  const [source, setSource] = useState<'direct' | 'sheet'>('direct');
  // The result the sheet last reacted to: a successful add closes it (adjusted while rendering).
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === 'success') setSheetOpen(false);
  }

  useEffect(() => {
    if (state.status === 'success') announceCartChange(addedCount(state));
  }, [state]);

  const limit = Math.min(Math.max(Math.trunc(maxOrderQuantity) || 0, 0), MAX_LINE_QUANTITY);
  const added = state.status === 'success';
  const base =
    'relative z-10 inline-flex h-10 w-full max-sm:h-11 pointer-coarse:h-11 items-center justify-center gap-1.5 rounded-full border text-sm font-semibold transition-colors';

  if (limit < 1) {
    return (
      <button type="button" disabled className={cn(base, 'border-border text-muted-foreground')}>
        Sold out
      </button>
    );
  }

  /** No variants: exactly the one-press add the card always had. */
  const addPlain = () => {
    const data = new FormData();
    data.set('productId', productId);
    data.set('productSlug', productSlug);
    data.set('quantity', '1');
    data.set('limit', String(limit));
    setSource('direct');
    startTransition(() => {
      action(data);
    });
  };

  const resolve = async (): Promise<void> => {
    setChecking(true);
    const product = await loadOptions(productSlug);
    setChecking(false);
    if (product === null) {
      setContent({ status: 'error' });
      setHasOptions(true);
      setSheetUsed(true);
      setSheetOpen(true);
      return;
    }
    if (product.variants.length === 0 && product.id.toLowerCase() === productId.toLowerCase()) {
      setHasOptions(false);
      addPlain();
      return;
    }
    setHasOptions(true);
    setContent(
      // A different id than the card's means the answer is not about this product: not addable.
      product.id.toLowerCase() === productId.toLowerCase()
        ? { status: 'ready', product }
        : { status: 'error' },
    );
    setSheetUsed(true);
    setSheetOpen(true);
  };

  const retry = () => {
    setContent({ status: 'loading' });
    void (async () => {
      const product = await loadOptions(productSlug);
      const same = product !== null && product.id.toLowerCase() === productId.toLowerCase();
      if (same && product.variants.length === 0) {
        // Nothing to choose after all: the plain add is the right one.
        setSheetOpen(false);
        setHasOptions(false);
        addPlain();
        return;
      }
      setContent(same ? { status: 'ready', product } : { status: 'error' });
    })();
  };

  const busy = checking || pending;
  const inlineError =
    state.status === 'error' && state.message && source === 'direct' ? state.message : undefined;
  const sheetError =
    state.status === 'error' && state.message && source === 'sheet' ? state.message : undefined;

  return (
    <div className="relative z-10">
      <button
        type="button"
        disabled={busy}
        aria-haspopup={hasOptions ? 'dialog' : undefined}
        aria-label={hasOptions ? `Select options for ${productName}` : `Add ${productName} to cart`}
        onClick={() => {
          void resolve();
        }}
        className={cn(
          base,
          added
            ? 'border-success/40 bg-success/10 text-foreground'
            : 'border-border-strong bg-surface text-foreground hover:border-brand-navy hover:bg-brand-navy hover:text-brand-soft',
          busy && 'opacity-70',
        )}
      >
        {added ? (
          <Check aria-hidden="true" className="size-4" />
        ) : hasOptions ? (
          <SlidersHorizontal aria-hidden="true" className="size-4" />
        ) : (
          <Plus aria-hidden="true" className="size-4" />
        )}
        {pending
          ? 'Adding…'
          : checking
            ? 'Checking…'
            : added
              ? 'Added'
              : hasOptions
                ? 'Select options'
                : 'Add to cart'}
      </button>
      {inlineError ? (
        <p role="status" className="mt-1.5 text-xs text-red-700">
          {inlineError}
        </p>
      ) : (
        <span role="status" className="sr-only">
          {added ? `${productName} added to your cart` : ''}
        </span>
      )}
      {sheetUsed ? (
        <QuickAddSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          content={content}
          productName={productName}
          productSlug={productSlug}
          onRetry={retry}
          action={(data) => {
            setSource('sheet');
            action(data);
          }}
          pending={pending}
          error={sheetError}
        />
      ) : null}
    </div>
  );
}
