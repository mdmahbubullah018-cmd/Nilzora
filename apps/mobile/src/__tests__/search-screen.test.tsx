import { ApiError } from '@nilzora/api-client';
import { StyleSheet } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import SearchScreen from '../../app/search';
import type { ShopFilters } from '@/features/catalog/catalog-query';
import { SEARCH_DEBOUNCE_MS, useSearchResults } from '@/features/search/search-hooks';
import { FASHION, GROCERIES, page, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import {
  renderWithProviders,
  renderHookWithProviders,
  resetAsyncStorage,
} from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(async () => {
  resetRouterMock();
  // Recent searches are device-local, so they outlive a screen; each test starts without them.
  await resetAsyncStorage();
});

const SHIRT = summary({ id: productId(1), slug: 'cotton-shirt', name: 'Cotton shirt' });
const RICE = summary({ id: productId(2), slug: 'basmati-rice', name: 'Basmati rice' });

const NO_SIGNAL: unknown = expect.anything();
const offline = () => new ApiError(0, 'network_error', 'offline');
const card = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}, Price`) });

/** Long enough for the debounce to fire and the settled request to resolve. */
const settle = (ms = SEARCH_DEBOUNCE_MS + 150) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

function searchApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION, GROCERIES] });
  api.discovery.mockResolvedValue({ sections: [] });
  api.listProducts.mockResolvedValue(page([SHIRT, RICE]));
  return api;
}
describe('SearchScreen', () => {
  it('opens on the store’s own discovery sections, without asking for a query', async () => {
    const api = searchApi();
    api.discovery.mockResolvedValue({
      sections: [
        { key: 'best-selling', title: 'Best selling', items: [{ product: SHIRT, rating: null }] },
      ],
    });
    await renderWithProviders(<SearchScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Best selling' })).toBeOnTheScreen();
    expect(api.discovery).toHaveBeenCalledTimes(1);
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('says what it needs for a single letter and sends nothing', async () => {
    const api = searchApi();
    await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 's');

    expect(screen.getByText('Type at least 2 letters.')).toBeOnTheScreen();
    await settle();
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('sends one request for the word the customer stopped typing', async () => {
    const api = searchApi();
    await renderWithProviders(<SearchScreen />, { api });
    const field = screen.getByLabelText('Search products');

    await fireEvent.changeText(field, 'shi');
    await fireEvent.changeText(field, 'shirt');

    // Nothing has been asked yet: the word is still being typed.
    expect(api.listProducts).not.toHaveBeenCalled();

    expect(await card('Cotton shirt')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.listProducts).toHaveBeenCalledWith(
      // Relevance first: a search is ranked, a browse is not.
      { q: 'shirt', sort: 'relevance', page: 1, pageSize: 24 },
      NO_SIGNAL,
    );
  });

  it('searches at once with the keyboard search key', async () => {
    const api = searchApi();
    await renderWithProviders(<SearchScreen />, { api });

    const field = screen.getByLabelText('Search products');
    await fireEvent.changeText(field, '  rice  ');
    await fireEvent(field, 'submitEditing');

    expect(await card('Basmati rice')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      { q: 'rice', sort: 'relevance', page: 1, pageSize: 24 },
      NO_SIGNAL,
    );
  });

  it('remembers a search on this device and runs it again from the list', async () => {
    const api = searchApi();
    await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'shirt');
    await card('Cotton shirt');

    // The field is empty again: the screen offers what this device searched before.
    await fireEvent.changeText(screen.getByLabelText('Search products'), '');
    await fireEvent(screen.getByLabelText('Search products'), 'focus');

    expect(await screen.findByRole('button', { name: 'Search for shirt' })).toBeOnTheScreen();
  });

  it('explains a search with no matches and starts again from the empty state', async () => {
    const api = searchApi();
    api.listProducts.mockResolvedValue(page([]));
    const { user } = await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'zzz');

    expect(await screen.findByText(/No products match/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Start a new search' }));

    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('');
    expect(await screen.findByText(/Search the shop: type a product/)).toBeOnTheScreen();
  });

  it('shows an error with a retry, then the results', async () => {
    const api = searchApi();
    api.listProducts.mockRejectedValue(offline());
    const { user } = await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'shirt');
    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();

    api.listProducts.mockResolvedValue(page([SHIRT]));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await card('Cotton shirt')).toBeOnTheScreen();
  });

  it('pages through the results through the API, not through a whole catalogue', async () => {
    const api = searchApi();
    api.listProducts.mockResolvedValue(
      page([SHIRT], { page: 1, pageSize: 1, total: 2, totalPages: 2 }),
    );
    const { user } = await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'shirt');
    await card('Cotton shirt');

    api.listProducts.mockResolvedValue(
      page([RICE], { page: 2, pageSize: 1, total: 2, totalPages: 2 }),
    );
    await user.press(screen.getByRole('button', { name: 'Load more results' }));

    expect(await card('Basmati rice')).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenLastCalledWith(
      { q: 'shirt', sort: 'relevance', page: 2, pageSize: 24 },
      NO_SIGNAL,
    );
  });

  it('re-ranks the same search when another order is picked', async () => {
    const api = searchApi();
    const { user } = await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'shirt');
    await card('Cotton shirt');

    await user.press(screen.getByRole('button', { name: 'Sort by, Best match' }));
    await user.press(screen.getByRole('radio', { name: 'Price: low to high' }));

    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { q: 'shirt', sort: 'price_asc', page: 1, pageSize: 24 },
        NO_SIGNAL,
      );
    });
  });

  it('applies every refinement the filter sheet offers to the same search', async () => {
    const api = searchApi();
    api.listBrands.mockResolvedValue({
      brands: [
        {
          slug: 'aarong',
          name: 'Aarong',
          description: null,
          logo: null,
          banner: null,
          productCount: 4,
        },
      ],
    });
    api.productFacets.mockResolvedValue({
      facets: {
        sizes: [{ slug: 'm', value: 'M', productCount: 2 }],
        colors: [{ slug: 'blue', value: 'Blue', productCount: 1, swatchHex: '#0284c7' }],
      },
    });
    const { user } = await renderWithProviders(<SearchScreen />, { api });

    await fireEvent.changeText(screen.getByLabelText('Search products'), 'shirt');
    await card('Cotton shirt');

    // The sheet is the only place these refinements live on this screen.
    await user.press(screen.getByRole('button', { name: 'Filters' }));
    await user.press(within(screen.getByTestId('filter-sheet')).getByLabelText('In stock only'));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    await waitFor(() => {
      // A refined search is listed newest first: the API refuses best-match ranking once
      // filters narrow it.
      expect(api.listProducts).toHaveBeenLastCalledWith(
        { q: 'shirt', inStock: true, sort: 'newest', page: 1, pageSize: 24 },
        NO_SIGNAL,
      );
    });
    // The query survives, and the badge now says one filter is on.
    expect(screen.getByLabelText('Search products')).toHaveDisplayValue('shirt');
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeOnTheScreen();
  });

  it('goes back, and falls back to the home screen when there is nothing behind it', async () => {
    const { user } = await renderWithProviders(<SearchScreen />, { api: searchApi() });

    await user.press(screen.getByRole('button', { name: 'Go back' }));
    expect(router.back).toHaveBeenCalledTimes(1);

    router.canGoBack.mockReturnValue(false);
    await user.press(screen.getByRole('button', { name: 'Go back' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

describe('useSearchResults', () => {
  it('asks for nothing until the query is long enough', async () => {
    const api = searchApi();
    const filters: ShopFilters = {
      q: 's',
      category: undefined,
      zone: undefined,
      sort: 'relevance',
    };

    const { result } = await renderHookWithProviders(
      () => useSearchResults(filters, { enabled: true }),
      { api },
    );

    expect(result.current.query.fetchStatus).toBe('idle');
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('caches one settled query, so returning to it does not ask again', async () => {
    const api = searchApi();
    const filters: ShopFilters = {
      q: 'shirt',
      category: undefined,
      zone: undefined,
      sort: 'relevance',
    };

    const { result, rerender } = await renderHookWithProviders(
      () => useSearchResults(filters, { enabled: true }),
      { api },
    );

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    await rerender({});

    expect(api.listProducts).toHaveBeenCalledTimes(1);
  });
});

describe('SearchScreen header layout', () => {
  /*
   * Style-level checks only: Jest has no layout engine, so the exact pixel position of the bar
   * under the status bar is confirmed on a device or emulator, not here.
   */
  it('lays the bar out with the screen padding, a short top lead and no negative offsets', async () => {
    await renderWithProviders(<SearchScreen />, { api: searchApi() });

    const row = screen.getByTestId('search-row');
    expect(row).toHaveStyle({
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      // 12dp: clear of the status bar without pushing the field down the page.
      paddingTop: 12,
      paddingBottom: 8,
    });
    // The row's own style never pulls anything outside its box.
    const style = StyleSheet.flatten(row.props.style as object) as Record<string, unknown>;
    expect(Object.keys(style).filter((key) => key.startsWith('margin'))).toEqual([]);
  });

  it('keeps the back control, the field and the filter control in the one row', async () => {
    await renderWithProviders(<SearchScreen />, { api: searchApi() });

    const row = screen.getByTestId('search-row');
    expect(within(row).getByRole('button', { name: 'Go back' })).toBeOnTheScreen();
    expect(within(row).getByRole('search')).toBeOnTheScreen();
    expect(within(row).getByRole('button', { name: 'Filters' })).toBeOnTheScreen();
  });
});
