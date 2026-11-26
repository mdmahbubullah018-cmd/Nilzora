import { cartItemSchema, MAX_CART_LINES, MAX_LINE_QUANTITY } from '@nilzora/contracts';

/*
 * The storefront cart is a short list of product ids, optional variant ids and quantities
 * kept in an HttpOnly cookie ("id:qty,id[variant]:qty"). It holds no prices: every page
 * that shows the cart asks the API to price it, and checkout prices it again inside the
 * order. A tampered cookie can only name products, variants and quantities, all validated
 * here and again by the API.
 *
 * The variant is written as "productId[variantId]" only when one was chosen, so a cart of
 * simple products keeps the exact format it had before variants existed.
 */

export interface CartEntry {
  productId: string;
  /** The chosen variant of a product that sells as options; absent for a simple product. */
  variantId?: string;
  quantity: number;
}

const productIdSchema = cartItemSchema.shape.productId;
const variantIdSchema = cartItemSchema.shape.variantId;

/** `uuid` optionally followed by `[uuid]`, then `:` and 1–3 digits. */
const ENTRY =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\])?:(\d{1,3})$/;

function validQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_LINE_QUANTITY;
}

/** A line's identity: one product may appear once per variant. */
export function cartLineKey(entry: { productId: string; variantId?: string }): string {
  return `${entry.productId.toLowerCase()}:${(entry.variantId ?? '').toLowerCase()}`;
}

/** Reads the cookie value; malformed, repeated or excess entries are dropped. */
export function parseCart(value: string | undefined): CartEntry[] {
  if (!value) return [];
  const entries: CartEntry[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    if (entries.length >= MAX_CART_LINES) break;
    const match = ENTRY.exec(part.trim());
    if (!match) continue;
    const productId = match[1] ?? '';
    const variantId = match[2];
    const quantity = Number(match[3]);
    if (!validQuantity(quantity)) continue;
    if (!productIdSchema.safeParse(productId).success) continue;
    if (variantId !== undefined && !variantIdSchema.safeParse(variantId).success) continue;
    const entry: CartEntry = variantId
      ? { productId, variantId, quantity }
      : { productId, quantity };
    const key = cartLineKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

export function serializeCart(entries: readonly CartEntry[]): string {
  return entries
    .map((entry) =>
      entry.variantId
        ? `${entry.productId}[${entry.variantId}]:${entry.quantity}`
        : `${entry.productId}:${entry.quantity}`,
    )
    .join(',');
}

/** `at_limit`: the line already holds the most allowed, so nothing changed. */
export type AddOutcome = 'added' | 'at_limit' | 'cart_full' | 'invalid';

/**
 * Adds units of a product (or of one of its variants), merging with that same line.
 * `limit` is the most the line may hold: the product's or variant's per-order limit.
 */
export function addToCart(
  entries: readonly CartEntry[],
  productId: string,
  quantity: number,
  limit: number = MAX_LINE_QUANTITY,
  variantId?: string,
): { entries: CartEntry[]; outcome: AddOutcome } {
  const id = productId.toLowerCase();
  const variant = variantId?.toLowerCase();
  const cap = Math.min(Math.max(Math.trunc(limit), 1), MAX_LINE_QUANTITY);
  if (!productIdSchema.safeParse(id).success || !validQuantity(quantity)) {
    return { entries: [...entries], outcome: 'invalid' };
  }
  // An unknown variant id would be priced as unavailable by the API; refuse it here.
  if (variant !== undefined && !variantIdSchema.safeParse(variant).success) {
    return { entries: [...entries], outcome: 'invalid' };
  }
  const key = cartLineKey({ productId: id, variantId: variant });
  const existing = entries.find((entry) => cartLineKey(entry) === key);
  if (existing && existing.quantity >= cap) return { entries: [...entries], outcome: 'at_limit' };
  if (existing) {
    return {
      entries: entries.map((entry) =>
        cartLineKey(entry) === key
          ? { ...entry, quantity: Math.min(entry.quantity + quantity, cap) }
          : entry,
      ),
      outcome: 'added',
    };
  }
  if (entries.length >= MAX_CART_LINES) return { entries: [...entries], outcome: 'cart_full' };
  const added: CartEntry = variant
    ? { productId: id, variantId: variant, quantity: Math.min(quantity, cap) }
    : { productId: id, quantity: Math.min(quantity, cap) };
  return { entries: [...entries, added], outcome: 'added' };
}

/** Sets a line's quantity; 0 removes the line. Unknown lines are ignored. */
export function setCartQuantity(
  entries: readonly CartEntry[],
  productId: string,
  quantity: number,
  variantId?: string,
): CartEntry[] {
  const key = cartLineKey({ productId, variantId });
  if (quantity === 0) return removeFromCart(entries, productId, variantId);
  if (!validQuantity(quantity)) return [...entries];
  return entries.map((entry) => (cartLineKey(entry) === key ? { ...entry, quantity } : entry));
}

export function removeFromCart(
  entries: readonly CartEntry[],
  productId: string,
  variantId?: string,
): CartEntry[] {
  const key = cartLineKey({ productId, variantId });
  return entries.filter((entry) => cartLineKey(entry) !== key);
}

/** Units in the cart, for the header badge. */
export function cartUnitCount(entries: readonly CartEntry[]): number {
  return entries.reduce((total, entry) => total + entry.quantity, 0);
}
