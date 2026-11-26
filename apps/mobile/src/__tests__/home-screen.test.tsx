import { screen } from '@testing-library/react-native';
import HomeScreen from '../../app/(tabs)/index';
import { FASHION, page } from '../features/catalog/test-fixtures';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

function emptyCatalogApi() {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION] });
  api.listProducts.mockResolvedValue(page([]));
  return api;
}

describe('HomeScreen', () => {
  it('introduces the store without offering products that do not exist', async () => {
    await renderWithProviders(<HomeScreen />, { api: emptyCatalogApi() });

    expect(
      await screen.findByRole('header', {
        name: 'Everyday style and essentials, delivered to your door.',
      }),
    ).toBeOnTheScreen();
    expect(
      await screen.findByRole('header', { name: 'Products are on their way' }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Opening soon')).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Featured' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'New arrivals' })).not.toBeOnTheScreen();
    // The trust panel is part of the page even when the catalog has nothing to show yet.
    expect(screen.getByText('Easy Returns')).toBeOnTheScreen();
    expect(screen.getByText('Secure Checkout')).toBeOnTheScreen();
    expect(screen.getByText('Support')).toBeOnTheScreen();
  });

  it('explains Cash on Delivery and that delivery is priced at checkout', async () => {
    await renderWithProviders(<HomeScreen />, { api: emptyCatalogApi() });

    // The welcome card stands in when the shop has published no hero banner.
    await screen.findByRole('header', {
      name: 'Everyday style and essentials, delivered to your door.',
    });
    // The pill and the fact row both name the payment method.
    expect(screen.getAllByText('Cash on delivery').length).toBeGreaterThan(0);
    expect(screen.getByText(/pay in cash when your parcel\s+arrives/)).toBeOnTheScreen();
    expect(screen.getByText(/shown at checkout/)).toBeOnTheScreen();
  });
});
