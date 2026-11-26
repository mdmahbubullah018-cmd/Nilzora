import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import CategoryScreen from '../../app/category/[slug]';
import ShopScreen from '../../app/shop';
import {
  branchProductCount,
  feedQuery,
  isDepartment,
  resolveListing,
  type ShopFilters,
} from '../features/catalog/catalog-query';
import { FilterSheet } from '../features/catalog/filter-sheet';
import { category, GROCERIES, page, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * A department (a category with published subcategories) lists its whole branch, wherever it
 * is chosen: the department page, the Shop chips, the filter sheet and a link from Home. The
 * fixtures put every product in a subcategory and none directly in the department, so any
 * path that asks for direct products only shows an empty list.
 */

const FASHION = category({
  slug: 'fashion',
  name: 'Fashion',
  productCount: 0,
  totalProductCount: 5,
});
const SHIRTS = category({
  slug: 'shirts',
  name: 'Shirts',
  parentSlug: 'fashion',
  depth: 2,
  productCount: 3,
  totalProductCount: 3,
});
const KURTAS = category({
  slug: 'kurtas',
  name: 'Kurtas',
  parentSlug: 'fashion',
  depth: 2,
  productCount: 2,
  totalProductCount: 2,
});

const SHIRT = summary({
  id: productId(1),
  slug: 'cotton-shirt',
  name: 'Cotton shirt',
  category: { slug: 'shirts', name: 'Shirts' },
});
const KURTA = summary({
  id: productId(2),
  slug: 'printed-kurta',
  name: 'Printed kurta',
  category: { slug: 'kurtas', name: 'Kurtas' },
});

const filters = (overrides: Partial<ShopFilters> = {}): ShopFilters => ({
  q: '',
  category: 'fashion',
  zone: undefined,
  sort: 'featured',
  ...overrides,
});

/** The API as it behaves: a department has no products of its own, only its branch does. */
function departmentApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION, SHIRTS, KURTAS, GROCERIES] });
  api.listBanners.mockResolvedValue({ banners: [] });
  api.listProducts.mockImplementation((query) =>
    Promise.resolve(
      query?.includeSubcategories === true && query.category === 'fashion'
        ? page([SHIRT, KURTA])
        : query?.category === 'shirts'
          ? page([SHIRT])
          : page([]),
    ),
  );
  return api;
}

