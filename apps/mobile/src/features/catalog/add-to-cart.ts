import { MAX_CART_LINES } from '@nilzora/contracts';
import { AccessibilityInfo } from 'react-native';
import type { AddOutcome } from '@/cart/cart-items';
import { itemCountLabel } from '@/lib/money';

/*
 * What to tell the customer after "Add to cart". The cart answers with an outcome and does
 * the clamping itself; this turns the outcome, how many were asked for, how many the cart
 * held before and the most one order may hold into words. Pure, so it is tested on its own.
 */

export interface AddFeedback {
  tone: 'success' | 'warning' | 'danger';
  message: string;
  /** Whether "View cart" helps: the cart holds this product, or is full and needs trimming. */
  offerCart: boolean;
}

export interface AddFeedbackInput {
  outcome: AddOutcome;
  /** Units the customer asked to add. */
  requested: number;
  /** Units of this product the cart held before. */
  before: number;
  /** The most one order may hold of this product (see orderableLimit). */
  limit: number;
}

export function describeAddOutcome({
  outcome,
  requested,
  before,
  limit,
}: AddFeedbackInput): AddFeedback {
  switch (outcome) {
    case 'added': {
      const after = Math.min(before + requested, limit);
      const added = after - before;
      if (added < requested) {
        return {
          tone: 'warning',
          message: `Added ${itemCountLabel(added)} to your cart. The most you can order is ${limit}, so you now have ${after}.`,
          offerCart: true,
        };
      }
      return {
        tone: 'success',
        message:
          before > 0
            ? `Added ${itemCountLabel(added)} to your cart. You now have ${after} of this product.`
            : `Added ${itemCountLabel(added)} to your cart.`,
        offerCart: true,
      };
    }
    case 'at_limit':
      return {
        tone: 'warning',
        message: `You already have ${before} in your cart. The most you can order is ${limit}.`,
        offerCart: true,
      };
    case 'cart_full':
      return {
        tone: 'warning',
        message: `Your cart is full (${MAX_CART_LINES} different products). Remove an item to add this one.`,
        offerCart: true,
      };
    case 'invalid':
      return {
        tone: 'danger',
        message: 'We could not add this product to your cart. Please try again.',
        offerCart: false,
      };
  }
}

/** Says `message` to a screen-reader user (both platforms), without moving focus. */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
