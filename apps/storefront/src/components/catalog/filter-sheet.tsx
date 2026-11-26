'use client';

import { Button, cn, Dialog } from '@nilzora/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * The advanced filter panel: a compact settings button in the toolbar that opens the panel as a
 * side sheet on the shared native <dialog> (focus stays inside, Escape closes it, focus returns
 * to the button). Applying the filters or following a link inside closes it, as the listing
 * reloads behind it. The button is offered at every width; the panel it opens is the same one
 * the wide layout keeps beside the grid.
 */
export function FilterSheet({
  activeCount,
  children,
}: {
  /** How many filters are on, shown on the button. */
  activeCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-label={activeCount > 0 ? `Filters (${activeCount} on)` : 'Filters'}
        onClick={() => setOpen(true)}
        className={cn(
          'h-10 shrink-0 rounded-full px-3.5 pointer-coarse:h-11',
          activeCount > 0 ? 'border-primary bg-primary/8 text-primary' : 'nz-btn-tinted',
        )}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Filters
        {activeCount > 0 ? (
          <span
            aria-hidden="true"
            className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums"
          >
            {activeCount}
          </span>
        ) : null}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        side="right"
        panelClassName="nz-glass-panel sm:rounded-l-3xl"
      >
        <div
          onSubmitCapture={() => setOpen(false)}
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false);
          }}
        >
          {children}
        </div>
      </Dialog>
    </>
  );
}
