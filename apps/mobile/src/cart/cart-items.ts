import {
  cartItemSchema,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type CartItem,
} from '@nilzora/contracts';

/*
 * Cart contents
 * -------------
 * A cart is only product ids and quantities, never prices, names or stock: the API prices
 * it (POST /cart/quote). These pure functions are the whole rule set; the store applies
 * them and the contracts' limits (MAX_CART_LINES, MAX_LINE_QUANTITY) are enforced here
 * and again by the API.
 */

export type { CartItem };

const productIdSchema = cartItemSchema.shape.productId;
const variantIdSchema = cartItemSchema.shape.variantId;

/** A line's identity: one product may appear once per variant, and once without one. */
export interface CartLineRef {
  productId: string;
  variantId?: string | null | undefined;
}

export function lineKey(ref: CartLineRef): string {
  return `${ref.productId.toLowerCase()}:${(ref.variantId ?? '').toLowerCase()}`;
}

/** The variant id in canonical form, or undefined when the line names a simple product. */
function normalizeVariantId(variantId: string | null | undefined): string | undefined | null {
  if (variantId === null || variantId === undefined) return undefined;
  const id = variantId.toLowerCase();
  return variantIdSchema.safeParse(id).success ? id : null;
}

/** `at_limit`: the line already holds the most allowed, so nothing changed. */
export type AddOutcome = 'added' | 'at_limit' | 'cart_full' | 'invalid';

export const NO_ITEMS: readonly CartItem[] = Object.freeze([]);

function isValidQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_LINE_QUANTITY;
}

/** Product ids are compared case-insensitively; the canonical form is lower case. */
export function normalizeProductId(productId: string): string | null {
  const id = productId.toLowerCase();
  return productIdSchema.safeParse(id).success ? id : null;
}

/** Units in the cart (the badge number), not the number of lines. */
export function countUnits(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function sameItems(a: readonly CartItem[], b: readonly CartItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        other !== undefined && lineKey(other) === lineKey(item) && other.quantity === item.quantity
      );
    })
  );
}

/**
 * Keeps only valid lines: a UUID product id, a whole quantity from 1 to the line limit,
 * each product once (the first wins), at most MAX_CART_LINES lines. Anything else
 * is dropped rather than repaired. Safe for untrusted input (saved or tampered data).
 */
export function sanitizeItems(candidates: readonly unknown[]): CartItem[] {
  const items: CartItem[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (items.length >= MAX_CART_LINES) break;
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { productId, variantId, quantity } = candidate as Record<string, unknown>;
    if (typeof productId !== 'string') continue;
    const parsed = cartItemSchema.safeParse({
      productId: productId.toLowerCase(),
      variantId: typeof variantId === 'string' ? variantId.toLowerCase() : variantId,
      quantity,
    });
    if (!parsed.success) continue;
    const key = lineKey(parsed.data);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed.data);
  }
  return items;
}

/**
 * Adds units of a product, merging with its existing line. `limit` is the most the line
 * may hold: the product's `maxOrderQuantity` when the screen knows it, otherwise the
 * contract's line limit. A limit below 1 (nothing can be ordered) never adds.
 */
export function addToItems(
  items: readonly CartItem[],
  productId: string,
  quantity: number,
  limit: number = MAX_LINE_QUANTITY,
  variantId?: string | null,
): { items: readonly CartItem[]; outcome: AddOutcome } {
  const id = normalizeProductId(productId);
  const variant = normalizeVariantId(variantId);
  if (id === null || variant === null || !isValidQuantity(quantity) || !Number.isFinite(limit)) {
    return { items, outcome: 'invalid' };
  }
  const cap = Math.min(Math.trunc(limit), MAX_LINE_QUANTITY);
  if (cap < 1) return { items, outcome: 'at_limit' };

  const key = lineKey({ productId: id, variantId: variant });
  const existing = items.find((item) => lineKey(item) === key);
  if (existing) {
    if (existing.quantity >= cap) return { items, outcome: 'at_limit' };
    const merged = Math.min(existing.quantity + quantity, cap);
    return {
      items: items.map((item) => (lineKey(item) === key ? { ...item, quantity: merged } : item)),
      outcome: 'added',
    };
  }
  if (items.length >= MAX_CART_LINES) return { items, outcome: 'cart_full' };
  const added: CartItem = variant
    ? { productId: id, variantId: variant, quantity: Math.min(quantity, cap) }
    : { productId: id, quantity: Math.min(quantity, cap) };
  return { items: [...items, added], outcome: 'added' };
}

/**
 * Sets a line's quantity: 0 removes it, more than the line limit is held at the limit, and
 * anything that is not a whole number of at least 0 is ignored. Unknown products are ignored.
 */
export function setItemQuantity(
  items: readonly CartItem[],
  productId: string,
  quantity: number,
  variantId?: string | null,
): readonly CartItem[] {
  const id = normalizeProductId(productId);
  const variant = normalizeVariantId(variantId);
  if (id === null || variant === null || !Number.isInteger(quantity) || quantity < 0) return items;
  if (quantity === 0) return removeItem(items, id, variant);
  const key = lineKey({ productId: id, variantId: variant });
  const next = Math.min(quantity, MAX_LINE_QUANTITY);
  const existing = items.find((item) => lineKey(item) === key);
  if (!existing || existing.quantity === next) return items;
  return items.map((item) => (lineKey(item) === key ? { ...item, quantity: next } : item));
}

export function removeItem(
  items: readonly CartItem[],
  productId: string,
  variantId?: string | null,
): readonly CartItem[] {
  const key = lineKey({ productId, variantId });
  return items.some((item) => lineKey(item) === key)
    ? items.filter((item) => lineKey(item) !== key)
    : items;
}
