/*
 * One small event so that any button on any page can open the support widget.
 *
 * A React context would work too, but it would wrap the whole shop in a client boundary and
 * turn every cached page dynamic. A window event costs nothing, works from a server-rendered
 * page (the button that raises it is the only client part), and keeps the widget's state in
 * one place.
 */

export interface SupportOpenRequest {
  /** Opens one existing conversation instead of the list. */
  conversationId?: string;
  /** Order threads are started against an order number the customer owns. */
  orderNumber?: string;
  /** Product questions carry the product the customer is looking at. */
  productId?: string;
  subject?: string;
}

const EVENT = 'nilzora:support:open';

export function openSupport(request: SupportOpenRequest = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SupportOpenRequest>(EVENT, { detail: request }));
}

export function onOpenSupport(handler: (request: SupportOpenRequest) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<SupportOpenRequest>).detail ?? {});
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/*
 * Whether the support panel is open, mirrored from the widget.
 *
 * The widget stays the only owner of the panel's state; the tab bar just reads this mirror so
 * its Chat item can show the open state and never re-open a conversation the customer is
 * already reading. It costs one module boolean and a Set of listeners, not another chat model.
 */
let supportOpen = false;
const openListeners = new Set<() => void>();

export function setSupportOpenState(open: boolean): void {
  if (supportOpen === open) return;
  supportOpen = open;
  for (const listener of openListeners) listener();
}

export function supportOpenSnapshot(): boolean {
  return supportOpen;
}

export function subscribeSupportOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}
