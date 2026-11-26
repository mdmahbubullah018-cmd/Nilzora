'use client';

import { useEffect, useState, type RefObject, type SyntheticEvent } from 'react';

/**
 * Lets a native <details> popover (which opens and closes without JavaScript) also
 * close on Escape, returning focus to its <summary>, on a click outside it, and when
 * keyboard focus moves out of it. Spread `onToggle` onto the <details>.
 */
export function useDetailsDismiss(ref: RefObject<HTMLDetailsElement | null>): {
  open: boolean;
  onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const details = ref.current;
    const onPointerDown = (event: PointerEvent) => {
      if (details && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details) return;
      details.open = false;
      details.querySelector('summary')?.focus();
    };
    // Tabbing past the last item (or Shift+Tab before the summary) leaves the popover.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (details && next instanceof Node && !details.contains(next)) details.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    details?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      details?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, ref]);

  return {
    open,
    onToggle: (event) => setOpen(event.currentTarget.open),
    close: () => {
      const details = ref.current;
      if (!details) return;
      details.open = false;
      details.querySelector('summary')?.focus();
    },
  };
}
