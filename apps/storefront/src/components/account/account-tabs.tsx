'use client';

import { cn } from '@nilzora/ui';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

export interface AccountTab {
  href: string;
  label: string;
}

/**
 * The account's sections as one row of pills.
 *
 * On a phone the row is a rail: it scrolls sideways inside its own box (`.nz-tab-rail`), so
 * six sections never stretch the page wider than the screen, and the faded trailing edge
 * says more of them are there. From `sm` the pills simply wrap, and the rail's mask is
 * dropped.
 *
 * The current section is scrolled into view once after the first paint — a customer landing
 * on Support from a link sees Support, not the four sections before it — and the scroll is
 * instant, so nothing springs into place.
 */
export function AccountTabs({
  tabs,
  current,
  label,
}: {
  tabs: readonly AccountTab[];
  current: string;
  label: string;
}) {
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    // Only the rail scrolls; on wider screens the pills wrap and there is nothing to do.
    const rail = active.closest<HTMLElement>('.nz-tab-rail');
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const offset = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
    rail.scrollTo({ left: Math.max(0, offset), behavior: 'instant' });
  }, [current]);

  return (
    <nav ref={nav} aria-label={label} className="-mx-4 min-w-0 sm:mx-0">
      <ul
        role="list"
        className="nz-tab-rail flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {tabs.map((tab) => {
          const active = tab.href === current;
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href as never}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-200',
                  active
                    ? 'border-brand-navy bg-brand-navy text-white'
                    : 'border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-muted',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
