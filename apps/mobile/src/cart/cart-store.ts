import { MAX_CART_LINES } from '@nilzora/contracts';
import {
  addToItems,
  countUnits,
  lineKey,
  NO_ITEMS,
  removeItem,
  sameItems,
  sanitizeItems,
  setItemQuantity,
  type AddOutcome,
  type CartItem,
  type CartLineRef,
} from './cart-items';

/*
 * Cart store
 * ----------
 * Framework-agnostic and persisted: the cart is a short list of {productId, quantity}
 * that survives restarts, for guests as well as signed-in customers. It holds no prices:
 * screens ask the API to price it (useCartQuote). Loading is tolerant (anything unusable
 * is dropped, never thrown) and a failed save never breaks the in-memory cart.
 * Members are plain closures so they can be passed around unbound, e.g. to
 * useSyncExternalStore or an onPress.
 */

/** Versioned, so a future format can migrate or discard this one deliberately. */
export const CART_STORAGE_KEY = 'nilzora.cart.v1';
const STORAGE_FORMAT = 1;

/**
 * Which lines the customer means to order now. Kept beside the cart rather than inside it, so
 * the cart's own payload keeps its shape: a device that never chose a selection simply orders
 * everything, exactly as it did before this existed.
 */
export const CART_SELECTION_KEY = 'nilzora.cart-selection.v1';

/** A full cart is about 2 KB; anything far beyond that is not something this app wrote. */
export const MAX_STORED_CART_LENGTH = 16_384;

/** The slice of AsyncStorage the cart needs. */
export interface CartStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface CartSnapshot {
  readonly items: readonly CartItem[];
  /** Units across all lines (the tab badge), not the number of lines. */
  readonly count: number;
  /** False until the saved cart has been read (or found unusable). */
  readonly hydrated: boolean;
  /** The line keys the customer has selected to order; always a subset of `items`. */
  readonly selected: ReadonlySet<string>;
}

