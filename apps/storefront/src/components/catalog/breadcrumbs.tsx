import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

export interface Crumb {
  label: string;
  /** Omitted for the current page, the last crumb. */
  href?: Route;
}

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            {item.href ? (
              <Link
                href={item.href}
                className="rounded-sm underline-offset-4 hover:text-foreground hover:underline pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:min-w-11 pointer-coarse:py-3 pointer-coarse:text-center"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
