'use client';

import { cn } from '@nilzora/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  addToSelection,
  readStoredSelection,
  SELECTION_CAP_MESSAGE,
  writeStoredSelection,
} from './bulk-logic';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The orders list's selection. It lives in this tab's sessionStorage, so it survives
 * paging and filtering (and a reload), and is capped at the bulk limit (100). Selecting
 * never does anything by itself: every bulk action is its own explicit, confirmed step.
 */

export interface OrderSelection {
  /** Selected order numbers, in the order they were selected. */
  selected: readonly string[];
  /** The order numbers on the page being shown. */
  pageOrders: readonly string[];
  isSelected: (orderNumber: string) => boolean;
  toggle: (orderNumber: string, on: boolean) => void;
  selectMany: (orderNumbers: readonly string[]) => void;
  deselectMany: (orderNumbers: readonly string[]) => void;
  clear: () => void;
  /** Set when a selection was cut short by the limit. */
  notice: string | null;
  dismissNotice: () => void;
}

const SelectionContext = createContext<OrderSelection | null>(null);

/** The selection, or null outside a selectable list. */
export function useOrderSelection(): OrderSelection | null {
  return useContext(SelectionContext);
}

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/*
 * The selection store: sessionStorage behind a small in-memory copy that React reads with
 * useSyncExternalStore (the server, and hydration, see an empty selection). The copy is
 * dropped when no list is mounted, so the next list reads storage afresh.
 */
const EMPTY: readonly string[] = [];
let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): readonly string[] {
  cache ??= readStoredSelection(sessionStore());
  return cache;
}

function serverSnapshot(): readonly string[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) cache = null;
  };
}

function store(next: readonly string[]): void {
  cache = next;
  writeStoredSelection(sessionStore(), next);
  for (const listener of listeners) listener();
}

export function OrderSelectionProvider({
  pageOrders,
  children,
}: {
  pageOrders: readonly string[];
  children: ReactNode;
}) {
  const selected = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [notice, setNotice] = useState<string | null>(null);

  const selectMany = useCallback((orderNumbers: readonly string[]) => {
    const { next, refused } = addToSelection(snapshot(), orderNumbers);
    store(next);
    setNotice(refused > 0 ? SELECTION_CAP_MESSAGE : null);
  }, []);

  const deselectMany = useCallback((orderNumbers: readonly string[]) => {
    const drop = new Set(orderNumbers);
    store(snapshot().filter((orderNumber) => !drop.has(orderNumber)));
    setNotice(null);
  }, []);

  const value = useMemo<OrderSelection>(() => {
    const set = new Set(selected);
    return {
      selected,
      pageOrders,
      isSelected: (orderNumber) => set.has(orderNumber),
      toggle: (orderNumber, on) => {
        if (on) selectMany([orderNumber]);
        else deselectMany([orderNumber]);
      },
      selectMany,
      deselectMany,
      clear: () => {
        store(EMPTY);
        setNotice(null);
      },
      notice,
      dismissNotice: () => setNotice(null),
    };
  }, [selected, pageOrders, notice, selectMany, deselectMany]);

  return (
    <SelectionContext.Provider value={value}>
      <AutoText value={children} />
    </SelectionContext.Provider>
  );
}

const CHECKBOX =
  'size-4.5 shrink-0 cursor-pointer accent-primary-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** One order's checkbox (rows and cards), with a label naming the order. */
export function OrderRowCheckbox({
  orderNumber,
  className,
}: {
  orderNumber: string;
  className?: string;
}) {
  const selection = useOrderSelection();
  if (!selection) return null;
  return (
    // A 40px target around a small native checkbox; the label names the order for screen readers.
    <label
      className={cn(
        'relative z-10 -m-2 inline-grid size-10 cursor-pointer place-items-center rounded-lg hover:bg-surface-muted',
        className,
      )}
    >
      <input
        type="checkbox"
        data-order-select=""
        className={CHECKBOX}
        aria-label={`Select order ${orderNumber}`}
        checked={selection.isSelected(orderNumber)}
        onChange={(event) => selection.toggle(orderNumber, event.currentTarget.checked)}
      />
    </label>
  );
}

/** The header checkbox: selects or clears every order on this page (mixed when some are). */
export function SelectPageCheckbox() {
  const tx = useTx();
  const selection = useOrderSelection();
  const ref = useRef<HTMLInputElement>(null);
  const onPage = selection?.pageOrders ?? [];
  const chosen = onPage.filter((orderNumber) => selection?.isSelected(orderNumber)).length;
  const all = onPage.length > 0 && chosen === onPage.length;
  const some = chosen > 0 && !all;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  if (!selection || onPage.length === 0) return null;
  return (
    <label className="-m-2 inline-grid size-10 cursor-pointer place-items-center rounded-lg hover:bg-surface-muted">
      <input
        ref={ref}
        type="checkbox"
        className={CHECKBOX}
        aria-label={tx('Select every order on this page')}
        aria-checked={some ? 'mixed' : all}
        checked={all}
        onChange={() => {
          if (all) selection.deselectMany(onPage);
          else selection.selectMany(onPage);
        }}
      />
    </label>
  );
}
