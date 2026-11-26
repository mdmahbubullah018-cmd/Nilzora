'use client';

import { MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { Alert, Button, CartGlyph } from '@nilzora/ui';
// Type-only: the session package is server-only, so client code must not import its values.
import type { FormState } from '@nilzora/web-session';
import { Minus, Plus, Zap } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { announceCartChange } from '@/lib/cart-events';
import { FormMessage, IDLE_STATE, type FormAction, type FormStatusProps } from '../auth/form-kit';

interface AddToCartFields {
  productId: string;
  /** The product's address: the cart action reads its options from the catalog with it. */
  productSlug?: string | undefined;
  /** The chosen variant; absent when the product sells as a single item. */
  variantId?: string | undefined;
  /** Shown instead of the buttons when the line cannot be added yet (e.g. no choice made). */
  blockedMessage?: string | undefined;
  /**
   * Most units one order may hold right now, from the API. It limits the quantity list
   * and goes along as a hint; the action and the API enforce the real limits.
   */
  maxOrderQuantity: number;
}
export type AddToCartFormViewProps = AddToCartFields & FormStatusProps;

/** The cart's new unit count from a successful add, when the action reported one. */
export function addedCount(state: FormState): number | undefined {
  if (state.status !== 'success') return undefined;
  const count = Number(state.values?.count);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function AddedMessage({ message }: { message: string }) {
  return (
    <Alert tone="success">
      {message}{' '}
      <Link href="/cart" className="font-semibold underline underline-offset-4">
        View your cart
      </Link>
    </Alert>
  );
}

/** A compact − / + stepper; the number goes with the form as `quantity`. */
export function QuantityStepper({
  limit,
  idPrefix = 'add-to-cart',
}: {
  limit: number;
  /** Prefix of the element ids, so a second stepper on the page (a sheet) never repeats them. */
  idPrefix?: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const step =
    'grid size-11 place-items-center rounded-full text-foreground transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40';
  return (
    <div className="flex items-center gap-4">
      <span id={`${idPrefix}-quantity-label`} className="text-sm font-medium text-foreground">
        Quantity
      </span>
      <div
        role="group"
        aria-labelledby={`${idPrefix}-quantity-label`}
        className="inline-flex items-center rounded-full border border-border-strong bg-surface p-0.5"
      >
        <button
          type="button"
          className={step}
          aria-label="Decrease quantity"
          disabled={quantity <= 1}
          onClick={() => {
            setQuantity((value) => Math.max(1, value - 1));
          }}
        >
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <output
          aria-live="polite"
          aria-describedby={`${idPrefix}-limit`}
          className="w-10 text-center text-base font-semibold text-foreground tabular-nums"
        >
          {quantity}
        </output>
        <button
          type="button"
          className={step}
          aria-label="Increase quantity"
          disabled={quantity >= limit}
          onClick={() => {
            setQuantity((value) => Math.min(limit, value + 1));
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
      <input type="hidden" name="quantity" value={quantity} />
    </div>
  );
}

/** Quantity, "Add to cart" and "Buy now". A product that cannot be ordered gets a disabled button. */
export function AddToCartFormView({
  productId,
  productSlug,
  variantId,
  blockedMessage,
  maxOrderQuantity,
  state,
  formAction,
  pending,
}: AddToCartFormViewProps) {
  const limit = Math.min(Math.max(Math.trunc(maxOrderQuantity) || 0, 0), MAX_LINE_QUANTITY);

  if (limit < 1) {
    // Both actions stay on screen, disabled, so the customer sees that buying is simply
    // waiting on something above — and the layout never jumps once they choose it.
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" disabled aria-describedby="add-to-cart-blocked" className="w-full">
            <CartGlyph size={18} />
            Add to cart
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled
            aria-describedby="add-to-cart-blocked"
            className="w-full border-brand-navy text-brand-navy opacity-60"
          >
            <Zap aria-hidden="true" />
            Buy now
          </Button>
        </div>
        <p
          id="add-to-cart-blocked"
          role="status"
          className="text-sm font-medium text-muted-foreground"
        >
          {blockedMessage ??
            'This product is out of stock right now, so it cannot be added to your cart. Please check back soon.'}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="productId" value={productId} />
      {productSlug === undefined ? null : (
        <input type="hidden" name="productSlug" value={productSlug} />
      )}
      {variantId === undefined ? null : <input type="hidden" name="variantId" value={variantId} />}
      <input type="hidden" name="limit" value={limit} />
      <QuantityStepper limit={limit} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="submit" size="lg" loading={pending} className="w-full">
          {pending ? null : <CartGlyph size={18} />}
          Add to cart
        </Button>
        <Button
          type="submit"
          name="intent"
          value="buy"
          size="lg"
          variant="outline"
          disabled={pending}
          className="w-full border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-brand-soft"
        >
          <Zap aria-hidden="true" />
          Buy now
        </Button>
      </div>
      <p id="add-to-cart-limit" className="text-xs text-muted-foreground">
        {limit === 1
          ? 'You can order 1 of this product at a time.'
          : `You can order up to ${limit} of this product at a time.`}
      </p>
      {state.status === 'success' && state.message ? (
        <AddedMessage message={state.message} />
      ) : (
        <FormMessage state={state} />
      )}
    </form>
  );
}

export function AddToCartForm({ action, ...fields }: AddToCartFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);

  // Each new result is a new object, so this runs once per successful add.
  useEffect(() => {
    if (state.status === 'success') announceCartChange(addedCount(state));
  }, [state]);

  return <AddToCartFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
