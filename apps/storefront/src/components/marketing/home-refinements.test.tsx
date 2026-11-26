import type { Brand, Category } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryTiles } from '@/components/catalog/categories';
import { BrandShelf } from './brand-shelf';
import { CategoryShowcase, SHOWCASE_CATEGORIES } from './category-showcase';
import { HeroCarousel } from './hero-carousel';
import { ServiceStrip } from './service-strip';
import type { HeroSlide } from '@/lib/hero-slides';

/*
 * The home page's compact, flat rails: six department cards in one row (three-and-a-sliver on a
 * phone, six across from `lg`), two brands plus a sliver in view on a phone, the directory's own
 * tiles left alone, banner words on the artwork in a ~96% transparent container, and every
 * listed element free of drop shadows.
 */

function category(slug: string, name: string): Category {
  return {
    slug,
    name,
    description: null,
    image: null,
    parentSlug: null,
    productCount: 3,
    depth: 0,
    isFeatured: false,
  };
}

function brand(slug: string, name: string, banner: Brand['banner'] = null): Brand {
  return { slug, name, description: null, logo: null, banner, productCount: 2 };
}

function slide(overrides: Partial<HeroSlide> = {}): HeroSlide {
  return {
    id: 'b1',
    desktopSrc: 'https://media.example.com/hero/full.webp',
    mobileSrc: null,
    alt: 'Banner',
    href: null,
    heading: null,
    text: null,
    ctaLabel: null,
    ...overrides,
  };
}

/** The widest column count the grid declares: a breakpoint's if it has one, else the base. */
function columnsOf(list: HTMLElement): number {
  const wide = /(?:^|\s)lg:grid-cols-(\d+)/.exec(list.className)?.[1];
  const base = /(?:^|\s)grid-cols-(\d+)/.exec(list.className)?.[1];
  return Number(wide ?? base ?? 0);
}

describe('the home page categories', () => {
  const many = Array.from({ length: 9 }, (_, index) =>
    category(`c${String(index)}`, `Category ${String(index)}`),
  );

  it('puts six compact cards in one scrolling row, six across on desktop', () => {
    render(<CategoryShowcase categories={many} />);

    const list = screen.getByRole('list');
    // One row at every width: a snap rail on phones, the six filling the row from `lg`.
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('snap-x');
    expect(list.className).not.toContain('grid-cols');
    expect(SHOWCASE_CATEGORIES).toBe(6);

    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    // Six share the row from `lg`, and no card stretches to fill a short row.
    expect(items[0]?.className).toContain('w-[calc((100%-5rem)/6)]');
    // A phone shows three whole cards, with the fourth's edge peeking in to show the row goes on.
    expect(items[0]?.className).toContain('w-[calc((100%-1.625rem)/3)]');
    expect(items[0]?.className).toContain('shrink-0');

    const card = within(list).getAllByRole('link')[0];
    // Compact type and padding so six fit; still flat, with no drop shadow.
    expect(card?.className).toContain('aspect-[5/4]');
    expect(card?.className).not.toContain('shadow');
  });

  it('leaves the category directory at four across with its roomier tiles', () => {
    render(<CategoryTiles categories={many.slice(0, 4)} />);

    const list = screen.getByRole('list');
    expect(columnsOf(list)).toBe(4);
    const card = within(list).getAllByRole('link')[0];
    // The directory card keeps its own roomier frame and never takes the compact padding.
    expect(card?.className).toContain('aspect-[3/2]');
    expect(card?.querySelector('.p-2\\.5')).toBeNull();
  });
});

