'use client';

import type { WishlistItem } from '@nilzora/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react';
import { mergeWishlistAction, setWishlistItemAction } from '@/lib/wishlist-actions';
import {
  guestWishlistServerSnapshot,
  guestWishlistSnapshot,
  subscribeGuestWishlist,
  writeGuestWishlist,
  type GuestEntry,
} from './guest-wishlist-store';

/*
 * The wishlist in the browser
 * ---------------------------
 * A signed-in customer's list lives in the database and arrives with the page. A guest's list
 * is kept in this browser only, so the heart works before signing in; on the first page that
 * knows the account, that local list is folded into it once and then cleared.
 *
 * Nothing here is trusted for ownership: a change is a Server Action that carries the session
 * (Origin and CSRF checked first), and the API decides whose list it is.
 */

/** What the heart needs to know about a product in order to save it. */
export interface WishlistTarget {
  id: string;
  slug: string;
}

/** A guest's saved products live in this browser; the store next to this file owns them. */
export type { GuestEntry } from './guest-wishlist-store';

export interface WishlistHandle {
  count: number;
  /** Whether this product is saved. Correct for guests and signed-in customers alike. */
  has: (product: WishlistTarget) => boolean;
  /** Saves or unsaves. Resolves to a message to show, or null when the change worked. */
  toggle: (product: WishlistTarget) => Promise<string | null>;
  /** The signed-in customer's saved products, newest first; empty for a guest. */
  items: readonly WishlistItem[];
  /** A guest's saved products, newest first. */
  guestItems: readonly GuestEntry[];
  /** True while a change for this product is on its way. */
  busy: (productId: string) => boolean;
  /** The last message to show, or null. */
  message: string | null;
  dismiss: () => void;
}

const WishlistContext = createContext<WishlistHandle | undefined>(undefined);

export interface WishlistProviderProps {
  children: ReactNode;
  /** The signed-in customer's list as the server read it; null for a guest. */
  initialItems: readonly WishlistItem[] | null;
  /** The hidden token the Server Action needs. */
  csrf: { name: string; token: string };
}

export function WishlistProvider({ children, initialItems, csrf }: WishlistProviderProps) {
  const signedIn = initialItems !== null;
  const [items, setItems] = useState<readonly WishlistItem[]>(initialItems ?? []);
  /** A guest's list lives outside React: this subscribes to it, including other tabs. */
  const guestEntries = useSyncExternalStore(
    subscribeGuestWishlist,
    guestWishlistSnapshot,
    guestWishlistServerSnapshot,
  );
  const [pending, setPending] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  /** One change per product at a time: a second tap while one runs is ignored, not queued. */
  const inFlight = useRef(new Set<string>());
  const merged = useRef(false);

  useEffect(() => {
    // Signed in: fold in what this browser saved as a guest, once, then forget it.
    if (!signedIn || merged.current) return;
    merged.current = true;
    const guest = guestWishlistSnapshot();
    if (guest.length === 0) return;
    const body = new FormData();
    body.set(csrf.name, csrf.token);
    body.set('slugs', guest.map((entry) => entry.slug).join('\n'));
    void mergeWishlistAction(body)
      .then((answer) => {
        if (!answer.ok) return;
        setItems(answer.items);
        writeGuestWishlist([]);
      })
      .catch(() => undefined);
  }, [csrf.name, csrf.token, signedIn]);

  const ids = useMemo(() => new Set(items.map((item) => item.productId)), [items]);
  const guestIds = useMemo(() => new Set(guestEntries.map((entry) => entry.id)), [guestEntries]);

  const has = useCallback(
    (product: WishlistTarget) => (signedIn ? ids.has(product.id) : guestIds.has(product.id)),
    [guestIds, ids, signedIn],
  );

  const toggle = useCallback(
    async (product: WishlistTarget): Promise<string | null> => {
      if (inFlight.current.has(product.id)) return null;
      inFlight.current.add(product.id);
      setPending((current) => [...current, product.id]);
      setMessage(null);

      const wasSaved = signedIn ? ids.has(product.id) : guestIds.has(product.id);

      if (!signedIn) {
        // A guest's list is this browser's: no request, and it survives a restart.
        const next = wasSaved
          ? guestEntries.filter((entry) => entry.id !== product.id)
          : [
              { id: product.id, slug: product.slug, savedAt: new Date().toISOString() },
              ...guestEntries,
            ];
        writeGuestWishlist(next);
        inFlight.current.delete(product.id);
        setPending((current) => current.filter((id) => id !== product.id));
        return null;
      }

      const body = new FormData();
      body.set(csrf.name, csrf.token);
      body.set('productId', product.id);
      if (wasSaved) body.set('intent', 'remove');

      try {
        const answer = await setWishlistItemAction(body);
        if (answer.ok) {
          startTransition(() => setItems(answer.items));
          return null;
        }
        const failed = answer.message ?? 'That could not be saved. Please try again.';
        setMessage(failed);
        return failed;
      } catch {
        const failed = 'Nilzora could not reach your wishlist. Please try again.';
        setMessage(failed);
        return failed;
      } finally {
        inFlight.current.delete(product.id);
        setPending((current) => current.filter((id) => id !== product.id));
      }
    },
    [csrf.name, csrf.token, guestEntries, guestIds, ids, signedIn],
  );

  const busy = useCallback((productId: string) => pending.includes(productId), [pending]);
  const dismiss = useCallback(() => setMessage(null), []);

  const value = useMemo<WishlistHandle>(
    () => ({
      count: signedIn ? items.length : guestEntries.length,
      has,
      toggle,
      items,
      guestItems: guestEntries,
      busy,
      message,
      dismiss,
    }),
    [busy, dismiss, guestEntries, has, items, message, signedIn, toggle],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

/** The wishlist, or undefined when the page is rendered without a provider. */
export function useWishlistOptional(): WishlistHandle | undefined {
  return useContext(WishlistContext);
}

export function useWishlist(): WishlistHandle {
  const wishlist = useContext(WishlistContext);
  if (wishlist === undefined) throw new Error('useWishlist() needs a WishlistProvider');
  return wishlist;
}
