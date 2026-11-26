'use server';

import { MAX_LINE_QUANTITY } from '@nilzora/contracts';
import type { FormState } from '@nilzora/web-session';
import {
  addToCart,
  cartUnitCount,
  parseCart,
  removeFromCart,
  serializeCart,
  setCartQuantity,
  type CartEntry,
} from '@/lib/cart';
import { redirect } from 'next/navigation';
import {
  attributeGroups,
  requirementName,
  variantOrderable,
} from '@/components/catalog/variant-selection';
import { readProductForCart } from '@/lib/catalog';
import { mirrorLine } from '@/lib/saved-cart';
import { session } from '@/lib/session';

/*
 * Cart form actions. The cart is not privileged (product ids and quantities, priced
 * by the API on every view and again at checkout), so these accept same-origin posts
 * without a CSRF token: they run from cacheable catalog pages, which cannot carry a
 * per-browser token. Checkout, addresses and orders use full CSRF checks instead.
 * Each success reports the new unit count in values.count for the header badge.
 */

const EXPIRED: FormState = {
  status: 'error',
  message: 'This page has expired. Reload it and try again.',
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** The chosen variant of the line the form is about; absent for a simple product. */
function variantField(formData: FormData): string | undefined {
  const value = text(formData, 'variantId');
  return value === '' ? undefined : value;
}

/** A whole number from a form field, or undefined when absent or malformed. */
function wholeNumber(formData: FormData, name: string): number | undefined {
  const value = text(formData, name);
  return /^\d{1,3}$/.test(value) ? Number(value) : undefined;
}

async function save(
  entries: CartEntry[],
  message: string,
  changed?: { productId: string; variantId?: string; quantity: number },
): Promise<FormState> {
  if (entries.length === 0) await session.cartCookie.clear();
  else await session.cartCookie.set(serializeCart(entries));
  // The cookie is the cart; this only keeps the server's copy in step. It never throws.
  if (changed !== undefined) {
    const quantity =
      changed.quantity === 0
        ? 0
        : (entries.find(
            (entry) =>
              entry.productId === changed.productId && entry.variantId === changed.variantId,
          )?.quantity ?? 0);
    await mirrorLine(changed, quantity);
  }
  return { status: 'success', message, values: { count: String(cartUnitCount(entries)) } };
}

/** "1 item" / "3 items": part of each message, so a repeated add still reads as new. */
function units(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

const NOT_ADDED: FormState = {
  status: 'error',
  message: 'This product could not be added to your cart.',
};

/**
 * The catalog is the authority on what a product is sold as, so a line is checked against it
 * before the cookie is written: a product with variants only goes in as one of them, an
 * unknown or sold-out variant never does, and a product without variants never carries one.
 * The page's own selection UI is only a convenience (a hand-posted form skips it). When the
 * catalog cannot be read the line is not added: guessing "no variants" could put an
 * unchosen, unpriceable line in the cart.
 */
async function variantRefusal(
  productId: string,
  productSlug: string,
  variantId: string | undefined,
): Promise<FormState | undefined> {
  if (productSlug === '') return NOT_ADDED;
  const read = await readProductForCart(productSlug);
  if (read.kind === 'unavailable') {
    return {
      status: 'error',
      message:
        'We could not check this product’s options right now. Try again in a moment, or open the product page.',
    };
  }
  if (read.kind === 'missing') {
    return { status: 'error', message: 'This product is no longer available.' };
  }
  const product = read.value;
  if (product.id.toLowerCase() !== productId.toLowerCase()) return NOT_ADDED;
  if (product.variants.length === 0) {
    return variantId === undefined ? undefined : NOT_ADDED;
  }
  const groups = attributeGroups(product.variants);
  if (variantId === undefined) {
    const names = groups.map(requirementName);
    return {
      status: 'error',
      message:
        names.length === 0
          ? 'Choose your options first.'
          : `Choose ${names.length === 1 ? 'a' : 'your'} ${names.join(' and a ')} first.`,
    };
  }
  const variant = product.variants.find(
    (entry) => entry.id.toLowerCase() === variantId.toLowerCase(),
  );
  if (variant === undefined) {
    return {
      status: 'error',
      message: 'That option is not sold for this product. Choose another option.',
    };
  }
  if (!variantOrderable(variant)) {
    return { status: 'error', message: 'That option is sold out. Choose another option.' };
  }
  return undefined;
}

export async function addToCartAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await session.isSameOrigin())) return EXPIRED;
  // `limit` is the page's hint of the per-order limit; the API enforces the real one.
  const limit = wholeNumber(formData, 'limit') ?? MAX_LINE_QUANTITY;
  const refusal = await variantRefusal(
    text(formData, 'productId'),
    text(formData, 'productSlug'),
    variantField(formData),
  );
  if (refusal !== undefined) return refusal;
  const entries = parseCart(await session.cartCookie.get());
  const { entries: next, outcome } = addToCart(
    entries,
    text(formData, 'productId'),
    wholeNumber(formData, 'quantity') ?? 1,
    limit,
    variantField(formData),
  );
  if (outcome === 'invalid') {
    return { status: 'error', message: 'This product could not be added to your cart.' };
  }
  // "Buy now": the same add, then on to the existing checkout (which re-prices everything).
  const buyNow = text(formData, 'intent') === 'buy';
  if (outcome === 'at_limit') {
    if (buyNow) redirect('/checkout');
    return {
      status: 'error',
      message: 'Your cart already has the most of this product one order can hold.',
      values: { count: String(cartUnitCount(entries)) },
    };
  }
  if (outcome === 'cart_full') {
    return {
      status: 'error',
      message: 'Your cart is full. Remove an item before adding another product.',
    };
  }
  const saved = await save(
    next,
    `Added to your cart. It now holds ${units(cartUnitCount(next))}.`,
    {
      productId: text(formData, 'productId'),
      ...(variantField(formData) === undefined ? {} : { variantId: variantField(formData) }),
      quantity: wholeNumber(formData, 'quantity') ?? 1,
    },
  );
  if (buyNow && saved.status === 'success') redirect('/checkout');
  return saved;
}

export async function updateCartLineAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await session.isSameOrigin())) return EXPIRED;
  const quantity = wholeNumber(formData, 'quantity');
  if (quantity === undefined || quantity > MAX_LINE_QUANTITY) {
    return { status: 'error', message: 'Choose a quantity from the list.' };
  }
  const entries = parseCart(await session.cartCookie.get());
  return save(
    setCartQuantity(entries, text(formData, 'productId'), quantity, variantField(formData)),
    'Cart updated.',
    {
      productId: text(formData, 'productId'),
      ...(variantField(formData) === undefined ? {} : { variantId: variantField(formData) }),
      quantity,
    },
  );
}

export async function removeCartLineAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await session.isSameOrigin())) return EXPIRED;
  const entries = parseCart(await session.cartCookie.get());
  return save(
    removeFromCart(entries, text(formData, 'productId'), variantField(formData)),
    'Removed from your cart.',
    {
      productId: text(formData, 'productId'),
      ...(variantField(formData) === undefined ? {} : { variantId: variantField(formData) }),
      quantity: 0,
    },
  );
}
