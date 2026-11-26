import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import ShopScreen from '../../app/shop';
import {
  RECENT_SEARCHES_STORAGE_KEY,
  serializeSearches,
} from '../features/catalog/recent-searches';
import { FASHION, page } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(async () => {
  resetRouterMock();
  await resetAsyncStorage();
});

function shopApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION] });
  api.listProducts.mockResolvedValue(page([]));
  return api;
}

async function seedHistory(queries: string[]): Promise<void> {
  await AsyncStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, serializeSearches(queries));
}

describe('Shop recent searches', () => {
  it('shows the device-local history while the empty search field is focused', async () => {
    await seedHistory(['shirt']);
    await renderWithProviders(<ShopScreen />, { api: shopApi() });

    await fireEvent(screen.getByLabelText('Search products'), 'focus');

    expect(await screen.findByText('Recent searches')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search for shirt' })).toBeOnTheScreen();
  });

  it('runs a remembered search when it is chosen', async () => {
    await seedHistory(['shirt']);
    const { user } = await renderWithProviders(<ShopScreen />, { api: shopApi() });
    await fireEvent(screen.getByLabelText('Search products'), 'focus');

    await user.press(await screen.findByRole('button', { name: 'Search for shirt' }));

    expect(router.setParams).toHaveBeenCalledWith({ q: 'shirt' });
  });

  it('forgets the whole history when cleared', async () => {
    await seedHistory(['shirt', 'rice']);
    const { user } = await renderWithProviders(<ShopScreen />, { api: shopApi() });
    await fireEvent(screen.getByLabelText('Search products'), 'focus');

    await user.press(await screen.findByRole('button', { name: 'Clear recent searches' }));

    await waitFor(() => {
      expect(screen.queryByText('Recent searches')).not.toBeOnTheScreen();
    });
  });

  it('remembers a committed search, not every keystroke', async () => {
    searchParams.q = 'shirt';
    await renderWithProviders(<ShopScreen />, { api: shopApi() });

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
      expect(raw).toContain('shirt');
    });
  });
});

describe('Shop filters', () => {
  it('applies a category from the advanced filter sheet', async () => {
    const { user } = await renderWithProviders(<ShopScreen />, { api: shopApi() });

    await user.press(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByRole('header', { name: 'Filters' })).toBeOnTheScreen();

    // The category chips behind the sheet also offer "Fashion"; scope to the sheet itself.
    const sheet = within(await screen.findByTestId('filter-sheet'));
    await user.press(sheet.getByRole('radio', { name: 'Fashion' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    expect(router.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion', brand: undefined, stock: undefined }),
    );
  });

  it('sorts from the toolbar sheet', async () => {
    const { user } = await renderWithProviders(<ShopScreen />, { api: shopApi() });

    await user.press(screen.getByRole('button', { name: 'Sort' }));
    await user.press(await screen.findByRole('radio', { name: 'Newest' }));

    expect(router.setParams).toHaveBeenCalledWith({ sort: 'newest' });
  });

  it('shows the number of active filters on the button', async () => {
    searchParams.category = 'fashion';
    await renderWithProviders(<ShopScreen />, { api: shopApi() });

    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeOnTheScreen();
  });

  it('resets the advanced filters from the sheet, keeping the sort', async () => {
    searchParams.category = 'fashion';
    searchParams.sort = 'price_asc';
    const { user } = await renderWithProviders(<ShopScreen />, { api: shopApi() });

    await user.press(screen.getByRole('button', { name: 'Filters, 1 active' }));
    await user.press(await screen.findByRole('button', { name: 'Reset' }));

    expect(router.setParams).toHaveBeenCalledWith(
      expect.objectContaining({
        category: undefined,
        brand: undefined,
        stock: undefined,
        sort: 'price_asc',
      }),
    );
  });
});
