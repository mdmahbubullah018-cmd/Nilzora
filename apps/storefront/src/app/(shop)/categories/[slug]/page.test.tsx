import { fireEvent, render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '@/lib/catalog-query';
import { categories, category, listing, summary } from '@/testing/catalog-fixtures';
import CategoryPage, { generateMetadata } from './page';

const catalog = vi.hoisted(() => ({
  // Size and colour options come from the variant system; a page test has none unless it
  // says so, which is exactly what a catalogue without variants looks like.
  getProductFacets: vi.fn(() => Promise.resolve({ sizes: [], colors: [] })),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  listProducts: vi.fn(),
  getBanners: vi.fn(),
  getBrands: vi.fn(),
  getCampaigns: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);
// generateMetadata reads the store profile for the site name; no API runs in a test.
vi.mock('@/lib/session', () => ({
  session: { publicApi: () => ({ publicStoreProfile: () => Promise.resolve({ profile: null }) }) },
}));

const [homeKitchen] = categories;

function props(slug: string, searchParams: Record<string, string> = {}) {
  return {
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(searchParams),
  } satisfies PageProps<'/categories/[slug]'>;
}

/** The category marked as the one on screen in the sidebar's category list. */
function currentCategoryLink() {
  return within(screen.getByRole('navigation', { name: 'Categories' }))
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') === 'page');
}

function expectNotFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    digest: expect.stringContaining('404') as unknown,
  });
}

