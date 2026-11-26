import { cn } from '@nilzora/ui';
import type { ReactNode } from 'react';

/** The width and spacing every catalog page shares. */
export function CatalogPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12',
        className,
      )}
    >
      {children}
    </div>
  );
}
