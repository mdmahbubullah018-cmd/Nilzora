import { cn } from '@nilzora/ui';
import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

export interface TabItem {
  key: string;
  label: string;
  /** The view's own address, with the page's other filters kept. */
  href: Route;
  /** An optional figure shown beside the label (a count the API returned). */
  count?: number;
  /** An optional glyph shown in a tinted chip, as the inbox tabs do. */
  icon?: LucideIcon;
}

export interface TabsProps {
  /** Names the view switch for assistive technology, e.g. "Order status". */
  label: string;
  items: readonly TabItem[];
  /** The key of the view in effect. */
  current: string;
  className?: string;
}

/**
 * A horizontal view switch for a list page (statuses, ledger views). Each tab is a
 * link with its own address, so it works without JavaScript, is shareable, and can be
 * opened in a new tab; the active tab carries aria-current.
 *
 * Drew as the workspace's outlined strip: a rounded card of options where the one in
 * effect is a raised surface with a tinted icon chip, matching the Communication tabs.
 * Scrolls sideways on phones rather than wrapping into several rows.
 */
export function Tabs({ label, items, current, className }: TabsProps) {
  return (
    <nav aria-label={label} className={cn('nz-scroll -mx-1 px-1', className)}>
      <ul className="nz-strip w-max min-w-full">
        {items.map((item) => {
          const active = item.key === current;
          const Icon = item.icon;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                scroll={false}
                className="nz-strip-item"
              >
                {Icon ? (
                  <span aria-hidden="true" className="nz-strip-chip">
                    <Icon className="size-3.5" strokeWidth={1.9} />
                  </span>
                ) : null}
                {item.label}
                {item.count === undefined ? null : (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      active
                        ? 'bg-primary-action text-primary-action-foreground'
                        : 'bg-surface-muted text-body',
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
