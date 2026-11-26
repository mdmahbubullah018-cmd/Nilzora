import { buttonClasses, Card, EmptyState } from '@nilzora/ui';
import { CloudOff, FilterX, Hourglass, RotateCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

export interface CatalogUnavailableProps {
  /** Why the catalog could not be read (see CatalogRead in lib/catalog). */
  kind: 'unavailable' | 'rate_limited';
  /** Where "Try again" leads: usually this same page. */
  retryHref: Route;
  /** What could not be loaded, e.g. "products". */
  subject?: string;
  /** "h1" when the notice is all the page shows (no other page heading). */
  titleAs?: 'p' | 'h1' | 'h2';
}

/** A calm notice in place of content when the API cannot answer right now. */
export function CatalogUnavailable({
  kind,
  retryHref,
  subject = 'the catalog',
  titleAs,
}: CatalogUnavailableProps) {
  const busy = kind === 'rate_limited';
  return (
    <Card>
      <EmptyState
        icon={busy ? Hourglass : CloudOff}
        titleAs={titleAs}
        title={busy ? 'Too many searches at once' : `We could not load ${subject}`}
        description={
          busy
            ? 'Please wait a few seconds, then try again.'
            : 'Nilzora could not be reached. Please try again in a moment.'
        }
        className="py-14"
        action={
          <Link href={retryHref} className={buttonClasses({ variant: 'outline' })}>
            <RotateCw aria-hidden="true" />
            Try again
          </Link>
        }
      />
    </Card>
  );
}

/** Nothing matches the chosen filters: say so, and offer the listing without them. */
export function NoFilteredResults({ clearHref }: { clearHref: Route }) {
  return (
    <Card>
      <EmptyState
        icon={FilterX}
        title="No products match these filters"
        description="Try a wider price range, another brand, or include products that are out of stock."
        className="py-14"
        action={
          <Link href={clearHref} className={buttonClasses({ variant: 'outline' })}>
            Clear filters
          </Link>
        }
      />
    </Card>
  );
}
