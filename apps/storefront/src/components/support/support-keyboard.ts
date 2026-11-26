import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

/*
 * The keyboard model of the floating reaction bar and actions menu
 * ----------------------------------------------------------------
 * Both are drawn in a portal at the end of <body>, so the browser's natural Tab order cannot
 * reach them from the message that opened them. They therefore follow the WAI-ARIA toolbar and
 * menu patterns instead:
 *
 * - Each widget is ONE tab stop (roving tabindex): the item that was focused last, or the first.
 *   The others are `tabindex="-1"` and are reached with the arrow keys.
 * - The arrow keys move focus; Home and End jump to the first and last item.
 * - Tab and Shift+Tab move between the widgets of the overlay (bar, then menu) and are trapped
 *   inside it by the overlay itself, until Escape or a choice closes it.
 */

/** What can take focus inside a bar or a menu. A disabled item is skipped. */
const ITEM_SELECTOR = 'button:not([disabled]), a[href], [role="menuitem"]:not([disabled])';

export function focusableItems(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
}

/** The element a widget's Tab key lands on: its roving stop, else its first item. */
export function tabStopOf(root: HTMLElement | null): HTMLElement | null {
  const items = focusableItems(root);
  return items.find((item) => item.tabIndex === 0) ?? items[0] ?? null;
}

export interface FocusMove {
  key: string;
  /** The focused item's position in the widget, or -1. */
  at: number;
  count: number;
  /** A `grid` has rows of `columns` items; a `vertical` list is one column. */
  orientation: 'grid' | 'vertical';
  columns?: number;
}

/**
 * Where an arrow key (or Home/End) moves to, or null when the key does nothing here.
 *
 * - Left and Right step one item, wrapping at the ends (a toolbar).
 * - Up and Down move a whole row in a grid and stay put at the first or last row; in a vertical
 *   menu they step one item and wrap.
 */
export function nextFocusIndex({
  key,
  at,
  count,
  orientation,
  columns = 1,
}: FocusMove): number | null {
  if (count <= 0) return null;
  const from = at < 0 ? 0 : at;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowRight':
      return orientation === 'vertical' ? null : (from + 1) % count;
    case 'ArrowLeft':
      return orientation === 'vertical' ? null : (from - 1 + count) % count;
    case 'ArrowDown': {
      if (orientation === 'vertical') return (from + 1) % count;
      const below = from + columns;
      return below < count ? below : null;
    }
    case 'ArrowUp': {
      if (orientation === 'vertical') return (from - 1 + count) % count;
      const above = from - columns;
      return above >= 0 ? above : null;
    }
    default:
      return null;
  }
}

/** Moves focus for an arrow key pressed inside `event.currentTarget`. */
export function moveFocusWithKeys(
  event: KeyboardEvent<HTMLElement>,
  orientation: 'grid' | 'vertical',
  columns?: number,
): void {
  const items = focusableItems(event.currentTarget);
  if (items.length === 0) return;
  const active = document.activeElement;
  const at = items.findIndex((item) => item === active || item.contains(active));
  // Space does not activate a link the way Enter does; a menu item that is one should.
  const current = items[at];
  if (event.key === ' ' && current instanceof HTMLAnchorElement) {
    event.preventDefault();
    current.click();
    return;
  }
  const next = nextFocusIndex({
    key: event.key,
    at,
    count: items.length,
    orientation,
    ...(columns === undefined ? {} : { columns }),
  });
  if (next === null) return;
  event.preventDefault();
  items[next]?.focus({ preventScroll: true });
}

/**
 * Roving tabindex for a bar or a menu. Give the widget's root a ref and pass it here, then put the
 * returned handler on the root's `onFocus`: after every render exactly one enabled item (the last
 * one focused, else the first) is the tab stop. The attribute is set on the DOM directly because
 * the items come and go with the widget's own state (a menu swaps to its report reasons, a busy
 * bar disables its buttons).
 */
export function useRovingItems<T extends HTMLElement>(
  root: RefObject<T | null>,
): (event: FocusEvent<T>) => void {
  const last = useRef<HTMLElement | null>(null);

  const apply = (element: HTMLElement | null) => {
    const items = focusableItems(element);
    const stop = last.current !== null && items.includes(last.current) ? last.current : items[0];
    for (const item of items) item.tabIndex = item === stop ? 0 : -1;
  };

  useLayoutEffect(() => {
    apply(root.current);
  });

  return (event) => {
    const target = event.target as Node;
    const hit = focusableItems(event.currentTarget).find(
      (item) => item === target || item.contains(target),
    );
    if (hit === undefined) return;
    last.current = hit;
    apply(event.currentTarget);
  };
}
