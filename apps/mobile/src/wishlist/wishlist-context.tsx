import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createWishlistStore, type WishlistEntry, type WishlistStore } from './wishlist-store';
import { useRemoteWishlist } from './use-remote-wishlist';

const WishlistContext = createContext<WishlistStore | undefined>(undefined);

export interface WishlistProviderProps {
  children: ReactNode;
  /** Tests inject a store backed by memory. The app uses AsyncStorage. */
  store?: WishlistStore;
}

/** Creates the device's wishlist once and reads the saved list when it mounts. */
export function WishlistProvider({ children, store: injected }: WishlistProviderProps) {
  const [store] = useState(() => injected ?? createWishlistStore({ storage: AsyncStorage }));

  useEffect(() => {
    void store.hydrate();
  }, [store]);

  return <WishlistContext.Provider value={store}>{children}</WishlistContext.Provider>;
}

export interface WishlistHandle {
  /** Newest first. */
  entries: readonly WishlistEntry[];
  /** Number of saved products (the tab badge). */
  count: number;
  /** False until the list in use has been read. */
  hydrated: boolean;
  has: (slug: string) => boolean;
  /**
   * Saves or unsaves a product; returns whether it is now saved. Pass the product id so a
   * signed-in account saves it to the server; without it the device list is used.
   */
  toggle: (slug: string, productId?: string) => boolean;
  remove: (slug: string) => void;
  /** True when the list belongs to the account and so follows the customer to the website. */
  synced: boolean;
  /** True while the account's list is arriving for the first time. */
  loading: boolean;
  /** The account's list could not be read; the device list keeps working. */
  failed: boolean;
  /** True while a change for this product is on its way. */
  busy: (productId: string) => boolean;
  /** The last message worth showing, or null. */
  message: string | null;
}

/**
 * The saved products and the actions on them.
 *
 * Signed in, the list is the account's (it follows the customer to the website and back);
 * otherwise it is this device's. A device list made before signing in is offered to the
 * account once, then cleared — the merge is idempotent in the database, so it never
 * duplicates anything.
 */
export function useWishlist(): WishlistHandle {
  const store = useContext(WishlistContext);
  if (store === undefined) throw new Error('useWishlist() must be used inside <WishlistProvider>');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // The device's slugs are offered to the account when someone signs in.
  const deviceSlugs = useMemo(() => snapshot.entries.map((entry) => entry.slug), [snapshot]);
  const remote = useRemoteWishlist(deviceSlugs);

  /** Drops the device's copy once its products belong to the account. */
  useEffect(() => {
    if (remote === null || remote.loading || remote.failed) return;
    if (snapshot.entries.length === 0) return;
    const accountSlugs = new Set(remote.slugs);
    const everythingSaved = snapshot.entries.every((entry) => accountSlugs.has(entry.slug));
    if (!everythingSaved) return;
    for (const entry of snapshot.entries) store.remove(entry.slug);
  }, [remote, snapshot, store]);

  const remove = useCallback(
    (slug: string) => {
      const item = remote?.items.find((entry) => entry.product?.slug === slug);
      if (remote !== null && item !== undefined) {
        void remote.toggle({ id: item.productId, slug });
        return;
      }
      store.remove(slug);
    },
    [remote, store],
  );

  const toggle = useCallback(
    (slug: string, productId?: string): boolean => {
      if (remote !== null && productId !== undefined) {
        const saved = remote.items.some((entry) => entry.productId === productId);
        void remote.toggle({ id: productId, slug });
        return !saved;
      }
      // Without a product id, or without an account, the device list is the list.
      return store.toggle(slug);
    },
    [remote, store],
  );

  const has = useCallback(
    (slug: string) => {
      if (remote !== null && !remote.loading && !remote.failed) {
        return remote.items.some((item) => item.product?.slug === slug);
      }
      return snapshot.entries.some((entry) => entry.slug === slug);
    },
    [remote, snapshot],
  );

  // The account's list wins once it has arrived; until then the device list is shown.
  const entries = useMemo<readonly WishlistEntry[]>(() => {
    if (remote === null || remote.loading || remote.failed) return snapshot.entries;
    return remote.items.flatMap((item) =>
      item.product === null
        ? []
        : [{ slug: item.product.slug, savedAt: item.savedAt } satisfies WishlistEntry],
    );
  }, [remote, snapshot.entries]);

  return useMemo(
    () => ({
      entries,
      count: entries.length,
      hydrated: remote === null ? snapshot.hydrated : !remote.loading,
      has,
      toggle,
      remove,
      synced: remote !== null && !remote.failed,
      loading: remote?.loading ?? false,
      failed: remote?.failed ?? false,
      busy: (productId: string) => remote?.busy(productId) ?? false,
      message: remote?.failed === true ? 'Your saved products could not be loaded just now.' : null,
    }),
    [entries, has, remote, snapshot.hydrated, toggle, remove],
  );
}

/**
 * The local store, for the few places that need it directly (tests and the sign-out path).
 * Screens should use `useWishlist()`.
 */
export function useWishlistStore(): WishlistStore {
  const store = useContext(WishlistContext);
  if (store === undefined) throw new Error('useWishlistStore() must be used inside <WishlistProvider>');
  return store;
}
