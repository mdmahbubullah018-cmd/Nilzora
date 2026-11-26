import { screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import BrandsScreen from '../../app/brands/index';
import { brand } from '../features/brands/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { router, resetRouterMock } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { theme } from '../theme';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(() => {
  resetRouterMock();
});

const AARONG = brand({
  logo: {
    url: 'https://media.nilzora.test/brands/aarong/logo/full.webp',
    thumbUrl: 'https://media.nilzora.test/brands/aarong/logo/thumb.webp',
  },
});
const RANG = brand({ slug: 'rang-bangla', name: 'Rang Bangla', productCount: 2 });

function brandsApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listBrands.mockResolvedValue({ brands: [AARONG, RANG] });
  return api;
}

describe('BrandsScreen', () => {
  it('lists the brands the API returned, with their product counts', async () => {
    await renderWithProviders(<BrandsScreen />, { api: brandsApi() });

    expect(await screen.findByRole('button', { name: 'Aarong, 4 products' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Rang Bangla, 2 products' })).toBeOnTheScreen();
  });

  it('opens a brand from the list', async () => {
    const { user } = await renderWithProviders(<BrandsScreen />, { api: brandsApi() });

    await user.press(await screen.findByRole('button', { name: 'Rang Bangla, 2 products' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/brand/[slug]',
      params: { slug: 'rang-bangla' },
    });
  });

  it('filters the fetched brands locally, since there is no brand-search endpoint', async () => {
    const api = brandsApi();
    const { user } = await renderWithProviders(<BrandsScreen />, { api });

    await user.type(await screen.findByLabelText('Search brands'), 'rang');

    expect(screen.getByRole('button', { name: 'Rang Bangla, 2 products' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Aarong, 4 products' })).not.toBeOnTheScreen();
    // Filtering is local: the collection was fetched once and no second request was made.
    expect(api.listBrands).toHaveBeenCalledTimes(1);
  });

  it('explains a search with no matches and can clear it', async () => {
    const { user } = await renderWithProviders(<BrandsScreen />, { api: brandsApi() });

    await user.type(await screen.findByLabelText('Search brands'), 'zzz');

    expect(await screen.findByRole('header', { name: 'No brands match “zzz”' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Show all brands' }));

    expect(await screen.findByRole('button', { name: 'Aarong, 4 products' })).toBeOnTheScreen();
  });

  it('offers a retry when the brand list fails', async () => {
    const api = brandsApi();
    api.listBrands.mockRejectedValueOnce(new Error('network down'));
    const { user } = await renderWithProviders(<BrandsScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Aarong, 4 products' })).toBeOnTheScreen();
  });

  it('draws each brand as a card holding the logo, the name and the count', async () => {
    await renderWithProviders(<BrandsScreen />, { api: brandsApi() });

    const tile = await screen.findByRole('button', { name: 'Aarong, 4 products' });
    // A card surface, like an All Categories tile — every element stays inside its boundary.
    expect(tile).toHaveStyle({ backgroundColor: theme.colors.surface });
    const flat = StyleSheet.flatten(tile.props.style as object) as { borderWidth?: number };
    expect(flat.borderWidth).toBeGreaterThan(0);
    // The mark keeps its own proportions…
    const logo = within(tile).getByTestId('brand-logo');
    expect(logo.props.resizeMode).toBe('contain');
    // …and the two lines under it are centred, inside the card.
    expect(within(tile).getByText('Aarong')).toHaveStyle({ textAlign: 'center' });
    expect(within(tile).getByText('4 products')).toHaveStyle({ textAlign: 'center' });
  });

  it('says the directory is empty instead of showing an empty grid', async () => {
    const api = brandsApi();
    api.listBrands.mockResolvedValue({ brands: [] });
    await renderWithProviders(<BrandsScreen />, { api });

    expect(
      await screen.findByRole('header', { name: 'Brands are on their way' }),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Search brands')).not.toBeOnTheScreen();
  });
});
