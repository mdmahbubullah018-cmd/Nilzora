import type { ShoppingZone } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shoppableZones, ZoneRail } from './zone-rail';

/*
 * "Shop the Collections": one sideways rail of collection tiles.
 *
 * Two rules matter to a shopper. A collection with a picture shows it; one without gets the
 * branded tile, so a half-set-up store never shows a broken card. And a collection with nothing
 * on the shelf is left out entirely: an empty shelf is a dead end, while the same products are
 * still reachable by category.
 */

function zone(overrides: Partial<ShoppingZone> = {}): ShoppingZone {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 4,
    ...overrides,
  };
}

const picture = {
  url: 'https://media.example.com/zone/full.webp',
  thumbUrl: 'https://media.example.com/zone/thumb.webp',
};

describe('which collections may be shown', () => {
  it('keeps those with something on the shelf', () => {
    expect(shoppableZones([zone(), zone({ slug: 'empty', productCount: 0 })])).toHaveLength(1);
  });

  it('shows nothing at all when no collection can be shopped', () => {
    const { container } = render(<ZoneRail zones={[zone({ productCount: 0 })]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the rail', () => {
  it('names every collection and links to its listing', () => {
    render(<ZoneRail zones={[zone(), zone({ slug: 'kids', name: 'Kids' })]} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toStrictEqual([
      '/products?zone=mens',
      '/products?zone=kids',
    ]);
    // Name, how many products it holds, and where it sits: "Collection 1 of 2".
    expect(links[0]?.getAttribute('aria-label')).toBe(
      "Shop the Men's, 4 products. Collection 1 of 2",
    );
    expect(links[1]?.getAttribute('aria-label')).toBe(
      'Shop the Kids, 4 products. Collection 2 of 2',
    );
  });

  it('shows one wide banner per view and lets the next one peek in, like the app', () => {
    const { container } = render(
      <ZoneRail
        zones={[
          zone(),
          zone({ id: '3f2a1b4c-0000-4000-8000-000000000002', slug: 'womens', name: "Women's" }),
          zone({ id: '3f2a1b4c-0000-4000-8000-000000000003', slug: 'kids', name: 'Kids' }),
        ]}
      />,
    );

    // Every collection is rendered — nothing is hardcoded to Men and Women.
    expect(screen.getAllByRole('link')).toHaveLength(3);

    const list = container.querySelector('ul');
    // A sideways scroller with snap points: the peek is reached by swiping, not by a second row.
    expect(list?.className).toContain('snap-x');
    expect(list?.className).toContain('overflow-x-auto');

    // On a phone and tablet: the whole row less a slice of the next banner. From lg: two banners
    // side by side (one gap between them), never three.
    const items = [...(container.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.className).toContain('w-[calc(100%_-_2.25rem_-_0.75rem)]');
      expect(item.className).toContain('lg:w-[calc((100%_-_1.25rem)/2)]');
      expect(item.className).not.toContain('/3)]');
      expect(item.className).toContain('shrink-0');
      expect(item.className).toContain('snap-start');
    }
  });

  it('gives a single collection the full row', () => {
    const { container } = render(<ZoneRail zones={[zone()]} />);
    const items = [...(container.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(1);
    expect(items[0]?.className).toContain('w-full');
  });

  it('is a banner in the app’s proportions, with the words on a fade and a transparent Shop cue', () => {
    render(<ZoneRail zones={[zone({ banner: picture })]} />);

    const link = screen.getByRole('link');
    // 16:7 on a phone (the app's banner), 3:1 across a desktop, never shorter than 9rem.
    expect(link.className).toContain('aspect-16/7');
    expect(link.className).toContain('lg:aspect-3/1');
    expect(link.className).toContain('min-h-36');
    // The navy fade under the words keeps white type legible on any picture.
    const fade = link.querySelector('.bg-linear-to-t');
    expect(fade?.className).toContain('from-brand-navy/95');
    expect(fade?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText("Men's").className).toContain('text-white');
    // "Shop" is a bare cue: no border, no fill, no pill around it.
    const cue = screen.getByText('Shop');
    expect(cue.className).not.toContain('border');
    expect(cue.className).not.toContain('bg-');
    expect(cue.className).not.toContain('rounded-full');
    expect(cue.className).toContain('text-white');
    expect(cue.querySelector('svg')).not.toBeNull();
  });

  it('shows the picture when a collection has one, and says what it is', () => {
    const { container } = render(
      <ZoneRail zones={[zone({ banner: picture, bannerAlt: 'Two cotton shirts' })]} />,
    );

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(picture.url);
    expect(image?.getAttribute('alt')).toBe('Two cotton shirts');
  });

  it('leaves the picture to the linkâ€™s label when no description is set', () => {
    const { container } = render(<ZoneRail zones={[zone({ banner: picture, bannerAlt: null })]} />);

    // A decorative picture: the link's own label already names the collection.
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('falls back to a branded tile, with the count, when there is no picture', () => {
    const { container } = render(<ZoneRail zones={[zone()]} />);

    const link = screen.getByRole('link');
    expect(container.querySelector('img')).toBeNull();
    expect(within(link).getByText('4 products')).toBeTruthy();
  });

  it('prefers the collectionâ€™s own description over the count', () => {
    render(<ZoneRail zones={[zone({ description: 'Light layers for summer' })]} />);

    expect(screen.getByText('Light layers for summer')).toBeTruthy();
    expect(screen.queryByText('4 products')).toBeNull();
  });

  it('is a list of one tile per collection', () => {
    render(<ZoneRail zones={[zone(), zone({ slug: 'kids', name: 'Kids' })]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
