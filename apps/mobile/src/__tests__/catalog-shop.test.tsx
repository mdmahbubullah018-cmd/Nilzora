import { ApiError } from '@nilzora/api-client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import ShopScreen from '../../app/shop';
import {
  FASHION,
  GROCERIES,
  page,
  productId,
  pullToRefresh,
  summary,
} from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/** Re-renders the shop after the router changed its parameters (set while it is mounted). */
let rerender: (() => void) | undefined;

beforeEach(() => {
  resetRouterMock();
  // Like the real router, setParams merges into the route parameters (undefined removes one)
  // and the screen renders again with them.
  router.setParams.mockReset();
  router.setParams.mockImplementation((next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete searchParams[key];
      else searchParams[key] = value;
    }
    rerender?.();
  });
});

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

const SHIRT = summary({ id: productId(1), slug: 'cotton-shirt', name: 'Cotton shirt' });
const RICE = summary({
  id: productId(2),
  slug: 'basmati-rice',
  name: 'Basmati rice',
  priceMinor: 90_000,
  category: { slug: 'groceries', name: 'Groceries' },
});
const SOAP = summary({
  id: productId(3),
  slug: 'herbal-soap',
  name: 'Herbal soap',
  priceMinor: 12_000,
});

function shopApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION, GROCERIES] });
  api.listProducts.mockResolvedValue(page([SHIRT, RICE]));
  return api;
}

