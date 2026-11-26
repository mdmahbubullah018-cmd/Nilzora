import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { BrandRow } from '../features/brands/brand-components';
import { brand } from '../features/brands/test-fixtures';
import { GRID_GAP, SCREEN_PADDING } from '../features/catalog/catalog-layout';

/*
 * The Home brand cards: the website's shelf, sized for a phone. A card is a square panel with
 * the brand's own logo contained inside it and the name directly underneath; a brand without a
 * logo shows its initials instead. The brand's banner is never used as the card's face.
 */

const BANNER = {
  url: 'https://media.example.test/brands/aarong/full.webp',
  thumbUrl: 'https://media.example.test/brands/aarong/thumb.webp',
};
const LOGO = {
  url: 'https://media.example.test/brands/deshi/full.webp',
  thumbUrl: 'https://media.example.test/brands/deshi/thumb.webp',
};

function renderRow(brands: Parameters<typeof BrandRow>[0]['brands']) {
  return render(<BrandRow brands={brands} onSelect={jest.fn()} onSeeAll={jest.fn()} />);
}

describe('BrandRow', () => {
  it('draws the brand logo, never its banner, with the name beneath it', async () => {
    const view = await renderRow([
      brand({ name: 'Aarong', banner: BANNER, logo: LOGO, productCount: 7 }),
    ]);

    const tree = JSON.stringify(view.toJSON());
    expect(tree).toContain(LOGO.thumbUrl);
    expect(tree).not.toContain(BANNER.thumbUrl);
    expect(screen.getByText('Aarong')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Aarong, 7 products' })).toBeOnTheScreen();
  });

  it('shows initials in the same band for a brand without a logo', async () => {
    const view = await renderRow([
      brand({ name: 'Deshi Threads', slug: 'deshi-threads', banner: BANNER, productCount: 1 }),
    ]);

    const tree = JSON.stringify(view.toJSON());
    expect(tree).not.toContain(BANNER.thumbUrl);
    expect(screen.getByText('DT')).toBeOnTheScreen();
    expect(screen.getByText('Deshi Threads')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Deshi Threads, 1 product' })).toBeOnTheScreen();
  });

  it('puts brands with products first, and draws nothing at all when there are none', async () => {
    const empty = await renderRow([]);
    expect(empty.toJSON()).toBeNull();

    await renderRow([
      brand({ name: 'Zed', slug: 'zed', productCount: 0 }),
      brand({ name: 'Aarong', slug: 'aarong', productCount: 4 }),
    ]);
    const names = screen
      .getAllByText(/^(Zed|Aarong)$/)
      .map((node) => String(node.props.children as unknown));
    expect(names).toEqual(['Aarong', 'Zed']);
  });

  it('keeps two whole cards and about a fifth of the next in view', async () => {
    const view = await renderRow([
      brand({ name: 'Alpha', slug: 'alpha', productCount: 9 }),
      brand({ name: 'Beta', slug: 'beta', productCount: 5 }),
      brand({ name: 'Gamma', slug: 'gamma', productCount: 1 }),
    ]);

    const { width } = Dimensions.get('window');
    const card = screen.getByRole('button', { name: 'Alpha, 9 products' });
    const cardWidth = Number(
      (StyleSheet.flatten(card.props.style as never) as { width?: unknown } | undefined)?.width,
    );

    // Two whole cards and both gaps fill the row but for the next card's own edge: about a
    // fifth of that card stays in view, which is what tells a shopper the row continues.
    const peek = width - (SCREEN_PADDING + cardWidth * 2 + GRID_GAP * 2);
    expect(peek / cardWidth).toBeGreaterThan(0.17);
    expect(peek / cardWidth).toBeLessThan(0.23);

    // The name and the real product count both sit under the logo, centred.
    expect(screen.getByText('9 products')).toBeOnTheScreen();

    // The logo sits on a square panel, smaller than the card, so the mark reads as a logo.
    const panels: number[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      const entry = node as { props?: { style?: unknown }; children?: unknown[] };
      const flat = StyleSheet.flatten(entry.props?.style as never) as
        | { aspectRatio?: unknown }
        | undefined;
      const ratio = flat?.aspectRatio;
      if (typeof ratio === 'number') panels.push(ratio);
      for (const child of entry.children ?? []) walk(child);
    };
    walk(view.toJSON());
    expect(panels).toContain(1);
  });
});