beforeEach(() => {
  catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
  catalog.getCategory.mockResolvedValue({ kind: 'ok', value: homeKitchen });
  catalog.getBanners.mockResolvedValue([]);
  catalog.getBrands.mockResolvedValue({ kind: 'ok', value: [] });
  catalog.getCampaigns.mockResolvedValue([]);
  catalog.listProducts.mockResolvedValue({
    kind: 'ok',
    value: listing([summary({ name: 'Frying Pan' })], { total: 50, totalPages: 3 }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CategoryPage', () => {
  it('lists the category with its description, sort and pagination', async () => {
    const { container } = render(await CategoryPage(props('home-kitchen', { sort: 'newest' })));

    expect(catalog.listProducts).toHaveBeenCalledWith({
      category: 'home-kitchen',
      includeSubcategories: false,
      sort: 'newest',
      page: 1,
      filters: NO_FILTERS,
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home & Kitchen');
    expect(screen.getByText('For the home.')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Frying Pan' })).not.toBeNull();
    expect(screen.getByRole('link', { name: /Next/ }).getAttribute('href')).toBe(
      '/categories/home-kitchen?sort=newest&page=2',
    );
    const form = container.querySelector('form');
    expect(form?.getAttribute('action')).toBe('/categories/home-kitchen');
    expect(currentCategoryLink()?.textContent).toContain('Home & Kitchen');
  });

  it('is not found for a malformed slug, before anything is fetched', async () => {
    await expectNotFound(CategoryPage(props('../../admin')));
    expect(catalog.getCategory).not.toHaveBeenCalled();
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('is not found for an unknown or hidden category', async () => {
    catalog.getCategory.mockImplementation(() => notFound());
    await expectNotFound(CategoryPage(props('hidden-category')));
    // No product listing is requested (or cached) for a category that does not exist.
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('says so when a category has no products yet', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await CategoryPage(props('home-kitchen')));
    expect(screen.getByText('Nothing in Home & Kitchen yet')).not.toBeNull();
  });

  it('shows a retry notice when the category cannot be loaded', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'unavailable' });
    render(await CategoryPage(props('home-kitchen', { page: '2' })));

    expect(screen.getByText('We could not load this category')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/categories/home-kitchen?page=2',
    );
  });

  it('shows a retry notice when only the products cannot be loaded', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'unavailable' });
    render(await CategoryPage(props('home-kitchen')));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home & Kitchen');
    expect(screen.getByText('We could not load products')).not.toBeNull();
  });

  it('puts the parent in the breadcrumb and links the subcategories of a child category', async () => {
    const shirts = category({
      slug: 'shirts',
      name: 'Shirts',
      parentSlug: 'fashion',
      depth: 2,
      productCount: 2,
    });
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: shirts });
    catalog.getCategories.mockResolvedValue({
      kind: 'ok',
      value: [
        category({ slug: 'fashion', name: 'Fashion', productCount: 5 }),
        shirts,
        category({ slug: 'kurtas', name: 'Kurtas', parentSlug: 'fashion', depth: 2 }),
        category({ slug: 'casual-shirts', name: 'Casual shirts', parentSlug: 'shirts', depth: 3 }),
      ],
    });
    render(await CategoryPage(props('shirts')));

    // Breadcrumb: Home / Categories / Fashion / Shirts
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Fashion' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
    expect(crumbs.textContent).toContain('Shirts');
    // Only the category's own children are offered, never the category itself.
    const subcategories = screen.getByRole('navigation', { name: 'Subcategories' });
    expect(subcategories.textContent).toContain('Casual shirts');
    expect(subcategories.textContent).not.toContain('Kurtas');
    expect(subcategories.textContent).not.toContain('Shirts');
  });

  it('shows the cover image of a category that has one', async () => {
    catalog.getCategory.mockResolvedValue({
      kind: 'ok',
      value: category({
        image: {
          url: 'https://media.example.test/categories/c/full.webp',
          thumbUrl: 'https://media.example.test/categories/c/thumb.webp',
        },
      }),
    });
    render(await CategoryPage(props('home-kitchen')));

    // The banner picture is decorative: the category's name is the heading inside it, so the
    // picture must not repeat the name for a screen reader.
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Home & Kitchen');
    const cover = header.querySelector('img');
    expect(cover?.getAttribute('src')).toBe('https://media.example.test/categories/c/full.webp');
  });

  it('writes the name straight on the picture, not in a panel on top of it', async () => {
    catalog.getCategory.mockResolvedValue({
      kind: 'ok',
      value: category({
        image: {
          url: 'https://media.example.test/categories/c/full.webp',
          thumbUrl: 'https://media.example.test/categories/c/thumb.webp',
        },
      }),
    });
    render(await CategoryPage(props('home-kitchen')));

    const heading = within(screen.getByRole('banner')).getByRole('heading', { level: 1 });
    // A glass panel would be a translucent background with a blur on an ancestor of the title.
    for (let node = heading.parentElement; node !== null; node = node.parentElement) {
      expect(node.className).not.toContain('backdrop-blur');
      expect(node.className).not.toContain('bg-brand-navy/45');
    }
    // A shadow on the words is what keeps them readable over a bright photograph.
    expect(heading.parentElement?.className).toContain('text-shadow');
  });

  it('shows no cover and no parent for a top-level category without one', async () => {
    render(await CategoryPage(props('home-kitchen')));

    expect(screen.queryByRole('img', { name: 'Home & Kitchen' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Subcategories' })).toBeNull();
    expect(currentCategoryLink()?.textContent).toContain('Home & Kitchen');
  });
});

describe('CategoryPage branches and filters', () => {
  const fashion = category({
    slug: 'fashion',
    name: 'Fashion',
    productCount: 0,
    totalProductCount: 7,
  });
  const shirts = category({
    slug: 'shirts',
    name: 'Shirts',
    parentSlug: 'fashion',
    depth: 2,
    productCount: 3,
    totalProductCount: 7,
  });
  const casual = category({
    slug: 'casual-shirts',
    name: 'Casual shirts',
    parentSlug: 'shirts',
    depth: 3,
    productCount: 4,
    totalProductCount: 4,
  });

  beforeEach(() => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [fashion, shirts, casual] });
  });

  it('lists a department with its whole branch and counts the branch', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: fashion });
    render(await CategoryPage(props('fashion')));

    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion', includeSubcategories: true }),
    );
    expect(screen.getByText('7 products across 1 subcategory')).not.toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Subcategories' }))
        .getByRole('link', {
          name: /Shirts/,
        })
        .getAttribute('href'),
    ).toBe('/categories/shirts');
  });

  it('lists a category without subcategories on its own', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: casual });
    render(await CategoryPage(props('casual-shirts')));
    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'casual-shirts', includeSubcategories: false }),
    );
  });

  it('names every published ancestor in the breadcrumb and in its structured data', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: casual });
    const { container } = render(await CategoryPage(props('casual-shirts')));

    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Fashion' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
    expect(crumbs.getByRole('link', { name: 'Shirts' }).getAttribute('href')).toBe(
      '/categories/shirts',
    );
    const ld = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(ld?.textContent ?? '{}') as {
      itemListElement: { name: string; item: string }[];
    };
    expect(data.itemListElement.map((entry) => entry.name)).toEqual([
      'Home',
      'Categories',
      'Fashion',
      'Shirts',
      'Casual shirts',
    ]);
    expect(data.itemListElement.at(-1)?.item).toBe(
      'http://localhost:3000/categories/casual-shirts',
    );
  });

  it('applies the filters in the address and shows each as a removable chip', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: casual });
    catalog.getBrands.mockResolvedValue({
      kind: 'ok',
      value: [{ slug: 'aarong', name: 'Aarong', description: null, logo: null, productCount: 3 }],
    });
    const { container } = render(
      await CategoryPage(
        props('casual-shirts', { brand: 'aarong', min: '500', max: '2000', stock: 'in' }),
      ),
    );

    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { brand: 'aarong', minTaka: 500, maxTaka: 2000, inStock: true },
      }),
    );
    expect(
      screen.getByRole('link', { name: 'Remove filter: Brand: Aarong' }).getAttribute('href'),
    ).toBe('/categories/casual-shirts?min=500&max=2000&stock=in');
    expect(
      screen.getByRole('link', { name: /Remove filter: ৳500 – ৳2,000/ }).getAttribute('href'),
    ).toBe('/categories/casual-shirts?brand=aarong&stock=in');
    expect(screen.getByRole('link', { name: 'Clear all' }).getAttribute('href')).toBe(
      '/categories/casual-shirts',
    );
    // The sort and price form keeps every filter: brand, stock and the price range as hidden
    // inputs, so re-sorting or re-pricing never drops them.
    const sortForm = container.querySelector('#listing-toolbar-form');
    const kept = [...(sortForm?.querySelectorAll('input[type=hidden]') ?? [])].map(
      (input) => `${input.getAttribute('name') ?? ''}=${input.getAttribute('value') ?? ''}`,
    );
    expect(kept).toEqual(['brand=aarong', 'stock=in', 'min=500', 'max=2000']);
    fireEvent.click(screen.getByRole('button', { name: /500/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Lowest price in taka').value).toBe('500');
    expect(screen.getByLabelText<HTMLInputElement>('Highest price in taka').value).toBe('2000');
  });

  it('offers to clear the filters when nothing matches them', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: casual });
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await CategoryPage(props('casual-shirts', { stock: 'in' })));

    expect(screen.getByText('No products match these filters')).not.toBeNull();
    // In the empty state and in the filter panel: both lead back to the unfiltered list.
    const clears = screen.getAllByRole('link', { name: 'Clear filters' });
    expect(clears.map((link) => link.getAttribute('href'))).toEqual([
      '/categories/casual-shirts',
      '/categories/casual-shirts',
    ]);
  });
});

describe('generateMetadata', () => {
  it('titles the page with the category', async () => {
    await expect(generateMetadata(props('home-kitchen'))).resolves.toMatchObject({
      title: 'Home & Kitchen',
      description: 'For the home.',
      alternates: { canonical: 'http://localhost:3000/categories/home-kitchen' },
      openGraph: { title: 'Home & Kitchen', url: 'http://localhost:3000/categories/home-kitchen' },
    });
  });

  it('falls back when the category has no description or cannot be loaded', async () => {
    catalog.getCategory.mockResolvedValue({ kind: 'ok', value: categories[1] });
    await expect(generateMetadata(props('fashion'))).resolves.toMatchObject({
      title: 'Fashion',
      description: 'Shop Fashion at Nilzora and pay in cash on delivery.',
    });
    catalog.getCategory.mockResolvedValue({ kind: 'unavailable' });
    await expect(generateMetadata(props('fashion'))).resolves.toEqual({ title: 'Category' });
  });
});
