import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '@/lib/catalog-query';
import { categories, category, listing, summary } from '@/testing/catalog-fixtures';
import ProductsPage from './page';

const catalog = vi.hoisted(() => ({
  // Size and colour options come from the variant system; a page test has none unless it
  // says so, which is exactly what a catalogue without variants looks like.
  getProductFacets: vi.fn(() => Promise.resolve({ sizes: [], colors: [] })),
  getCategories: vi.fn(),
  getBrands: vi.fn(),
  listProducts: vi.fn(),
  findShoppingZone: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);

function props(searchParams: Record<string, string | string[]>): PageProps<'/products'> {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

const aarong = { slug: 'aarong', name: 'Aarong', description: null, logo: null, productCount: 4 };
const empty = {
  slug: 'empty-brand',
  name: 'Empty Brand',
  description: null,
  logo: null,
  productCount: 0,
};

beforeEach(() => {
  catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
  catalog.getBrands.mockResolvedValue({ kind: 'ok', value: [aarong, empty] });
  catalog.findShoppingZone.mockResolvedValue(null);
  catalog.listProducts.mockResolvedValue({
    kind: 'ok',
    value: listing([summary({ name: 'Wireless Earbuds' })], { page: 2, total: 30, totalPages: 2 }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const sidebar = () => screen.getByRole('complementary', { name: 'Filters' });

describe('ProductsPage', () => {
  it('lists a page of products with sort, count, categories and pagination', async () => {
    render(await ProductsPage(props({ sort: 'price_desc', page: '2' })));

    expect(catalog.listProducts).toHaveBeenCalledWith({
      sort: 'price_desc',
      page: 2,
      filters: NO_FILTERS,
      zone: undefined,
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('All products');
    expect(screen.getByRole('heading', { level: 2, name: 'Wireless Earbuds' })).not.toBeNull();
    expect(screen.getByText('Showing 25–30 of 30 products')).not.toBeNull();
    // The chip names the order in force (the panel holds the choices).
    expect(screen.getByRole('button', { name: 'Price: high to low' })).toBeTruthy();
    const current = within(sidebar())
      .getAllByRole('link')
      .find((link) => link.getAttribute('aria-current') === 'page');
    expect(current?.textContent).toBe('All products');
    // Pagination keeps the sort and leaves the default page out.
    expect(screen.getByRole('link', { name: /Previous/ }).getAttribute('href')).toBe(
      '/products?sort=price_desc',
    );
    expect(screen.queryByRole('link', { name: /Next/ })).toBeNull();
  });

  it('ignores junk parameters', async () => {
    render(
      await ProductsPage(
        props({ sort: 'drop table', page: '-4', q: 'ignored', min: 'cheap', brand: 'Not A Slug' }),
      ),
    );
    expect(catalog.listProducts).toHaveBeenCalledWith({
      sort: 'featured',
      page: 1,
      filters: NO_FILTERS,
    });
  });

  it('offers only brands with products, and filters by brand, price and stock', async () => {
    render(await ProductsPage(props({ brand: 'aarong', min: '2,000', max: '500', stock: 'in' })));

    // A range typed the wrong way round is read the way it was meant.
    expect(catalog.listProducts).toHaveBeenCalledWith({
      sort: 'featured',
      page: 1,
      filters: { brand: 'aarong', minTaka: 500, maxTaka: 2000, inStock: true },
    });
    const brandSelect = within(sidebar()).getByLabelText<HTMLSelectElement>('Brand');
    expect([...brandSelect.options].map((option) => option.textContent)).toEqual([
      'All brands',
      'Aarong',
    ]);
    expect(brandSelect.value).toBe('aarong');
    expect(within(sidebar()).getByLabelText<HTMLInputElement>('In stock only').checked).toBe(true);
    // The price range lives in the toolbar's own panel, not the filter panel.
    fireEvent.click(screen.getByRole('button', { name: /500/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Lowest price in taka').value).toBe('500');
    expect(screen.getByLabelText<HTMLInputElement>('Highest price in taka').value).toBe('2000');
    // Category links keep the filters.
    expect(
      within(sidebar())
        .getByRole('link', { name: /^Fashion/ })
        .getAttribute('href'),
    ).toBe('/categories/fashion?brand=aarong&min=500&max=2000&stock=in');
    expect(screen.getByRole('link', { name: 'Remove filter: In stock only' })).not.toBeNull();
  });

  it('marks how many filters are on, on the phone and tablet filter button', async () => {
    render(await ProductsPage(props({ stock: 'in', max: '900' })));
    expect(screen.getByRole('button', { name: /Filters \(2 on\)/ })).not.toBeNull();
  });

  it('counts each category with its whole branch in the sidebar', async () => {
    catalog.getCategories.mockResolvedValue({
      kind: 'ok',
      value: [
        category({ slug: 'fashion', name: 'Fashion', productCount: 0, totalProductCount: 9 }),
        category({
          slug: 'shirts',
          name: 'Shirts',
          parentSlug: 'fashion',
          depth: 2,
          productCount: 9,
        }),
      ],
    });
    render(await ProductsPage(props({})));
    const fashion = within(sidebar()).getByRole('link', { name: /^Fashion/ });
    expect(fashion.textContent).toBe('Fashion, 9 products');
  });

  it('shows an empty state when nothing is on sale', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await ProductsPage(props({})));
    expect(screen.getByText('No products yet')).not.toBeNull();
  });

  it('shows a retry notice when the API cannot be reached, without the category links', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'unavailable' });
    catalog.listProducts.mockResolvedValue({ kind: 'unavailable' });
    render(await ProductsPage(props({ sort: 'newest' })));

    expect(screen.getByText('We could not load products')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/products?sort=newest',
    );
    expect(screen.queryByRole('navigation', { name: 'Categories' })).toBeNull();
  });

  it('browses one collection: its name leads the page and the listing is narrowed to it', async () => {
    catalog.findShoppingZone.mockResolvedValue({
      id: '3f2a1b4c-0000-4000-8000-000000000001',
      slug: 'mens',
      name: "Men's",
      description: null,
      audience: 'men',
      banner: null,
      bannerAlt: null,
      productCount: 3,
    });
    render(await ProductsPage(props({ zone: 'mens', sort: 'newest' })));

    expect(catalog.listProducts).toHaveBeenCalledWith({
      sort: 'newest',
      page: 1,
      filters: NO_FILTERS,
      zone: 'mens',
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Men's");
    // The collection is a chip the shopper can drop, and dropping it keeps every other filter.
    const chip = screen.getByRole('link', {
      name: "Remove filter: Collection: Men's",
    });
    expect(chip.getAttribute('href')).toBe('/products?sort=newest');
  });

  it('answers not found for a collection that does not exist or is hidden', async () => {
    catalog.findShoppingZone.mockResolvedValue(null);

    await expect(ProductsPage(props({ zone: 'nope' }))).rejects.toThrow();
    // Nothing is listed: an empty shelf is not a listing.
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('says so plainly when a collection has nothing in it yet', async () => {
    catalog.findShoppingZone.mockResolvedValue({
      id: '3f2a1b4c-0000-4000-8000-000000000001',
      slug: 'mens',
      name: "Men's",
      description: null,
      audience: 'men',
      banner: null,
      bannerAlt: null,
      productCount: 0,
    });
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await ProductsPage(props({ zone: 'mens' })));

    expect(screen.getByText("Nothing in Men's yet")).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Browse all products' }).getAttribute('href')).toBe(
      '/products',
    );
  });
});
