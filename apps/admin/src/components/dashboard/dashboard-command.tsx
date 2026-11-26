import { cn } from '@nilzora/ui';
import { Boxes, Package, PackageCheck, PackageX, Users } from 'lucide-react';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { GlassPanel, MetricTile, ReadState, SectionCard } from '@/components/admin-kit';
import type { AdminRead } from '@/components/admin-kit/read';
import { formatCount, greetingFor } from '@/lib/format';
import type { Language } from '@/lib/language';
import type { CatalogueCounts } from './load-dashboard';
import { AutoText } from '@/components/i18n/translate';
import { FullDateText } from '@/components/i18n/format-text';

/*
 * The dashboard's opening strip: who is working, what is waiting, and (for reports) the
 * period being shown. Every figure comes from the page's own reads; the greeting falls
 * back to a neutral line when nothing is waiting. Creating things lives in the top bar's
 * Create menu, so it is not repeated here.
 */

export interface DashboardCommandBarProps {
  /** The signed-in account's name (already display-resolved). */
  viewerName: string;
  /** The page's clock, for the greeting and the date. */
  now: Date;
  /**
   * One line of real operational figures ("3 orders to confirm · 2 products low on
   * stock"); null when nothing is waiting.
   */
  waiting: string | null;
  /** Controls beside the greeting, e.g. the report period. */
  aside?: ReactNode;
  /** The reader's language, for the date and the greeting. */
  lang?: Language;
}

export function DashboardCommandBar({
  viewerName,
  now,
  waiting,
  aside,
  lang = 'en',
}: DashboardCommandBarProps) {
  const firstName = viewerName.split(/[\s@]/)[0] ?? viewerName;

  return (
    // `relative z-20` is not decoration: every panel on this page paints its own backdrop blur,
    // which makes each one a stacking context. Without an order of its own this bar's popover
    // (the custom date range) would sit *behind* the cards below it, since a later sibling always
    // wins between equal contexts. Its own layer keeps the open calendar on top.
    <GlassPanel className="relative z-20 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="grid min-w-0 gap-1">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            <FullDateText at={now} /> · <AutoText>Bangladesh time</AutoText>
          </p>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {greetingFor(now, lang)}, {firstName}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {waiting ?? <AutoText>Nothing is waiting for you right now.</AutoText>}
          </p>
        </div>
        {aside ? <div className="flex flex-wrap items-center gap-2"><AutoText value={aside} /></div> : null}
      </div>
    </GlassPanel>
  );
}

export interface CatalogueStripProps {
  /** Totals from the list endpoints, or the reason they could not be read. */
  catalogue: AdminRead<CatalogueCounts> | null;
  className?: string;
}

/**
 * How big the catalogue and the customer base are. Each tile links to the filtered list
 * it counts, and a tile the account may not read is left out rather than shown as zero.
 */
export function CatalogueStrip({ catalogue, className }: CatalogueStripProps) {
  if (!catalogue) return null;

  if (catalogue.kind !== 'ok') {
    if (catalogue.kind === 'signed_out') return null;
    return (
      <SectionCard title="Catalogue and customers" icon={Boxes} className={className}>
        <ReadState failure={catalogue.kind} permission="products.read" retryHref="/admin" compact />
      </SectionCard>
    );
  }

  const { products, activeProducts, outOfStock, customers } = catalogue.value;
  const tiles = [
    products === null
      ? null
      : {
          key: 'products',
          label: 'Products',
          value: formatCount(products),
          icon: Package,
          tone: 'primary' as const,
          hint: 'In the catalogue',
          href: '/admin/products' as Route,
        },
    activeProducts === null
      ? null
      : {
          key: 'active',
          label: 'On sale',
          value: formatCount(activeProducts),
          icon: PackageCheck,
          tone: 'success' as const,
          hint: 'Active and published',
          href: '/admin/products?status=active' as Route,
        },
    outOfStock === null
      ? null
      : {
          key: 'out',
          label: 'Out of stock',
          value: formatCount(outOfStock),
          icon: PackageX,
          tone: outOfStock > 0 ? ('danger' as const) : ('neutral' as const),
          hint: 'Needs restocking',
          href: '/admin/products?stock=out' as Route,
        },
    customers === null
      ? null
      : {
          key: 'customers',
          label: 'Customers',
          value: formatCount(customers),
          icon: Users,
          tone: 'violet' as const,
          hint: 'Accounts created',
          href: '/admin/customers' as Route,
        },
  ].filter((tile) => tile !== null);

  if (tiles.length === 0) return null;

  return (
    <section
      aria-label="Catalogue and customers"
      className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}
    >
      {tiles.map(({ key, ...tile }) => (
        <MetricTile key={key} {...tile} />
      ))}
    </section>
  );
}
