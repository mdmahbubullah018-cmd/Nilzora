import { useSyncExternalStore } from 'react';

/*
 * A product question, waiting to be written
 * -----------------------------------------
 * The website attaches the product a customer is looking at by handing its support widget a
 * `{ productId, subject }` request (apps/storefront/src/lib/support-events.ts) and keeps it
 * until the first message is sent. The app has no widget, so the same intent is held here: the
 * product screen records it and opens the support inbox, which reads it back as a composer.
 *
 * It lives at module scope because it has to survive the sign-in round trip. A guest who taps
 * "Ask about this product" reaches the support screen, is asked to sign in, and comes back to
 * /support — a screen's own state would be gone by then, and the product with it.
 */

export interface ProductQuestion {
  /** The published product the question is about; the API re-checks it before attaching it. */
  productId: string;
  /** The product's name, used as the conversation subject exactly as the website does. */
  productName: string;
}

let pending: ProductQuestion | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Remembers the product a customer wants to ask about, for the support inbox to pick up. */
export function askAboutProduct(question: ProductQuestion): void {
  pending = question;
  emit();
}

/** Drops the question, once it has been sent or the customer dismissed it. */
export function dismissProductQuestion(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ProductQuestion | null {
  return pending;
}

/** The pending question, read without subscribing (for tests and one-off checks). */
export function productQuestionSnapshot(): ProductQuestion | null {
  return pending;
}

/** The question waiting to be sent, or null. Re-renders the caller when it changes. */
export function useProductQuestion(): ProductQuestion | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
