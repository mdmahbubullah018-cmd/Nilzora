import type { Category } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import Link from 'next/link';
import { categoryHref } from '@/lib/catalog-query';
import { CategoryCover } from './category-cover';

const counts = new Intl.NumberFormat('en-IN');

const pill =
  'inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors';

export function productCountLabel(count: number): string {
  return `${counts.format(count)} ${count === 1 ? 'product' : 'products'}`;
}

/** The parent of a subcategory, when that parent is among the published categories. */
function parentOf(category: Category, categories: readonly Category[]) {
  if (category.parentSlug === null) return undefined;
  return categories.find((candidate) => candidate.slug === category.parentSlug);
}

/** The published ancestors of a category, top-level department first. */
export function ancestorsOf(category: Category, categories: readonly Category[]): Category[] {
  const chain: Category[] = [];
  let parentSlug = category.parentSlug;
  // The tree is at most three levels deep; the bound also stops a malformed answer looping.
  for (let step = 0; parentSlug !== null && step < 3; step += 1) {
    const parent = categories.find((candidate) => candidate.slug === parentSlug);
    if (!parent) break;
    chain.unshift(parent);
    parentSlug = parent.parentSlug;
  }
  return chain;
}

/** The published children of a category, in tree order. */
export function childCategories(
  categories: readonly Category[],
  parentSlug: string,
): readonly Category[] {
  return categories.filter((category) => category.parentSlug === parentSlug);
}

/**
 * One category as a picture card: the cover fills the whole card and the name sits on its
 * lower edge, so the image is the card rather than a thumbnail beside a label.
 *
 * Readability without hiding the artwork: the words sit on a short, soft gradient that fades
 * out well above them (never a solid block across the picture); a category with no cover is a
 * tinted tile with the same words in dark type, so the same card works either way.
 */