describe('the home page brands', () => {
  it('puts logo cards in one scrolling row, four across, with the name beneath the logo', () => {
    const brands = Array.from({ length: 12 }, (_, index): Brand => ({
      slug: `b${String(index)}`,
      name: `Brand ${String(index)}`,
      description: null,
      logo: {
        url: `https://media.example.com/brands/${String(index)}/logo.webp`,
        thumbUrl: `https://media.example.com/brands/${String(index)}/logo-thumb.webp`,
      },
      banner: {
        url: `https://media.example.com/brands/${String(index)}/full.webp`,
        thumbUrl: `https://media.example.com/brands/${String(index)}/thumb.webp`,
      },
      productCount: 2,
    }));
    render(<BrandShelf brands={brands} />);

    const list = screen.getByRole('list');
    // One row, never a grid: a swipe rail on phones, four cards in view from `lg`.
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('snap-x');
    expect(list.className).not.toContain('grid-cols');

    const items = within(list).getAllByRole('listitem');
    // Ten cards in the shelf, four in view from `lg`.
    expect(items).toHaveLength(10);
    expect(items[0]?.className).toContain('lg:w-[calc((100%-3rem)/4)]');
    // A phone shows two whole cards plus about a fifth of the third, so the row reads as a
    // rail rather than a half-cut grid.
    expect(items[0]?.className).toContain('w-[calc((100%-1.5rem)/2.2)]');
    expect(items[0]?.className).toContain('sm:w-[calc((100%-2rem)/2.2)]');
    expect(items[0]?.className).toContain('shrink-0');

    const tile = within(list).getAllByRole('link')[0];
    // A card like the category row's beside it: rounded and clipped, so nothing spills, with
    // its own hover highlight — but no border, ring or shadow around the artwork.
    expect(tile?.className).toContain('rounded-2xl');
    expect(tile?.className).toContain('overflow-hidden');
    expect(tile?.className).toContain('hover:bg-brand-soft/70');
    expect(tile?.className).not.toMatch(/ring|border|shadow/);
    // The logo, contained and never stretched, on a square panel that fills the card's face.
    const picture = tile?.querySelector('img');
    expect(picture?.getAttribute('src')).toBe(
      'https://media.example.com/brands/0/logo-thumb.webp',
    );
    expect(picture?.className).toContain('object-contain');
    expect(picture?.closest('.aspect-square')).toBeTruthy();
    expect(tile?.querySelector('img[src$="/full.webp"]')).toBeNull();
    // The name and the real product count sit under the logo.
    expect(within(tile as HTMLElement).getByText('Brand 0')).toBeTruthy();
    expect(within(tile as HTMLElement).getByText('2 products')).toBeTruthy();
    expect(tile?.getAttribute('aria-label')).toBe('Brand 0, 2 products');
  });

  it('shows initials in the same band when a brand has no logo', () => {
    render(<BrandShelf brands={[brand('plain', 'Plain Co')]} />);
    const tile = screen.getByRole('link');
    expect(tile.querySelector('img')).toBeNull();
    expect(within(tile).getByText('PC')).toBeTruthy();
  });
});

describe('the hero banner', () => {
  it('draws the words in a ~96% transparent container over the artwork', () => {
    render(
      <HeroCarousel
        slides={[slide({ heading: 'Eid edit', text: 'Up to 40% off', ctaLabel: 'Shop' })]}
        fallback={<span>Fallback</span>}
      />,
    );

    const heading = screen.getByText('Eid edit');
    const container = heading.closest('div[class*="bg-white/"]');
    expect(container).toBeTruthy();
    expect(container?.className).toContain('bg-white/[0.04]');
    expect(container?.className).toContain('backdrop-blur');
    // The heading keeps its contrast with a shadow instead of a panel.
    expect(heading.className).toContain('text-shadow');
    // Nothing in the banner casts a drop shadow.
    expect(document.querySelector('[class*="shadow-["]')).toBeNull();
    expect(document.querySelector('[class*="shadow-sm"]')).toBeNull();
  });
});

describe('the mobile service strip', () => {
  it('is trimmed to the smaller rail without shrinking its type', () => {
    render(<ServiceStrip />);

    const item = within(screen.getByRole('region', { name: 'Shopping with Nilzora' })).getAllByRole(
      'listitem',
    )[0];
    const rail = item?.querySelector('button');
    expect(rail?.className).toContain('min-h-[3.7rem]');
    expect(rail?.className).toContain('sm:min-h-[3.55rem]');
    // The trim comes off the bottom side: the rail is a touch shorter, its top edge stays put.
    expect(rail?.className).toContain('pt-1');
    expect(rail?.className).toContain('pb-0.5');
    expect(rail?.className).not.toContain('py-1');
    // The label keeps its size: only the rail shrank.
    expect(rail?.querySelector('.text-\\[0\\.6875rem\\]')).toBeTruthy();
  });
});