const offline = () => new ApiError(0, 'network_error', 'offline');
const card = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}, Price`) });
const NO_SIGNAL: unknown = expect.anything();

describe('ShopScreen listing', () => {
  it('lists the first page, featured first, with the number of products', async () => {
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(await card('Basmati rice')).toBeOnTheScreen();
    expect(screen.getByText('2 products')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      { sort: 'featured', pageSize: 24, page: 1 },
      NO_SIGNAL,
    );
  });

  it('shows an accessible loading state', async () => {
    const api = shopApi();
    api.listProducts.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<Shop />, { api });

    expect(screen.getByRole('progressbar', { name: 'Loading products' })).toBeBusy();
    await screen.unmount();
  });

  it('opens a product from the grid', async () => {
    const { user } = await renderWithProviders(<Shop />, { api: shopApi() });

    await user.press(await card('Basmati rice'));

    expect(router.push).toHaveBeenCalledWith('/product/basmati-rice');
  });

  it('shows an error with a retry, then the products', async () => {
    const api = shopApi();
    api.listProducts.mockRejectedValue(offline());
    const { user } = await renderWithProviders(<Shop />, { api });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();

    api.listProducts.mockResolvedValue(page([SHIRT]));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(screen.queryByText('Nilzora could not be reached')).not.toBeOnTheScreen();
  });

  it('says so when the catalog has no products and there is nothing to clear', async () => {
    const api = shopApi();
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<Shop />, { api });

    expect(
      await screen.findByRole('header', { name: 'Products are on their way' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeOnTheScreen();
  });

  it('says the build is not set up when it has no API address', async () => {
    await renderWithProviders(<Shop />, { api: null });

    expect(await screen.findByText('Nilzora is not set up')).toBeOnTheScreen();
  });

  it('refreshes on pull-to-refresh', async () => {
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');
    expect(api.listProducts).toHaveBeenCalledTimes(1);

    await pullToRefresh('shop-list');

    expect(api.listProducts).toHaveBeenCalledTimes(2);
  });
});

describe('ShopScreen filters', () => {
  it('filters by category from the chips and shows which one is selected', async () => {
    const api = shopApi();
    const { user } = await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');
    expect(screen.getByRole('radio', { name: 'All', checked: true })).toBeOnTheScreen();

    await user.press(await screen.findByRole('radio', { name: 'Groceries' }));

    expect(router.setParams).toHaveBeenCalledWith({ category: 'groceries' });
    expect(screen.getByRole('radio', { name: 'Groceries', checked: true })).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { category: 'groceries', sort: 'featured', pageSize: 24, page: 1 },
        NO_SIGNAL,
      );
    });

    await user.press(screen.getByRole('radio', { name: 'All' }));
    expect(router.setParams).toHaveBeenLastCalledWith({ category: undefined });
  });

  it('starts from the filters in the address (a link from Home)', async () => {
    searchParams.q = 'shirt';
    searchParams.category = 'fashion';
    searchParams.sort = 'newest';
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      { q: 'shirt', category: 'fashion', sort: 'newest', pageSize: 24, page: 1 },
      NO_SIGNAL,
    );
    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('shirt');
    expect(screen.getByRole('radio', { name: 'Fashion', checked: true })).toBeOnTheScreen();
    expect(screen.getByText('2 results for “shirt”')).toBeOnTheScreen();
  });

  it('ignores filters in the address that are not valid', async () => {
    searchParams.sort = 'drop table';
    searchParams.category = 'Not A Slug!';
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });

    await card('Cotton shirt');
    expect(api.listProducts).toHaveBeenCalledWith(
      { sort: 'featured', pageSize: 24, page: 1 },
      NO_SIGNAL,
    );
  });

  it('keeps a category from a link visible even when the category list lacks it', async () => {
    searchParams.category = 'office-supplies';
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });

    expect(
      await screen.findByRole('radio', { name: 'Office supplies', checked: true }),
    ).toBeOnTheScreen();
  });

  it('shows the listing without chips when the categories cannot load', async () => {
    const api = shopApi();
    api.listCategories.mockRejectedValue(offline());
    await renderWithProviders(<Shop />, { api });

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'All' })).not.toBeOnTheScreen();
  });
});

describe('ShopScreen search', () => {
  it('waits for a pause in typing, then searches by best match', async () => {
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'rice');
    expect(router.setParams).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(router.setParams).toHaveBeenCalledWith({ q: 'rice' });
    });
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { q: 'rice', sort: 'relevance', pageSize: 24, page: 1 },
        NO_SIGNAL,
      );
    });
    expect(router.setParams).toHaveBeenCalledTimes(1);
  });

  it('searches at once with the keyboard search key', async () => {
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    const input = screen.getByLabelText('Search products');
    await fireEvent.changeText(input, '  tea  ');
    await fireEvent(input, 'submitEditing');

    expect(router.setParams).toHaveBeenCalledWith({ q: 'tea' });
    expect(await screen.findByText('2 results for “tea”')).toBeOnTheScreen();
  });

  it('clears the search with the clear button', async () => {
    searchParams.q = 'rice';
    const api = shopApi();
    const { user } = await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    await user.press(screen.getByRole('button', { name: 'Clear search' }));

    expect(router.setParams).toHaveBeenCalledWith({ q: undefined });
    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeOnTheScreen();
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { sort: 'featured', pageSize: 24, page: 1 },
        NO_SIGNAL,
      );
    });
  });

  it('follows a search that arrives from outside without writing it back', async () => {
    const api = shopApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    await act(() => {
      router.setParams({ q: 'soap' });
    });

    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('soap');
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { q: 'soap', sort: 'relevance', pageSize: 24, page: 1 },
        NO_SIGNAL,
      );
    });
    // Longer than the debounce: the field's own timer must not write the same search again.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(router.setParams).toHaveBeenCalledTimes(1);
  });

  it('explains a search with no matches and clears every filter', async () => {
    searchParams.q = 'zzz';
    searchParams.category = 'fashion';
    const api = shopApi();
    api.listProducts.mockImplementation((query) =>
      Promise.resolve(query?.q ? page([]) : page([SHIRT])),
    );
    const { user } = await renderWithProviders(<Shop />, { api });

    expect(
      await screen.findByRole('header', { name: 'No products match “zzz”' }),
    ).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Clear filters' }));

    expect(router.setParams).toHaveBeenCalledWith({
      q: undefined,
      category: undefined,
      sort: undefined,
    });
    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('');
  });

  it('says a category is empty when no search is involved', async () => {
    searchParams.category = 'groceries';
    const api = shopApi();
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<Shop />, { api });

    expect(await screen.findByRole('header', { name: 'No products here yet' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeOnTheScreen();
  });
});

describe('ShopScreen sorting', () => {
  it('offers the browsing sorts with the storefront labels and applies a choice', async () => {
    const api = shopApi();
    const { user } = await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    // The default sort's chip simply reads "Sort"; choosing one states it on the chip.
    const trigger = screen.getByRole('button', { name: 'Sort' });
    await user.press(trigger);

    for (const label of ['Featured', 'Newest', 'Price: low to high', 'Price: high to low']) {
      expect(screen.getByRole('radio', { name: label })).toBeOnTheScreen();
    }
    expect(screen.queryByRole('radio', { name: 'Best match' })).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Featured', checked: true })).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Price: low to high' }));

    expect(router.setParams).toHaveBeenCalledWith({ sort: 'price_asc' });
    expect(screen.queryByRole('radio', { name: 'Newest' })).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Sort: Price: low to high' }),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { sort: 'price_asc', pageSize: 24, page: 1 },
        NO_SIGNAL,
      );
    });
  });

  it('leaves the default sort out of the address', async () => {
    searchParams.sort = 'newest';
    const { user } = await renderWithProviders(<Shop />, { api: shopApi() });
    await card('Cotton shirt');

    await user.press(screen.getByRole('button', { name: 'Sort: Newest' }));
    await user.press(screen.getByRole('radio', { name: 'Featured' }));

    expect(router.setParams).toHaveBeenCalledWith({ sort: undefined });
  });

  it('offers best match only while searching', async () => {
    searchParams.q = 'rice';
    const { user } = await renderWithProviders(<Shop />, { api: shopApi() });
    await card('Cotton shirt');

    await user.press(screen.getByRole('button', { name: 'Sort' }));

    expect(screen.getByRole('radio', { name: 'Best match', checked: true })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Featured' })).not.toBeOnTheScreen();
  });
});

describe('ShopScreen paging', () => {
  function pagedApi() {
    const api = shopApi();
    api.listProducts.mockImplementation((query) =>
      Promise.resolve(
        query?.page === 2
          ? page([SOAP], { page: 2, total: 3, totalPages: 2 })
          : page([SHIRT, RICE], { page: 1, total: 3, totalPages: 2 }),
      ),
    );
    return api;
  }

  it('loads the next page at the end of the list, once, and stops after the last', async () => {
    const api = pagedApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');
    expect(screen.getByText('3 products')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Herbal soap, Price/ })).not.toBeOnTheScreen();

    const list = screen.getByTestId('shop-list');
    await fireEvent(list, 'endReached');

    expect(await card('Herbal soap')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenLastCalledWith(
      { sort: 'featured', pageSize: 24, page: 2 },
      NO_SIGNAL,
    );
    expect(screen.getByRole('button', { name: /^Cotton shirt, Price/ })).toBeOnTheScreen();

    await fireEvent(list, 'endReached');
    await act(() => Promise.resolve());
    expect(api.listProducts).toHaveBeenCalledTimes(2);
  });

  it('shows a loading indicator while the next page loads', async () => {
    const api = pagedApi();
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');
    api.listProducts.mockReturnValue(new Promise(() => undefined));

    await fireEvent(screen.getByTestId('shop-list'), 'endReached');

    expect(
      await screen.findByRole('progressbar', { name: 'Loading more products' }),
    ).toBeOnTheScreen();
  });

  it('does not retry a failed page by itself, and retries it on request', async () => {
    const api = pagedApi();
    const { user } = await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');
    api.listProducts.mockRejectedValue(offline());

    const list = screen.getByTestId('shop-list');
    await fireEvent(list, 'endReached');
    expect(await screen.findByText('Could not load more products')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Cotton shirt, Price/ })).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledTimes(2);

    await fireEvent(list, 'endReached');
    await act(() => Promise.resolve());
    expect(api.listProducts).toHaveBeenCalledTimes(2);

    api.listProducts.mockResolvedValue(page([SOAP], { page: 2, total: 3, totalPages: 2 }));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await card('Herbal soap')).toBeOnTheScreen();
    expect(screen.queryByText('Could not load more products')).not.toBeOnTheScreen();
  });

  it('shows each product once even if a page repeats one', async () => {
    const api = shopApi();
    api.listProducts.mockImplementation((query) =>
      Promise.resolve(
        query?.page === 2
          ? page([RICE, SOAP], { page: 2, total: 3, totalPages: 2 })
          : page([SHIRT, RICE], { page: 1, total: 3, totalPages: 2 }),
      ),
    );
    await renderWithProviders(<Shop />, { api });
    await card('Cotton shirt');

    await fireEvent(screen.getByTestId('shop-list'), 'endReached');
    await card('Herbal soap');

    expect(screen.getAllByRole('button', { name: /^Basmati rice, Price/ })).toHaveLength(1);
  });
});
