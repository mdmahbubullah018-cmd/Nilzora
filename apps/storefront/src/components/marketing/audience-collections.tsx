import type { Category } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { productCountLabel } from '@/components/catalog/categories';
import { categoryHref } from '@/lib/catalog-query';
import type { Audience } from '@/lib/navigation';

const COPY: Record<Audience, { title: string; cta: string; tone: string }> = {
  men: {
    title: "Men's Collection",
    cta: 'Shop Men',
    tone: 'from-brand-navy via-brand-slate to-primary-action',
  },
  women: {
    title: "Women's Collection",
    cta: 'Shop Women',
    tone: 'from-brand-navy via-brand-violet/80 to-brand-sky/70',
  },
};

function CollectionCard({ audience, category }: { audience: Audience; category: Category }) {
  const copy = COPY[audience];
  return (
    <Link
      href={categoryHref(category.slug)}
      className={cn(
        'group relative isolate flex aspect-[16/9] flex-col justify-end overflow-hidden rounded-3xl bg-linear-to-br p-5 shadow-sm ring-1 ring-border/60 sm:aspect-[2/1] sm:p-7 lg:aspect-[16/9]',
        copy.tone,
      )}
    >
      {category.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- the department cover, already resized WebP from the media service
        <img
          src={category.image.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-700 ease-soft group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : null}
      {/* Our own title sits on this section, so a fade keeps it readable on any cover. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-t from-brand-navy/80 via-brand-navy/25 to-transparent"
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {copy.title}
          </h3>
          {category.productCount > 0 ? (
            <p className="text-sm text-brand-soft/90">{productCountLabel(category.productCount)}</p>
          ) : null}
        </div>
        <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/90 px-4 text-sm font-semibold text-brand-navy shadow-sm backdrop-blur transition-colors group-hover:bg-white">
          {copy.cta}
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </div>
    </Link>
  );
}

/**
 * Men's and Women's collections, side by side on desktop. Each appears only when the store has
 * a matching top-level department (see audienceDepartment): products carry no audience field,
 * so nothing is classified here, and with neither department the section is not rendered.
 */
export function AudienceCollections({
  men,
  women,
}: {
  men: Category | null;
  women: Category | null;
}) {
  const cards = (
    [
      ['men', men],
      ['women', women],
    ] as const
  ).filter((entry): entry is readonly [Audience, Category] => entry[1] !== null);
  if (cards.length === 0) return null;
  return (
    <ul role="list" className={cn('grid gap-4 lg:gap-6', cards.length > 1 && 'md:grid-cols-2')}>
      {cards.map(([audience, category]) => (
        <li key={audience}>
          <CollectionCard audience={audience} category={category} />
        </li>
      ))}
    </ul>
  );
}
