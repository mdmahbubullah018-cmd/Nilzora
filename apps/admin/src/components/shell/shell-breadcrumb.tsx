'use client';

import { cn } from '@nilzora/ui';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeNavItem, workspaces, type Workspace } from '@/lib/navigation';
import { useCrumbTrail } from './page-crumbs';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** One level below the navigation item, e.g. an order number on its detail page. */
export interface Crumb {
  label: string;
  /** Omit for the current page (the last crumb). */
  href?: Route;
}

export interface ShellBreadcrumbProps {
  workspace: Workspace;
  /** Levels after the page's navigation item; the last one is the current page. */
  trail?: readonly Crumb[] | undefined;
}

const linkClass =
  'rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

/**
 * Where the page sits in the workspace (home › section › page), derived from the
 * navigation so pages need not repeat it; labels match the navigation and the pages'
 * titles. Pages deeper than a navigation item pass the extra levels as `trail`.
 */
export function ShellBreadcrumb({ workspace, trail: given }: ShellBreadcrumbProps) {
  const tx = useTx();
  const pathname = usePathname();
  // The persistent header gets the page's own levels from the page (see PageCrumbs).
  const published = useCrumbTrail();
  const trail = given ?? published;
  const config = workspaces[workspace];
  const match = activeNavItem(workspace, pathname);

  // Every route has one label: the workspace home is named by its navigation item
  // ("Overview", "Queue"), never by the workspace's name as well.
  const homeItem = config.groups
    .flatMap((group) => group.items)
    .find((i) => i.href === config.home);
  const crumbs: Crumb[] = [{ label: homeItem?.label ?? config.name, href: config.home }];
  if (match && match.item.href !== config.home) {
    crumbs.push({ label: match.item.label, href: match.item.href });
  }
  crumbs.push(...trail);

  const lastIndex = crumbs.length - 1;
  return (
    <nav aria-label={tx('Breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const current = index === lastIndex;
          return (
            <li
              key={`${crumb.label}-${String(index)}`}
              // On phones only the current page is shown; the rest stays for screen readers.
              className={cn('flex min-w-0 items-center gap-1.5', !current && 'max-sm:sr-only')}
            >
              {current ? (
                <span aria-current="page" className="truncate font-semibold text-foreground">
                  {crumb.label}
                </span>
              ) : crumb.href ? (
                <Link href={crumb.href} className={linkClass}>
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-muted-foreground">
                  <AutoText value={crumb.label} />
                </span>
              )}
              {current ? null : (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
