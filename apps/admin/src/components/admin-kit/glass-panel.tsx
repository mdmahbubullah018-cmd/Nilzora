import { cn } from '@nilzora/ui';
import type { ComponentProps } from 'react';

export interface GlassPanelProps extends ComponentProps<'div'> {
  /** Adds a hairline highlight along the top edge (light from above). */
  sheen?: boolean;
}

/**
 * A translucent panel for the few places where content should still hint at the canvas
 * behind it (page heroes, the top bar, summary strips). Deliberately restrained: the
 * surface stays near-opaque so text contrast never depends on the blur, and it falls
 * back to a solid panel where backdrop filters are unsupported or reduced transparency
 * is requested (see globals.css).
 */
export function GlassPanel({ sheen = true, className, ...props }: GlassPanelProps) {
  return (
    <div
      className={cn('nz-glass rounded-xl border', sheen && 'nz-panel-sheen', className)}
      {...props}
    />
  );
}
