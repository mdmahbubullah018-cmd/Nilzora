import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '@/lib/catalog-query';
import { categories, category, listing, summary } from '@/testing/catalog-fixtures';
import SearchPage, { generateMetadata } from './page';

const catalog = vi.hoisted(() => ({
  // Size and colour options come from the variant system; a page test has none unless it
  // says so, which is exactly what a catalogue without variants looks like.
  getProductFacets: vi.fn(() => Promise.resolve({ sizes: [], colors: [] })),
  getCategories: vi.fn(),
  getBrands: vi.fn(),
  getDiscovery: vi.fn(),
  searchProducts: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function props(searchParams: Record<string, string>) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

beforeEach(() => {
  catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
  catalog.getBrands.mockResolvedValue({ kind: 'ok', value: [] });
  catalog.getDiscovery.mockResolvedValue({ kind: 'ok', value: { sections: [] } });
  catalog.searchProducts.mockResolvedValue({
    kind: 'ok',
    value: listing([summary({ name: 'Cotton Bedsheet Set' })], { total: 30, totalPages: 2 }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The toolbar form: the chips and their panels belong to it. */
const toolbar = () => within(document.getElementById('listing-toolbar-form') ?? document.body);

/** The orders the sort chip offers, read from its panel. */
const sortOptions = () => {
  fireEvent.click(toolbar().getAllByRole('button')[0]!);
  return screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value);
};

describe('SearchPage', () => {
  it('shows results by relevance with the query echoed', async () => {
    render(await SearchPage(props({ q: '  cotton ' })));

    expect(catalog.searchProducts).toHaveBeenCalledWith({
      q: 'cotton',
      category: undefined,
      includeSubcategories: false,
      sort: 'relevance',
      page: 1,
      filters: NO_FILTERS,
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Results for cotton');
    expect(screen.getByRole('link', { name: 'Cotton Bedsheet Set' })).not.toBeNull();
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Search products' }).value).toBe(
      'cotton',
    );
    expect(screen.getByRole('link', { name: /Next/ }).getAttribute('href')).toBe(
      '/search?q=cotton&page=2',
    );
    // An unfiltered search ranks by relevance, which is this listing's own order: the chip
    // simply reads "Sort", and the toolbar form still carries the search text.
    const sort = toolbar().getAllByRole('button')[0]!;
    expect(sort.textContent).toContain('Sort');
    expect(sort.closest('form')?.querySelector<HTMLInputElement>('[name="q"]')?.value).toBe(
      'cotton',
    );
  });

  it('shows hostile query text only as text', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = render(await SearchPage(props({ q: attack })));

    expect(container.querySelector('img, script')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Results for ${attack}`);
  });

  it('searches nothing for blank text and suggests categories instead', async () => {
    render(await SearchPage(props({ q: '   ' })));

    expect(catalog.searchProducts).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Search the catalog');
    expect(screen.getByText('What are you looking for?')).not.toBeNull();
    const suggestions = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(suggestions).getByRole('link', { name: 'Fashion' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
  });

  it('shows the ranked discovery sections, with their evidence, before any search', async () => {
    const saree = summary({ slug: 'cotton-saree', name: 'Cotton Saree' });
    const scarf = summary({ slug: 'silk-scarf', name: 'Silk Scarf' });
    const kurta = summary({ slug: 'linen-kurta', name: 'Linen Kurta' });
    catalog.getDiscovery.mockResolvedValue({
      kind: 'ok',
      value: {
        sections: [
          {
            key: 'best-selling',
            title: 'Best Selling',
            items: [{ product: saree, rating: { averageRating: 4.6, reviewCount: 12 } }],
          },
          {
            key: 'top-rated',
            title: 'Top Rated',
            items: [{ product: scarf, rating: { averageRating: 5, reviewCount: 1 } }],
          },
          {
            key: 'new',
            title: 'New at Nilzora',
            items: [{ product: kurta, rating: null }],
          },
        ],
      },
    });

    render(await SearchPage(props({})));

    expect(catalog.getDiscovery).toHaveBeenCalled();
    expect(catalog.searchProducts).not.toHaveBeenCalled();
    expect(screen.getByText('What are you looking for?')).not.toBeNull();
    // Each section is a named region with its own heading, in the API's order.
    expect(screen.getByRole('region', { name: 'Best Selling' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Top Rated' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'New at Nilzora' })).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Rated 4.6 out of 5 from 12 reviews' })).not.toBeNull();
    // A product with no approved review shows no rating claim at all.
    expect(screen.getByRole('link', { name: 'Linen Kurta' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: /from 0 reviews/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'See all new arrivals' }).getAttribute('href')).toBe(
      '/products?sort=newest',
    );
    // Category shortcuts stay useful below the discovery rails.
    expect(screen.getByRole('navigation', { name: 'Categories' })).not.toBeNull();
  });

  it('falls back to the search prompt when discovery cannot be read', async () => {
    catalog.getDiscovery.mockResolvedValue({ kind: 'unavailable' });

    render(await SearchPage(props({})));

    expect(screen.getByText('What are you looking for?')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Best Selling' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Categories' })).not.toBeNull();
  });

  it('suggests categories when nothing matches', async () => {
    catalog.searchProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await SearchPage(props({ q: 'zzzz' })));

    expect(screen.getByText(/No products match/).textContent).toBe('No products match zzzz');
    expect(screen.getByRole('navigation', { name: 'Categories' })).not.toBeNull();
  });

  it('narrows to a visible category and can widen again', async () => {
    catalog.searchProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await SearchPage(props({ q: 'pan', category: 'home-kitchen', sort: 'newest' })));

    expect(catalog.searchProducts).toHaveBeenCalledWith({
      q: 'pan',
      category: 'home-kitchen',
      includeSubcategories: false,
      sort: 'newest',
      page: 1,
      filters: NO_FILTERS,
    });
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.textContent).toContain(
      'In Home & Kitchen',
    );
    expect(
      screen.getByRole('link', { name: 'Remove filter: In Home & Kitchen' }).getAttribute('href'),
    ).toBe('/search?q=pan&sort=newest');
    expect(screen.getByText('No products match these filters')).not.toBeNull();
  });

  it('covers a department’s subcategories, listing them newest first', async () => {
    catalog.getCategories.mockResolvedValue({
      kind: 'ok',
      value: [
        ...categories,
        category({ slug: 'shirts', name: 'Shirts', parentSlug: 'fashion', depth: 2 }),
      ],
    });
    render(await SearchPage(props({ q: 'cotton', category: 'fashion' })));

    expect(catalog.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion', includeSubcategories: true, sort: 'newest' }),
    );
    // Ranking needs the plain search, so it is not offered here.
    expect(sortOptions()).toEqual(['newest', 'price_asc', 'price_desc']);
  });

  it('applies brand, price and stock filters and stops offering relevance', async () => {
    catalog.getBrands.mockResolvedValue({
      kind: 'ok',
      value: [{ slug: 'aarong', name: 'Aarong', description: null, logo: null, productCount: 2 }],
    });
    render(
      await SearchPage(props({ q: 'cotton', brand: 'aarong', max: '1500', sort: 'relevance' })),
    );

    expect(catalog.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'newest',
        filters: { brand: 'aarong', minTaka: undefined, maxTaka: 1500, inStock: false },
      }),
    );
    expect(sortOptions()).toEqual(['newest', 'price_asc', 'price_desc']);
    // Removing the last filter returns to the ranked search.
    expect(
      screen.getByRole('link', { name: 'Remove filter: Up to ৳1,500' }).getAttribute('href'),
    ).toBe('/search?q=cotton&brand=aarong');
    expect(screen.getByRole('link', { name: 'Clear all' }).getAttribute('href')).toBe(
      '/search?q=cotton',
    );
  });

  it('drops a category the visitor cannot see', async () => {
    render(await SearchPage(props({ q: 'pan', category: 'secret-stock' })));
    expect(catalog.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: undefined }),
    );
  });

  it('asks a visitor who searches too fast to wait', async () => {
    catalog.searchProducts.mockResolvedValue({ kind: 'rate_limited' });
    render(await SearchPage(props({ q: 'rice' })));

    expect(screen.getByText('Too many searches at once')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/search?q=rice',
    );
  });

  it('shows a retry notice when the API cannot be reached', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'unavailable' });
    catalog.searchProducts.mockResolvedValue({ kind: 'unavailable' });
    render(await SearchPage(props({ q: 'rice', category: 'groceries' })));

    // Without the category list the filter is passed on for the API to apply.
    expect(catalog.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries' }),
    );
    expect(screen.getByText('We could not load search results')).not.toBeNull();
  });
});

describe('generateMetadata', () => {
  it('titles the page with the query and keeps result pages out of search engines', async () => {
    await expect(generateMetadata(props({ q: 'rice' }))).resolves.toEqual({
      title: 'Search results for “rice”',
      robots: { index: false, follow: true },
    });
    await expect(generateMetadata(props({}))).resolves.toMatchObject({ title: 'Search' });
  });
});
