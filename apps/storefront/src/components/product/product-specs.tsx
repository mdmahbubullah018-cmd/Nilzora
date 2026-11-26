import type { Category, ProductDetail } from '@nilzora/contracts';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { brandHref, categoryHref } from '@/lib/catalog-query';

interface SpecRow {
  label: string;
  value: ReactNode;
}

/** Each option the product comes in (e.g. Size: S, M, L), in its own order, without repeats. */
export function optionSummary(product: ProductDetail): { name: string; values: string[] }[] {
  const groups = new Map<string, { name: string; values: string[] }>();
  for (const variant of product.variants) {
    for (const option of variant.options) {
      const group = groups.get(option.attributeSlug) ?? { name: option.attribute, values: [] };
      if (!group.values.includes(option.value)) group.values.push(option.value);
      groups.set(option.attributeSlug, group);
    }
  }
  return [...groups.values()];
}

const link = 'font-medium text-link underline-offset-4 hover:underline';

/**
 * The product's facts as a definition list: brand, where it sits in the catalog, its product
 * code and the options it comes in. Every row is a value the API returned; a product without
 * one simply has no such row.
 */
export function ProductSpecs({
  product,
  categoryPath,
}: {
  product: ProductDetail;
  /** The product's category and its published ancestors, top level first. */
  categoryPath: readonly Pick<Category, 'slug' | 'name'>[];
}) {
  const rows: SpecRow[] = [];
  if (product.brand) {
    rows.push({
      label: 'Brand',
      value: (
        <Link href={brandHref(product.brand.slug)} className={link}>
          {product.brand.name}
        </Link>
      ),
    });
  }
  rows.push({
    label: 'Category',
    value: (
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        {categoryPath.map((entry, index) => (
          <span key={entry.slug} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">›</span> : null}
            <Link href={categoryHref(entry.slug)} className={link}>
              {entry.name}
            </Link>
          </span>
        ))}
      </span>
    ),
  });
  for (const option of optionSummary(product)) {
    rows.push({ label: option.name, value: option.values.join(', ') });
  }
  // A product with variants has one code per variant, shown beside the price once chosen.
  if (product.variants.length === 0) rows.push({ label: 'Product code (SKU)', value: product.sku });

  return (
    <dl className="grid divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4 sm:px-5"
        >
          <dt className="font-medium text-muted-foreground">{row.label}</dt>
          <dd className="break-words text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
