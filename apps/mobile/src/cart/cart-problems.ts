import type { CartLine } from '@nilzora/contracts';
import { lineKey, removeItem, setItemQuantity, type CartItem } from './cart-items';

/*
 * Cart problems
 * -------------
 * POST /cart/quote marks every line it cannot order as it is (`problem`) and says how many
 * units it could take (`availableQuantity`). These helpers turn that into plain words and
 * into the edits that make the cart orderable again. The app never decides stock or limits
 * itself; it only follows what the server said.
 */

/** The product's name, or a stand-in when it is no longer on sale (the API hides it). */
export function cartLineName(line: Pick<CartLine, 'name'>): string {
  return line.name ?? 'Product no longer available';
}

/** Why a line cannot be ordered as it is, in plain words; null when it can. */
export function cartLineProblemText(
  line: Pick<CartLine, 'problem' | 'availableQuantity'>,
): string | null {
  if (line.problem === null) return null;
  if (line.problem === 'variant_required') return 'Choose an option for this product';
  if (line.problem === 'variant_invalid') return 'That option is no longer sold';
  if (line.problem === 'unavailable' || line.availableQuantity === null) {
    return 'No longer available';
  }
  if (line.availableQuantity === 0) return 'Out of stock';
  if (line.problem === 'insufficient_stock') return `Only ${line.availableQuantity} left`;
  return `At most ${line.availableQuantity} per order`;
}

export type CartFix =
  | { action: 'remove'; productId: string; variantId: string | null; name: string | null }
  | {
      action: 'adjust';
      productId: string;
      variantId: string | null;
      name: string | null;
      from: number;
      to: number;
    };

export interface CartFixSummary {
  removed: number;
  adjusted: number;
}

/**
 * The edits that make a quoted cart orderable: lines that are gone or out of stock are
 * removed, lines over the stock or the per-order limit are lowered to what the server
 * can take. Lines without a problem are left alone.
 */
export function planCartFixes(lines: readonly CartLine[]): CartFix[] {
  const fixes: CartFix[] = [];
  for (const line of lines) {
    if (line.problem === null) continue;
    const available = line.availableQuantity;
    const variantId = line.variantId ?? null;
    if (
      line.problem === 'variant_required' ||
      line.problem === 'variant_invalid' ||
      line.problem === 'unavailable' ||
      available === null ||
      available < 1
    ) {
      fixes.push({ action: 'remove', productId: line.productId, variantId, name: line.name });
    } else if (available < line.quantity) {
      fixes.push({
        action: 'adjust',
        productId: line.productId,
        variantId,
        name: line.name,
        from: line.quantity,
        to: available,
      });
    }
  }
  return fixes;
}

/** Applies planned fixes to the cart. A line that changed since the quote is left as it is. */
export function applyCartFixes(
  items: readonly CartItem[],
  fixes: readonly CartFix[],
): readonly CartItem[] {
  let next = items;
  for (const fix of fixes) {
    if (fix.action === 'remove') {
      next = removeItem(next, fix.productId, fix.variantId);
    } else {
      const key = lineKey({ productId: fix.productId, variantId: fix.variantId });
      const current = next.find((item) => lineKey(item) === key);
      // Only lower a line that still holds the quantity the server flagged.
      if (current?.quantity === fix.from) {
        next = setItemQuantity(next, fix.productId, fix.to, fix.variantId);
      }
    }
  }
  return next;
}

export function summarizeCartFixes(fixes: readonly CartFix[]): CartFixSummary {
  return {
    removed: fixes.filter((fix) => fix.action === 'remove').length,
    adjusted: fixes.filter((fix) => fix.action === 'adjust').length,
  };
}

/** e.g. "2 items were removed and 1 was adjusted to what is available"; null when nothing changed. */
export function describeCartFixes({ removed, adjusted }: CartFixSummary): string | null {
  const parts: string[] = [];
  if (removed > 0) parts.push(`${removed} ${removed === 1 ? 'item was' : 'items were'} removed`);
  if (adjusted > 0) {
    parts.push(`${adjusted} ${adjusted === 1 ? 'was' : 'were'} lowered to what is available`);
  }
  return parts.length === 0 ? null : parts.join(' and ');
}
