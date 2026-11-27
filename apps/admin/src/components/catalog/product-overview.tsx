import type { AdminProductDetail, AdminVariant, SeoOverviewRow } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { CircleCheck, CircleDashed, CircleHelp, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { SectionCard } from '@/components/admin-kit/section-card';
import { Chip } from '@/components/admin-kit/chip';
import { AutoText } from '@/components/i18n/translate';

/*
 * The product page's overview aids: a row of links to its sections, and a launch checklist
 * worked out from what the API returned (never guessed). The checklist only reports; every
 * rule it names is enforced by the API and database where it matters.
 */

/** The anchors of the product page's sections, in page order. */
export const PRODUCT_ANCHORS = {
  basic: 'product-basic',
  media: 'product-media',
  pricing: 'product-pricing',
  inventory: 'product-inventory',
  sizeChart: 'product-size-chart',
  merchandising: 'product-merchandising',
  preview: 'product-preview',
  status: 'product-status',
  review: 'product-review',
  variants: 'product-variants',
  seo: 'product-seo',
  brand: 'product-brand',
  zones: 'product-zones',
} as const;

export type ProductAnchor = keyof typeof PRODUCT_ANCHORS;

/** A section's anchor target: a plain wrapper, so the shared section card stays as it is. */
export function Anchored({ id, children }: { id: ProductAnchor; children: ReactNode }) {
  return (
    <div id={PRODUCT_ANCHORS[id]} className="min-w-0 scroll-mt-24">
      {children}
    </div>
  );
}

const NAV_LABELS: Record<ProductAnchor, string> = {
  basic: 'Basic info',
  media: 'Media',
  pricing: 'Pricing',
  inventory: 'Inventory',
  sizeChart: 'Size chart',
  merchandising: 'Merchandising',
  preview: 'Preview',
  status: 'Status',
  review: 'Review',
  variants: 'Variants',
  seo: 'Search',
  brand: 'Brand',
  zones: 'Zones',
};

/** Links to the sections the page shows; scrolls sideways on a phone. */
export function ProductSectionNav({ sections }: { sections: readonly ProductAnchor[] }) {
  return (
    <nav aria-label="Product sections" className="nz-scroll -mx-1 overflow-x-auto px-1">
      <ul className="flex w-max gap-2 py-1">
        {sections.map((section) => (
          <li key={section}>
            <a
              href={`#${PRODUCT_ANCHORS[section]}`}
              className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-surface px-3.5 text-sm font-medium text-body transition-colors hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:min-h-11"
            >
              {NAV_LABELS[section]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface ChecklistItem {
  key: string;
  label: string;
  /** null: not known (the information could not be read). */
  done: boolean | null;
  /** What is missing or what it means, shown under the label. */
  detail: string;
  section: ProductAnchor;
}

/**
 * What a product needs before (and to stay) on sale, from the product, its variants and its
 * search metadata as the API returned them. `variants` and `seo` are undefined when they could
 * not be read; their items are then reported as unknown, never as done.
 */
export function launchChecklist(
  product: AdminProductDetail,
  variants: readonly AdminVariant[] | null | undefined,
  seo: SeoOverviewRow | null | undefined,
): ChecklistItem[] {
  const images = product.images;
  const described = images.filter((image) => (image.alt ?? '').trim() !== '').length;
  const onSaleVariants = variants?.filter((variant) => variant.isActive) ?? [];
  const items: ChecklistItem[] = [
    {
      key: 'summary',
      label: 'Summary for product cards',
      done: (product.summary ?? '').trim() !== '',
      detail: product.summary ? 'Shown under the name in listings.' : 'One or two sentences.',
      section: 'basic',
    },
    {
      key: 'description',
      label: 'Description',
      done: (product.description ?? '').trim() !== '',
      detail: product.description
        ? 'Materials, sizes, care and what is in the box.'
        : 'Shoppers read it under “Product details”.',
      section: 'basic',
    },
    {
      key: 'images',
      label: 'Pictures',
      done: images.length > 0,
      detail:
        images.length > 0
          ? `${String(images.length)} added; the first is the cover.`
          : 'Add at least one picture.',
      section: 'media',
    },
    {
      key: 'alt',
      label: 'Picture descriptions',
      done: images.length > 0 && described === images.length,
      detail:
        images.length === 0
          ? 'Describe each picture once it is added.'
          : `${String(described)} of ${String(images.length)} described for screen readers.`,
      section: 'media',
    },
  ];
  if (variants === undefined || variants === null) {
    items.push({
      key: 'stock',
      label: 'Stock to sell',
      done: variants === null ? null : product.stockQuantity > 0,
      detail:
        variants === null
          ? 'The variants could not be read.'
          : `${String(product.stockQuantity)} units on hand.`,
      section: 'inventory',
    });
  } else if (variants.length === 0) {
    items.push({
      key: 'stock',
      label: 'Stock to sell',
      done: product.stockQuantity > 0,
      detail: `${String(product.stockQuantity)} units on hand.`,
      section: 'inventory',
    });
  } else {
    const stocked = onSaleVariants.filter((variant) => variant.stockQuantity > 0).length;
    items.push({
      key: 'stock',
      label: 'Variant stock',
      done: onSaleVariants.length > 0 && stocked > 0,
      detail:
        onSaleVariants.length === 0
          ? 'Every variant is hidden: put at least one on sale.'
          : `${String(stocked)} of ${String(onSaleVariants.length)} variants on sale have stock.`,
      section: 'inventory',
    });
  }
  items.push(
    {
      key: 'seo',
      label: 'Search title and description',
      done: seo === undefined || seo === null ? null : !seo.missingTitle && !seo.missingDescription,
      detail:
        seo === undefined || seo === null
          ? 'The search metadata could not be read.'
          : seo.missingTitle || seo.missingDescription
            ? 'The product name and summary are used until they are written.'
            : seo.noIndex
              ? 'Written, but hidden from search engines.'
              : 'Written for search results and share previews.',
      section: 'seo',
    },
    {
      key: 'review',
      label: 'Content approved',
      done: product.moderationStatus === 'approved',
      detail:
        product.moderationStatus === 'approved'
          ? 'A moderator approved the content.'
          : product.moderationStatus === 'pending'
            ? 'Waiting for the moderator.'
            : 'Submit the content for review when it is ready.',
      section: 'review',
    },
    {
      key: 'live',
      label: 'On sale',
      done: product.status === 'active',
      detail:
        product.status === 'active'
          ? product.category.isActive
            ? 'Shoppers can see and order it.'
            : 'Published, but its category is hidden.'
          : product.status === 'archived'
            ? 'Archived and hidden from shoppers.'
            : 'A draft, hidden from shoppers.',
      section: 'status',
    },
  );
  return items;
}

const ICONS = { true: CircleCheck, false: CircleDashed, null: CircleHelp } as const;

export function LaunchChecklist({ items }: { items: readonly ChecklistItem[] }) {
  const done = items.filter((item) => item.done === true).length;
  return (
    <SectionCard
      title="Launch checklist"
      icon={ListChecks}
      actions={
        <Chip tone={done === items.length ? 'success' : 'neutral'}>
          {done} of {items.length} done
        </Chip>
      }
    >
      <ul className="grid gap-1">
        {items.map((item) => {
          const Icon = ICONS[String(item.done) as 'true' | 'false' | 'null'];
          return (
            <li key={item.key}>
              <a
                href={`#${PRODUCT_ANCHORS[item.section]}`}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 size-4.5 shrink-0',
                    item.done === true
                      ? 'text-success-ink'
                      : item.done === false
                        ? 'text-muted-foreground'
                        : 'text-warning-ink',
                  )}
                  strokeWidth={1.75}
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {item.label}
                    <span className="sr-only">
                      : {item.done === true ? 'done' : item.done === false ? 'to do' : 'unknown'}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <AutoText value={item.detail} />
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/** The product as a search result reads it, from the one SEO store, with what fills a gap. */
export function SeoSnippet({ product, seo }: { product: AdminProductDetail; seo: SeoOverviewRow }) {
  const title = seo.seoTitle?.trim() || product.name;
  const description = seo.seoDescription?.trim() || product.summary?.trim() || null;
  return (
    <div className="grid gap-3">
      <div
        aria-label="Search result preview"
        className="grid gap-1 rounded-xl border border-hairline bg-surface p-4"
      >
        <p className="truncate font-mono text-xs text-muted-foreground">
          {seo.canonicalPath ?? `/products/${product.slug}`}
        </p>
        <p className="line-clamp-1 text-base font-medium text-link">
          <AutoText value={title} />
        </p>
        <p className="line-clamp-2 text-sm text-body">
          {description ?? (
            <span className="text-muted-foreground">
              <AutoText>No summary yet: a standard line about the product is used.</AutoText>
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip tone={seo.missingTitle ? 'warning' : 'success'} dot>
          {seo.missingTitle ? 'Title: uses the product name' : 'Own title'}
        </Chip>
        <Chip tone={seo.missingDescription ? 'warning' : 'success'} dot>
          {seo.missingDescription ? 'Description: uses the summary' : 'Own description'}
        </Chip>
        {seo.noIndex ? (
          <Chip tone="danger" dot>
            <AutoText>Hidden from search engines</AutoText>
          </Chip>
        ) : null}
      </div>
    </div>
  );
}
