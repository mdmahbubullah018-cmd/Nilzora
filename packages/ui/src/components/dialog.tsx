'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

const placements = {
  center: 'm-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] rounded-xl',
  left: 'my-0 mr-auto ml-0 h-dvh max-h-dvh w-80 max-w-[calc(100%-3rem)]',
  right: 'my-0 mr-0 ml-auto h-dvh max-h-dvh w-96 max-w-[calc(100%-3rem)]',
  /*
   * A full-width panel pinned to the top of the viewport, for a menu that belongs to a header:
   * the caller sets the offset with the header's own height, so the panel opens directly beneath
   * the bar and the bar itself never moves. `bottom-auto` keeps it as tall as its content instead
   * of stretching to the viewport, since the UA lets a modal dialog pin both edges.
   */
  under: 'top-0 right-0 bottom-auto left-0 m-0 w-full max-w-none rounded-b-2xl',
  /*
   * A bottom sheet: pinned to the bottom edge, as wide as the screen on a phone and a centred
   * 36rem column from `sm`, never taller than 88% of the viewport (its body scrolls instead).
   */
  bottom:
    'top-auto right-0 bottom-0 left-0 m-0 mx-auto w-full max-w-none max-h-[min(88dvh,42rem)] rounded-t-3xl sm:w-[min(36rem,100%)]',
  /*
   * A promotional sheet: it rises from the bottom edge on a phone and becomes a centred card
   * from `sm` up, where there is room for one. The caller sizes the card (`className`).
   */
  sheet:
    'top-auto right-0 bottom-0 left-0 m-0 mx-auto w-full max-w-none max-h-[min(92dvh,46rem)] rounded-t-3xl sm:inset-0 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl',
} as const;

export type DialogSide = keyof typeof placements;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Keeps the title for screen readers but hides it visually. */
  hideTitle?: boolean;
  /**
   * Whether the dialog draws its own close control. Set false for a surface that supplies one of
   * its own inside the body (the promotional popup does), which also drops the header strip so
   * the content can reach the edges.
   */
  showClose?: boolean;
  /** Overrides the body's padding, for content that must fill the panel edge to edge. */
  bodyClassName?: string;
  /** Extra classes for the panel itself (its surface), e.g. a translucent glass finish. */
  panelClassName?: string;
  /**
   * `left` and `right` render a full-height side sheet; `under` is a header-anchored panel;
   * `bottom` is a sheet that rises from the bottom edge.
   */
  side?: DialogSide;
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Modal dialog built on the native <dialog> element, which provides focus
 * containment, an inert background, Escape handling and focus restoration.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  showClose = true,
  bodyClassName,
  panelClassName,
  side = 'center',
  footer,
  closeLabel = 'Close',
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // The panel fills the dialog box, so a click whose target is the dialog itself hit the backdrop.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) onOpenChange(false);
    };
    dialog.addEventListener('click', onBackdropClick);
    return () => dialog.removeEventListener('click', onBackdropClick);
  }, [onOpenChange]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      className={cn(
        'nz-dialog overflow-visible bg-transparent p-0 text-body backdrop:bg-brand-navy/50 backdrop:backdrop-blur-[2px] open:flex',
        /*
         * Enter and exit. A closed <dialog> is `display: none`, which would cut the exit short, so
         * `display` and `overlay` (the top layer) transition discretely: the box stays rendered
         * until the fade has finished. A browser without those transitions closes instantly, as
         * before. Nothing moves for a visitor who prefers reduced motion.
         */
        'transition-[opacity,translate,display,overlay] transition-discrete duration-200 ease-out motion-reduce:transition-none',
        // A sheet travels its own height on a phone (it comes up from the bottom edge) and the
        // short 8px rise once it is a centred card.
        side === 'sheet'
          ? 'starting:open:translate-y-full sm:starting:open:translate-y-2 not-open:translate-y-full sm:not-open:translate-y-2'
          : 'starting:open:translate-y-2 not-open:translate-y-2',
        'starting:open:opacity-0 not-open:opacity-0',
        'backdrop:transition-opacity backdrop:duration-200 motion-reduce:backdrop:transition-none starting:open:backdrop:opacity-0 not-open:backdrop:opacity-0',
        placements[side],
        className,
      )}
    >
      <div
        className={cn(
          'nz-dialog-panel flex max-h-full w-full flex-col overflow-hidden bg-surface shadow-xl',
          side === 'left' || side === 'right'
            ? 'h-full'
            : side === 'center'
              ? 'rounded-xl'
              : side === 'bottom'
                ? 'rounded-t-3xl'
                : side === 'sheet'
                  ? 'rounded-t-3xl sm:rounded-3xl'
                  : '',
          panelClassName,
        )}
      >
        {side === 'bottom' || side === 'sheet' ? (
          // The grabber: says "this is a sheet" (decorative; Escape, the close button and a tap
          // outside are the ways out). It belongs to the phone's sheet only.
          <span
            aria-hidden="true"
            className={cn(
              'mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border',
              side === 'sheet' && 'sm:hidden',
            )}
          />
        ) : null}
        <div
          className={cn(
            'flex items-start justify-between gap-4 px-5 pt-5 sm:px-6',
            !showClose && hideTitle && !description && 'hidden',
          )}
        >
          <div className={cn('grid gap-1', hideTitle && 'sr-only')}>
            <h2 id={titleId} className="font-display text-lg font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {showClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="-mt-1 -mr-2 ml-auto size-11 text-muted-foreground sm:size-9 pointer-coarse:size-11"
              aria-label={closeLabel}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <div className={cn('flex-1 overflow-y-auto', bodyClassName ?? 'px-5 py-4 sm:px-6')}>
          {children}
        </div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