/** Reads a saved cart. Returns null when the data is not a cart this app can use. */
export function parseStoredCart(raw: string): CartItem[] | null {
  if (raw.length > MAX_STORED_CART_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { v, items } = value as { v?: unknown; items?: unknown };
  if (v !== STORAGE_FORMAT || !Array.isArray(items)) return null;
  // A bad line is dropped on its own; the rest of the cart survives.
  return sanitizeItems((items as unknown[]).slice(0, MAX_CART_LINES * 2));
}

export function serializeCart(items: readonly CartItem[]): string {
  return JSON.stringify({
    v: STORAGE_FORMAT,
    items: items.map(({ productId, variantId, quantity }) =>
      // The variant key is written only when there is one, so a saved cart of simple
      // products keeps the shape earlier versions wrote.
      variantId ? { productId, variantId, quantity } : { productId, quantity },
    ),
  });
}

/** The saved selection: line keys, or null when this device has never made one. */
export function parseStoredSelection(raw: string | null): string[] | null {
  if (raw === null || raw.length > MAX_STORED_CART_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

export function serializeSelection(keys: Iterable<string>): string {
  return JSON.stringify([...keys]);
}

type Transform = (items: readonly CartItem[]) => readonly CartItem[];

export interface CartStore {
  getSnapshot: () => CartSnapshot;
  /** The listener runs after every change. */
  subscribe: (listener: () => void) => () => void;
  /** Reads the saved cart once; concurrent and repeated calls share one run. Never rejects. */
  hydrate: () => Promise<void>;
  /** Adds units, merging with that line. `limit`: see addToItems. */
  add: (
    productId: string,
    quantity?: number,
    limit?: number,
    variantId?: string | null,
  ) => AddOutcome;
  /** 0 removes the line; more than the line limit is held at the limit. */
  setQuantity: (productId: string, quantity: number, variantId?: string | null) => void;
  remove: (productId: string, variantId?: string | null) => void;
  /** Removes several lines at once: what an order took out of the cart. */
  removeMany: (refs: readonly CartLineRef[]) => void;
  /** Selects or deselects one line. Deselecting never removes anything from the cart. */
  setSelected: (key: string, selected: boolean) => void;
  /** Selects every line, or clears the selection; the cart itself is untouched either way. */
  setAllSelected: (selected: boolean) => void;
  clear: () => void;
  /**
   * Replaces the lines with the result of `transform` (re-validated: invalid or repeated
   * lines are dropped). For batch edits such as fixing every line the server flagged.
   */
  update: (transform: Transform) => void;
  /** Resolves when everything changed so far has been written (or failed to be). */
  flush: () => Promise<void>;
}

export interface CartStoreOptions {
  storage: CartStorage;
  key?: string;
  selectionKey?: string;
}

export function createCartStore({
  storage,
  key = CART_STORAGE_KEY,
  selectionKey = CART_SELECTION_KEY,
}: CartStoreOptions): CartStore {
  let snapshot: CartSnapshot = {
    items: NO_ITEMS,
    count: 0,
    hydrated: false,
    // Nothing is selected until the saved selection (or a saved cart) says otherwise.
    selected: new Set<string>(),
  };
  const listeners = new Set<() => void>();
  let hydration: Promise<void> | null = null;
  /** Edits made before the saved cart was read; replayed on top of it so none is lost. */
  let edits: Transform[] = [];
  let writeChain: Promise<void> = Promise.resolve();
  let writeQueued = false;

  /** The selection narrowed to the lines that still exist. */
  function pruneSelected(items: readonly CartItem[], selected: ReadonlySet<string>): Set<string> {
    const keys = new Set(items.map((item) => lineKey(item)));
    const next = new Set<string>();
    for (const key of selected) if (keys.has(key)) next.add(key);
    return next;
  }

  function publish(
    items: readonly CartItem[],
    hydrated: boolean,
    selected: ReadonlySet<string> = snapshot.selected,
  ): void {
    snapshot = { items, count: countUnits(items), hydrated, selected: pruneSelected(items, selected) };
    for (const listener of listeners) listener();
  }

  /** Writes the latest cart and selection, one write at a time. Edits made meanwhile share
   * the next write. */
  function schedulePersist(): void {
    if (writeQueued) return;
    writeQueued = true;
    writeChain = writeChain.then(async () => {
      writeQueued = false;
      try {
        await storage.setItem(key, serializeCart(snapshot.items));
        await storage.setItem(selectionKey, serializeSelection(snapshot.selected));
      } catch {
        // The cart keeps working in memory; the next change tries to save it again.
        console.warn('[nilzora] the cart could not be saved on this device');
      }
    });
  }

  function commit(transform: Transform): void {
    const next = transform(snapshot.items);
    if (next === snapshot.items || sameItems(next, snapshot.items)) return;
    if (snapshot.hydrated) schedulePersist();
    else edits.push(transform);
    publish(next, snapshot.hydrated);
  }

  async function load(): Promise<void> {
    let saved: readonly CartItem[] = NO_ITEMS;
    let storedSelection: string[] | null = null;
    try {
      const raw = await storage.getItem(key);
      if (raw !== null) {
        const parsed = parseStoredCart(raw);
        if (parsed === null) {
          // Unusable: forget it so it is not parsed again on every launch.
          void Promise.resolve()
            .then(() => storage.removeItem(key))
            .catch(() => undefined);
        } else {
          saved = parsed;
        }
      }
      storedSelection = parseStoredSelection(await storage.getItem(selectionKey));
    } catch {
      console.warn('[nilzora] the saved cart could not be read on this device');
    }
    const replay = edits;
    edits = [];
    const merged = sanitizeItems(
      replay.reduce<readonly CartItem[]>((acc, edit) => edit(acc), saved),
    );
    // A device that has never chosen a selection orders everything, exactly as before this
    // existed; a saved selection narrows that to the lines it names.
    const chosen =
      storedSelection === null
        ? new Set(merged.map((item) => lineKey(item)))
        : new Set(storedSelection);
    publish(merged, true, chosen);
    if (replay.length > 0) schedulePersist();
  }

  /** Selects (or clears) one line, keeping the snapshot's other fields as they are. */
  function selectLine(productId: string, variantId: string | null, selected: boolean): void {
    const key = lineKey({ productId, variantId });
    if (selected === snapshot.selected.has(key)) return;
    const next = new Set(snapshot.selected);
    if (selected) next.add(key);
    else next.delete(key);
    publish(snapshot.items, snapshot.hydrated, next);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate() {
      hydration ??= load();
      return hydration;
    },
    add(productId, quantity = 1, limit, variantId) {
      const { outcome } = addToItems(snapshot.items, productId, quantity, limit, variantId);
      if (outcome === 'added') {
        commit((items) => addToItems(items, productId, quantity, limit, variantId).items);
        // A line the customer just put in the cart is one they mean to buy, so it starts
        // selected — the same default every new line gets.
        selectLine(productId, variantId ?? null, true);
      }
      return outcome;
    },
    setQuantity: (productId, quantity, variantId) => {
      commit((items) => setItemQuantity(items, productId, quantity, variantId));
    },
    remove: (productId, variantId) => {
      commit((items) => removeItem(items, productId, variantId));
    },
    removeMany: (refs) => {
      if (refs.length === 0) return;
      commit((items) => refs.reduce<readonly CartItem[]>((acc, ref) => removeItem(acc, ref.productId, ref.variantId), items));
    },
    setSelected: (key, selected) => {
      if (selected === snapshot.selected.has(key)) return;
      const next = new Set(snapshot.selected);
      if (selected) next.add(key);
      else next.delete(key);
      publish(snapshot.items, snapshot.hydrated, next);
      if (snapshot.hydrated) schedulePersist();
    },
    setAllSelected: (selected) => {
      const next = selected
        ? new Set(snapshot.items.map((item) => lineKey(item)))
        : new Set<string>();
      publish(snapshot.items, snapshot.hydrated, next);
      if (snapshot.hydrated) schedulePersist();
    },
    clear: () => {
      commit(() => NO_ITEMS);
    },
    update: (transform) => {
      commit((items) => sanitizeItems(transform(items)));
    },
    flush: () => writeChain,
  };
}
