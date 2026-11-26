'use client';

import { cn } from '@nilzora/ui';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/*
 * One filter chip with its own panel, used by every listing toolbar on the site.
 *
 * It exists because a panel drawn inside the toolbar row is clipped by that row's horizontal
 * scroll container and pushed off a phone's right edge — which is exactly why the price panel
 * used to open invisibly on mobile. The panel is therefore portalled to the page body:
 *
 *   phone   a bottom sheet pinned to the viewport, so nothing is ever cut off;
 *   640px+  a small card anchored under its chip, clamped inside the viewport.
 *
 * The controls it holds carry `form="<toolbar id>"`, so a submit still carries their values
 * even though the panel is not a DOM descendant of the form. Escape and a press outside close
 * it, and focus returns to the chip.
 */

const PANEL_WIDTH = 288;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(max-width: 639px)');
    if (query === undefined) return;
    const update = () => {
      setPhone(query.matches);
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);
  return phone;
}

export interface ChipMenuProps {
  /** The words on the chip itself. */
  label: string;
  /** The panel's heading, for screen readers and the sheet. */
  title: string;
  /** Marks the chip as narrowing the list. */
  active?: boolean;
  /** A short value shown instead of the label (already formatted). */
  value?: string | undefined;
  /** A count of selected options, shown as a badge. */
  count?: number;
  panelClassName?: string;
  /** Controlled open state, when the toolbar needs to know which panel is showing. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function ChipMenu({
  label,
  title,
  active = false,
  value,
  count,
  panelClassName,
  open: controlledOpen,
  onOpenChange,
  children,
}: ChipMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const phone = useIsPhone();
  const panelId = useId();

  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  // The card follows its chip: measured after paint, and again if the window moves under it.
  useLayoutEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const chip = trigger.current?.getBoundingClientRect();
      if (chip === undefined) return;
      const width = Math.min(PANEL_WIDTH, globalThis.innerWidth - 16);
      const left = Math.min(Math.max(chip.right - width, 8), globalThis.innerWidth - width - 8);
      setPosition({ top: chip.bottom + 8, left });
    };
    place();
    globalThis.addEventListener('resize', place);
    globalThis.addEventListener('scroll', place, true);
    return () => {
      globalThis.removeEventListener('resize', place);
      globalThis.removeEventListener('scroll', place, true);
    };
  }, [open, phone]);

  // Escape closes from anywhere; a press outside closes without stealing the press.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panel.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  // Focus moves into the panel when it opens, so the keyboard lands on the first choice.
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('input, button, a[href]');
    first?.focus({ preventScroll: true });
  }, [open]);

  const surface = open ? (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className={cn(
          'fixed inset-0 z-40 bg-brand-navy/40 backdrop-blur-[2px]',
          !phone && 'hidden bg-transparent backdrop-blur-none',
        )}
      />
      <div
        ref={panel}
        id={panelId}
        role="dialog"
        aria-label={title}
        style={phone || position === null ? undefined : { top: position.top, left: position.left }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-3xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl',
          'sm:inset-x-auto sm:bottom-auto sm:max-h-[min(70dvh,32rem)] sm:w-72 sm:rounded-2xl sm:p-3',
          panelClassName,
        )}
      >
        {phone ? (
          <div className="mb-2 flex items-center justify-between">
            <p className="font-display text-base font-semibold text-foreground">{title}</p>
            <button
              type="button"
              onClick={close}
              className="rounded-full px-3 py-1 text-sm font-semibold text-link"
            >
              Close
            </button>
          </div>
        ) : (
          <p className="sr-only">{title}</p>
        )}
        {children}
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen(!open);
        }}
        className={cn(
          'relative inline-flex h-8.5 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
          // The visible chip stays compact; the tap target still reaches 44px under a thumb.
          'before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[""]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          active
            ? 'border-primary bg-primary/8 text-primary'
            : 'border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary',
        )}
      >
        <span className="max-w-44 truncate">{value ?? label}</span>
        {count !== undefined && count > 0 ? (
          <span className="grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[11px] leading-4 font-semibold text-primary-foreground">
            {count}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 opacity-70 transition-transform', open && 'rotate-180')}
          strokeWidth={2}
        />
      </button>
      {surface === null ? null : createPortal(surface, document.body)}
    </>
  );
}
