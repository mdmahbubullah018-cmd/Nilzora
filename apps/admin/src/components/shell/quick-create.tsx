'use client';

import type { Permission } from '@nilzora/contracts';
import { buttonClasses, cn } from '@nilzora/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import { visibleCreateActions } from '@/lib/navigation';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/**
 * The top bar's "Create" menu: shortcuts to the create pages this account may use.
 * A native <details>, so it opens without JavaScript; renders nothing when the account
 * may create nothing.
 */
export function QuickCreate({ permissions }: { permissions: readonly Permission[] }) {
  const tx = useTx();
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);
  const actions = visibleCreateActions(permissions);
  if (actions.length === 0) return null;

  return (
    <details ref={ref} className="group relative" onToggle={onToggle}>
      <summary
        aria-label={tx("Create")}
        className={cn(
          buttonClasses({ size: 'sm' }),
          'h-9 cursor-pointer list-none rounded-xl px-3 [&::-webkit-details-marker]:hidden',
        )}
      >
        <Plus aria-hidden="true" className="transition-transform group-open:rotate-45" />
        <span className="hidden md:inline"><AutoText>Create</AutoText></span>
      </summary>
      <div className="nz-glass absolute top-full right-0 z-40 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-0.5 rounded-2xl border p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"><AutoText>Create new</AutoText></p>
        {actions.map(({ label, hint, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            className="flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-surface-muted"
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink ring-1 ring-info-line"
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="grid min-w-0 leading-tight">
              <span className="text-sm font-semibold text-foreground"><AutoText value={label} /></span>
              <span className="truncate text-xs text-muted-foreground"><AutoText value={hint} /></span>
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}