export function CategoryCard({
  category,
  parent,
  ratio = 'aspect-[4/3]',
  compact = false,
  className,
}: {
  category: Category;
  /** Shown as "in <parent>" for a subcategory. */
  parent?: Category | undefined;
  /** The card's shape; the cover fills it. */
  ratio?: string;
  /** The home page's six-across row: tighter padding and type, no detail lost. */
  compact?: boolean;
  className?: string;
}) {
  const hasCover = category.image !== null && category.image !== undefined;
  return (
    <Link
      href={categoryHref(category.slug)}
      className={cn(
        // Flat by design: a hairline and the artwork, never a drop shadow.
        'group relative isolate flex overflow-hidden rounded-2xl ring-1 transition-[ring-color,transform] duration-300 ease-soft hover:-translate-y-0.5 hover:ring-brand-sky/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        hasCover ? 'bg-brand-navy ring-white/10' : 'bg-surface-muted ring-border/80',
        ratio,
        className,
      )}
    >
      {compact && !hasCover ? (
        // A small compact tile has no room to centre its glyph behind the words, so the branded
        // mark keeps to the top band and the name gets the lower one to itself.
        <span className="absolute inset-x-0 top-0 h-[58%]">
          <CategoryCover
            image={category.image}
            name={category.name}
            alt=""
            categorySlug={category.slug}
            fill
            className="transition-transform duration-500 ease-soft group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </span>
      ) : (
        <CategoryCover
          image={category.image}
          name={category.name}
          alt=""
          categorySlug={category.slug}
          fill
          // Absolute for both branches: a category with no cover would otherwise push its own
          // label out of a row-direction card, leaving a nameless tile.
          className="absolute inset-0 transition-transform duration-500 ease-soft group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      )}
      {hasCover ? (
        <span
          aria-hidden="true"
          // Only the bottom third is darkened, and only as much as the words need.
          className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-brand-navy/80 via-brand-navy/35 to-transparent"
        />
      ) : null}
      <span
        className={cn('relative mt-auto grid w-full gap-0.5', compact ? 'p-2.5' : 'p-3 sm:p-4')}
      >
        <span
          className={cn(
            'line-clamp-2 font-semibold wrap-break-word underline-offset-4 group-hover:underline',
            compact ? 'text-[0.8125rem] leading-snug' : 'text-sm leading-snug sm:text-base',
            hasCover ? 'text-white' : 'text-foreground',
          )}
        >
          {category.name}
        </span>
        {parent ? (
          // Supplementary context for sighted shoppers; the link's name stays
          // "<category>, <count>" and the category page's breadcrumb carries the hierarchy.
          <span
            aria-hidden="true"
            className={cn('text-xs', hasCover ? 'text-brand-sky' : 'text-link')}
          >
            in {parent.name}
          </span>
        ) : null}
        {/* Keeps the link's spoken name "Fashion, 3 products", not "Fashion3 products". */}
        <span className="sr-only">,</span>{' '}
        <span
          className={cn(
            compact ? 'text-[0.6875rem]' : 'text-xs',
            hasCover ? 'text-white/80' : 'text-muted-foreground',
          )}
        >
          {productCountLabel(category.productCount)}
        </span>
      </span>
    </Link>
  );
}

/** Category tiles, each one a picture card linking to the category. */
export function CategoryTiles({
  categories,
  ratio = 'aspect-[3/2]',
}: {
  categories: readonly Category[];
  ratio?: string;
}) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {categories.map((category) => (
        <li key={category.slug}>
          <CategoryCard
            category={category}
            parent={parentOf(category, categories)}
            ratio={ratio}
            className="h-full"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * One subcategory as a compact pill with its own artwork: small enough never to compete with the
 * department card above it, large enough to read as a picture rather than a text label. A
 * subcategory without a cover keeps the same shape, filled by the branded placeholder.
 */
export function SubcategoryPill({ category }: { category: Category }) {
  return (
    <Link
      href={categoryHref(category.slug)}
      className={cn(
        'group inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pr-4 pl-1.5',
        'text-sm font-medium whitespace-nowrap text-foreground transition-colors duration-200',
        'hover:border-primary/45 hover:bg-[#F4FAFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none',
      )}
    >
      <CategoryCover
        image={category.image}
        name={category.name}
        alt=""
        categorySlug={category.slug}
        className="size-9 shrink-0 rounded-full"
      />
      <span className="truncate">{category.name}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {productCountLabel(category.totalProductCount ?? category.productCount)}
      </span>
    </Link>
  );
}

/**
 * The categories index: each top-level department as a picture card, with its subcategories as
 * links beneath it. Everything comes from the categories the admin has published; a department
 * with no subcategories is just its card. A department's count covers its whole branch.
 */
export function CategoryDepartments({ categories }: { categories: readonly Category[] }) {
  const known = new Set(categories.map((category) => category.slug));
  // A category whose parent is not published is shown as a department rather than lost.
  const departments = categories.filter(
    (category) => category.parentSlug === null || !known.has(category.parentSlug),
  );
  return (
    <ul
      role="list"
      className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8 md:grid-cols-3 lg:grid-cols-4"
    >
      {departments.map((department) => {
        const children = childCategories(categories, department.slug);
        return (
          <li key={department.slug} className="grid content-start gap-3">
            <CategoryCard
              category={{
                ...department,
                productCount: department.totalProductCount ?? department.productCount,
              }}
              ratio="aspect-[3/2]"
              className="h-full"
            />
            {children.length > 0 ? (
              <nav aria-label={`Subcategories of ${department.name}`}>
                <ul role="list" className="flex flex-wrap gap-2">
                  {children.map((child) => (
                    <li key={child.slug} className="max-w-full">
                      <SubcategoryPill category={child} />
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The subcategories of the category on screen, as pills. Nothing when it has none. */
export function ChildCategoryLinks({
  categories,
  parentSlug,
}: {
  categories: readonly Category[];
  parentSlug: string;
}) {
  const children = childCategories(categories, parentSlug);
  if (children.length === 0) return null;
  return (
    <nav aria-label="Subcategories">
      <ul role="list" className="flex flex-wrap gap-2">
        {children.map((child) => (
          <li key={child.slug}>
            <Link
              href={categoryHref(child.slug)}
              className={cn(
                pill,
                'border-border bg-surface text-foreground hover:bg-surface-muted',
              )}
            >
              {child.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Quick links between listings: all products, then each category. `current` is the
 * category on screen, or 'all' on the all-products page.
 */
export function CategoryNav({
  categories,
  current,
}: {
  categories: readonly Category[];
  current?: string;
}) {
  const links = [
    { key: 'all', label: 'All products', href: '/products' as const },
    ...categories.map((category) => ({
      key: category.slug,
      label: category.name,
      href: categoryHref(category.slug),
    })),
  ];
  return (
    <nav aria-label="Categories">
      <ul role="list" className="flex flex-wrap gap-2">
        {links.map((link) => {
          const active = link.key === current;
          return (
            <li key={link.key}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  pill,
                  active
                    ? 'border-brand-navy bg-brand-navy text-brand-soft'
                    : 'border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-muted',
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
