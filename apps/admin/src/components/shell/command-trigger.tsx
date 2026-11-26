'use client';

import { cn } from '@nilzora/ui';
import { Search } from 'lucide-react';
import { openCommandPalette, useModifierLabel } from './command-palette';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

export interface CommandTriggerProps {
  /** `rail` sits on the navy rail (an icon in the collapsed rail); `bar` in the top bar. */
  variant?: 'rail' | 'bar';
  className?: string;
}

/** Opens the command palette; shows its shortcut (Ctrl K, or ⌘K on Apple devices). */
export function CommandTrigger({ variant = 'bar', className }: CommandTriggerProps) {
  const tx = useTx();
  const modifier = useModifierLabel();
  const shortcut = `${modifier} K`;

  if (variant === 'rail') {
    return (
      <button
        type="button"
        onClick={openCommandPalette}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          'nz-rail-item relative flex h-10 w-full items-center gap-3 rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-sidebar-muted transition-colors hover:border-white/14 hover:bg-white/8 hover:text-sidebar-foreground',
          className,
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="nz-rail-label flex-1 truncate text-left"><AutoText>Search…</AutoText></span>
        <kbd className="nz-rail-wide rounded-md border border-white/12 px-1.5 font-sans text-[10px] font-semibold text-sidebar-muted">
          {shortcut}
        </kbd>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label={tx("Open the command palette")}
      aria-keyshortcuts="Control+K Meta+K"
      title={`Command palette (${shortcut})`}
      className={cn(
        'grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground',
        className,
      )}
    >
      <Search aria-hidden="true" className="size-[1.15rem]" strokeWidth={1.75} />
    </button>
  );
}
