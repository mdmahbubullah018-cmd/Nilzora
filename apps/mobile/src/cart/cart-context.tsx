import type { CartLine } from '@nilzora/contracts';
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
import {
  lineKey,
  countUnits,
  type AddOutcome,
  type CartItem,
  type CartLineRef,
} from './cart-items';
import {
  applyCartFixes,
  planCartFixes,
  summarizeCartFixes,
  type CartFixSummary,
} from './cart-problems';
import { createCartStore, type CartStore } from './cart-store';

const CartContext = createContext<CartStore | undefined>(undefined);

export interface CartProviderProps {
  children: ReactNode;
  /** Tests inject a store backed by memory. The app uses AsyncStorage. */
  store?: CartStore;
}

/** Creates the persisted cart once and reads the saved cart when it mounts. */
export function CartProvider({ children, store: injected }: CartProviderProps) {
  const [store] = useState(() => injected ?? createCartStore({ storage: AsyncStorage }));

  useEffect(() => {
    void store.hydrate();
  }, [store]);

  return <CartContext.Provider value={store}>{children}</CartContext.Provider>;
}

export interface CartHandle {
  /** Product ids and quantities only; prices come from useCartQuote(). */
  items: readonly CartItem[];
  /** Units across all lines (the tab badge). */
  count: number;
  /** False until the saved cart has been read. Wait for it before showing "your cart is empty". */
  hydrated: boolean;
  /** The lines the customer means to order now, in cart order. */
  selectedItems: readonly CartItem[];
  /** Units across the selected lines. */
  selectedCount: number;
  /** Whether one line is selected; new lines start selected. */
  isSelected: (productId: string, variantId?: string | null) => boolean;
  /** Selects or deselects one line. Deselecting leaves the line in the cart. */
  setSelected: (productId: string, variantId: string | null, selected: boolean) => void;
  /** Selects every line, or clears the selection. */
  setAllSelected: (selected: boolean) => void;
  /** `limit`: the most this line may hold, usually the product's or variant's limit. */
  add: (
    productId: string,
    quantity?: number,
    limit?: number,
    variantId?: string | null,
  ) => AddOutcome;
  /** 0 removes the line. */
  setQuantity: (productId: string, quantity: number, variantId?: string | null) => void;
  remove: (productId: string, variantId?: string | null) => void;
  /** Removes exactly the lines an order took, leaving the rest of the cart untouched. */
  removeMany: (refs: readonly CartLineRef[]) => void;
  clear: () => void;
  /** Units of one product (and variant) in the cart; 0 when absent. */
  quantityOf: (productId: string, variantId?: string | null) => number;
  /**
   * Removes the lines the server marked unavailable or out of stock and lowers lines over
   * their stock or per-order limit, using the lines of the latest quote. Reports what changed.
   */
  fixProblems: (lines: readonly CartLine[]) => CartFixSummary;
}

/** The cart and the actions on it. Must be used inside <CartProvider>. */
export function useCart(): CartHandle {
  const store = useContext(CartContext);
  if (store === undefined) throw new Error('useCart() must be used inside <CartProvider>');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const fixProblems = useCallback(
    (lines: readonly CartLine[]): CartFixSummary => {
      const fixes = planCartFixes(lines);
      if (fixes.length > 0) store.update((items) => applyCartFixes(items, fixes));
      return summarizeCartFixes(fixes);
    },
    [store],
  );

  return useMemo(() => {
    const isSelected = (productId: string, variantId?: string | null) =>
      snapshot.selected.has(lineKey({ productId, variantId }));
    const selectedItems = snapshot.items.filter((item) => snapshot.selected.has(lineKey(item)));
    return {
      items: snapshot.items,
      count: snapshot.count,
      hydrated: snapshot.hydrated,
      selectedItems,
      selectedCount: countUnits(selectedItems),
      isSelected,
      setSelected: (productId: string, variantId: string | null, selected: boolean) => {
        store.setSelected(lineKey({ productId, variantId }), selected);
      },
      setAllSelected: store.setAllSelected,
      add: store.add,
      setQuantity: store.setQuantity,
      remove: store.remove,
      removeMany: store.removeMany,
      clear: store.clear,
      quantityOf: (productId: string, variantId?: string | null) => {
        const key = lineKey({ productId, variantId });
        return snapshot.items.find((item) => lineKey(item) === key)?.quantity ?? 0;
      },
      fixProblems,
    };
  }, [snapshot, store, fixProblems]);
}