const card = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}, Price`) });

describe('the department rule', () => {
  it('knows a department by its published subcategories', () => {
    const tree = [FASHION, SHIRTS, KURTAS, GROCERIES];
    expect(isDepartment(tree, 'fashion')).toBe(true);
    expect(isDepartment(tree, 'shirts')).toBe(false);
    expect(isDepartment(tree, 'groceries')).toBe(false);
    expect(isDepartment(tree, 'not-a-category')).toBe(false);
  });

  it('lists a department by its whole branch', () => {
    const { filters: resolved } = resolveListing(
      filters(),
      ['featured', 'newest'],
      [FASHION, SHIRTS],
    );
    expect(resolved.includeSubcategories).toBe(true);
    expect(feedQuery(resolved)).toEqual({
      category: 'fashion',
      includeSubcategories: true,
      sort: 'featured',
      pageSize: 24,
    });
  });

  it('leaves a leaf category, no category and an unknown list as they were', () => {
    const sorts = ['featured', 'newest'] as const;
    for (const [chosen, list] of [
      [filters({ category: 'shirts' }), [FASHION, SHIRTS]],
      [filters({ category: undefined }), [FASHION, SHIRTS]],
      [filters(), undefined],
    ] as const) {
      const resolved = resolveListing(chosen, sorts, list);
      expect(resolved.filters.includeSubcategories).toBe(false);
      expect(resolved.sorts).toBe(sorts);
      expect(feedQuery(resolved.filters)).not.toHaveProperty('includeSubcategories');
    }
  });

  it('never ranks a branch by best match: a search in a department is listed newest first', () => {
    const resolved = resolveListing(
      filters({ q: 'shirt', sort: 'relevance' }),
      ['relevance', 'newest', 'price_asc', 'price_desc'],
      [FASHION, SHIRTS],
    );
    expect(resolved.sorts).toEqual(['newest', 'price_asc', 'price_desc']);
    expect(resolved.filters).toMatchObject({ sort: 'newest', includeSubcategories: true });
    expect(feedQuery(resolved.filters)).toEqual({
      q: 'shirt',
      category: 'fashion',
      includeSubcategories: true,
      sort: 'newest',
      pageSize: 24,
    });
  });

  it('keeps a sort the visitor chose, and a search in a leaf stays ranked', () => {
    const department = resolveListing(
      filters({ q: 'shirt', sort: 'price_desc' }),
      ['relevance', 'newest', 'price_desc'],
      [FASHION, SHIRTS],
    );
    expect(department.filters.sort).toBe('price_desc');

    const leaf = resolveListing(
      filters({ q: 'shirt', category: 'shirts', sort: 'relevance' }),
      ['relevance', 'newest'],
      [FASHION, SHIRTS],
    );
    expect(leaf.filters.sort).toBe('relevance');
    expect(leaf.sorts).toEqual(['relevance', 'newest']);
  });

  it('never sends a branch together with best match, whatever a caller passes', () => {
    expect(
      feedQuery(filters({ q: 'x', sort: 'relevance', includeSubcategories: true })),
    ).not.toHaveProperty('includeSubcategories');
  });

  it('counts a department by its branch, falling back for an older API', () => {
    expect(branchProductCount(FASHION)).toBe(5);
    expect(branchProductCount({ productCount: 4 })).toBe(4);
  });
});

describe('the department page', () => {
  beforeEach(() => {
    resetRouterMock();
    searchParams.slug = 'fashion';
  });

  it('lists products that sit only in its subcategories, with the branch count', async () => {
    const api = departmentApi();
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(await card('Printed kurta')).toBeOnTheScreen();
    expect(screen.queryByText('No products here yet')).not.toBeOnTheScreen();
    expect(screen.getByText('5 products')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion', includeSubcategories: true }),
      expect.anything(),
    );
  });

  it('asks nothing until it knows the category is a department, then asks once', async () => {
    const api = departmentApi();
    let release!: () => void;
    api.listCategories.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ categories: [FASHION, SHIRTS, KURTAS, GROCERIES] });
          };
        }),
    );
    await renderWithProviders(<CategoryScreen />, { api });

    // The category list has not arrived: no request for direct products, and no empty flash.
    expect(api.listProducts).not.toHaveBeenCalled();
    expect(screen.queryByText('No products here yet')).not.toBeOnTheScreen();

    release();
    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ includeSubcategories: true }),
      expect.anything(),
    );
    // The screen, the grid and the chips share one category request.
    expect(api.listCategories).toHaveBeenCalledTimes(1);
  });

  it('lists a leaf subcategory on its own, without the branch flag', async () => {
    searchParams.slug = 'shirts';
    const api = departmentApi();
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.listProducts.mock.calls[0]?.[0]).not.toHaveProperty('includeSubcategories');
  });

  it('shows direct products rather than nothing when the category list cannot load', async () => {
    const api = departmentApi();
    api.listCategories.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<CategoryScreen />, { api });

    await waitFor(() => {
      expect(api.listProducts).toHaveBeenCalled();
    });
    expect(api.listProducts.mock.calls[0]?.[0]).not.toHaveProperty('includeSubcategories');
  });
});

/** Re-renders the shop after the router changed its parameters, like the real router does. */
let rerender: (() => void) | undefined;

function Shop() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    rerender = () => {
      setVersion((version) => version + 1);
    };
    return () => {
      rerender = undefined;
    };
  }, []);
  return <ShopScreen />;
}

describe('Shop and its department chips', () => {
  beforeEach(() => {
    resetRouterMock();
    router.setParams.mockReset();
    router.setParams.mockImplementation((next: Record<string, string | undefined>) => {
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete searchParams[key];
        else searchParams[key] = value;
      }
      rerender?.();
    });
  });

  it('lists the whole branch when a department chip is chosen', async () => {
    const api = departmentApi();
    const { user } = await renderWithProviders(<Shop />, { api });

    await user.press(await screen.findByRole('radio', { name: 'Fashion' }));

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(await card('Printed kurta')).toBeOnTheScreen();
    expect(screen.queryByText('No products here yet')).not.toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenLastCalledWith(
      { category: 'fashion', includeSubcategories: true, sort: 'featured', pageSize: 24, page: 1 },
      expect.anything(),
    );
  });

  it('lists a leaf chip on its own', async () => {
    const api = departmentApi();
    const { user } = await renderWithProviders(<Shop />, { api });

    await user.press(await screen.findByRole('radio', { name: 'Shirts' }));

    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { category: 'shirts', sort: 'featured', pageSize: 24, page: 1 },
        expect.anything(),
      );
    });
  });

  it('follows a link from Home to a department the same way', async () => {
    searchParams.category = 'fashion';
    const api = departmentApi();
    await renderWithProviders(<Shop />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
  });

  it('searches inside a department newest first, never by best match', async () => {
    searchParams.category = 'fashion';
    searchParams.q = 'shirt';
    const api = departmentApi();
    const { user } = await renderWithProviders(<Shop />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      {
        q: 'shirt',
        category: 'fashion',
        includeSubcategories: true,
        sort: 'newest',
        pageSize: 24,
        page: 1,
      },
      expect.anything(),
    );
    // The control says what the list really is, and does not offer a ranking it cannot give.
    await user.press(screen.getByRole('button', { name: 'Sort' }));
    expect(screen.queryByRole('radio', { name: 'Best match' })).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Newest', checked: true })).toBeOnTheScreen();
  });

  it('still ranks a search by best match when no department is chosen', async () => {
    searchParams.q = 'shirt';
    const api = departmentApi();
    api.listProducts.mockResolvedValue(page([SHIRT]));
    await renderWithProviders(<Shop />, { api });

    await card('Cotton shirt');
    expect(api.listProducts).toHaveBeenCalledWith(
      { q: 'shirt', sort: 'relevance', pageSize: 24, page: 1 },
      expect.anything(),
    );
  });
});

describe('the filter sheet and departments', () => {
  const SORTS = ['relevance', 'newest', 'price_asc'] as const;

  async function setup() {
    const onApply = jest.fn();
    const user = userEvent.setup();
    await render(
      <FilterSheet
        visible
        onClose={jest.fn()}
        categories={[FASHION, SHIRTS, GROCERIES]}
        selectedCategory={undefined}
        brands={[]}
        selectedBrand={undefined}
        inStock={false}
        onApply={onApply}
        onReset={jest.fn()}
      />,
    );
    return { onApply, user };
  }

  it('applies the chosen category without touching the sort the toolbar holds', async () => {
    const { onApply, user } = await setup();

    await user.press(screen.getByRole('radio', { name: 'Fashion' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    // Sort is not part of the advanced sheet: the toolbar's choice is carried through as it is.
    expect(onApply).toHaveBeenCalledWith({
      category: 'fashion',
      brand: undefined,
      inStock: false,
    });
  });

  it('keeps listing the whole branch of a department', () => {
    // The rule the toolbar's sort list is built from: a department cannot be ranked by match.
    expect(
      resolveListing(filters({ q: 'shirt', category: 'fashion', sort: 'relevance' }), SORTS, [
        FASHION,
        SHIRTS,
      ]).sorts,
    ).toEqual(['newest', 'price_asc']);
    expect(
      resolveListing(filters({ q: 'shirt', category: 'shirts', sort: 'relevance' }), SORTS, [
        FASHION,
        SHIRTS,
      ]).sorts,
    ).toEqual(SORTS);
  });
});
