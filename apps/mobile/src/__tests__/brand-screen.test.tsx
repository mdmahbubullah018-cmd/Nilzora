import { ApiError } from '@nilzora/api-client';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import BrandScreen from '../../app/brand/[slug]';
import { brand } from '../features/brands/test-fixtures';
import { category, page, product } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { styleOf } from '../test-utils/style-of';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { theme } from '../theme';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(() => {
  resetRouterMock();
  searchParams.slug = 'aarong';
});

/**
 * A brand's listing is the catalogue listing with the brand pinned, so `listProducts` answers
 * it — the same call, filters and sort the shop and a category use.
 */
function brandApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.getBrand.mockResolvedValue({ brand: brand(), redirectTo: null });
  api.listProducts.mockResolvedValue(page([product({ name: 'Jamdani saree' })]));
  api.listCategories.mockResolvedValue({ categories: [category()] });
  return api;
}

describe('BrandScreen', () => {
  it('shows the real brand name, description and its products', async () => {
    const api = brandApi();
    api.getBrand.mockResolvedValue({
      brand: brand({ description: 'Handloom since 1978.' }),
      redirectTo: null,
    });
    await renderWithProviders(<BrandScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Aarong' })).toBeOnTheScreen();
    expect(screen.getByText('Handloom since 1978.')).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: /^Jamdani saree/ })).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'aarong', sort: 'featured' }),
      expect.anything(),
    );
  });

  it('sorts through the API-supported orders, still inside the brand', async () => {
    const api = brandApi();
    const { user } = await renderWithProviders(<BrandScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Sort' }));
    await user.press(await screen.findByRole('radio', { name: 'Newest' }));

    expect(api.listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ brand: 'aarong', sort: 'newest' }),
      expect.anything(),
    );
  });

  it('narrows by category from the filter sheet, brand included', async () => {
    const api = brandApi();
    const { user } = await renderWithProviders(<BrandScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Filters' }));
    await user.press(await screen.findByRole('radio', { name: 'Fashion' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ brand: 'aarong', category: 'fashion' }),
        expect.anything(),
      );
    });
  });

  it('resetting the sheet keeps the brand, which is the page and not a filter', async () => {
    const api = brandApi();
    const { user } = await renderWithProviders(<BrandScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Filters' }));
    await user.press(await screen.findByRole('radio', { name: 'Fashion' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));
    await waitFor(() => {
      expect(api.listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ brand: 'aarong', category: 'fashion' }),
        expect.anything(),
      );
    });

    await user.press(screen.getByRole('button', { name: 'Filters, 1 active' }));
    await user.press(await screen.findByRole('button', { name: 'Reset' }));

    const lastQuery = api.listProducts.mock.lastCall?.[0] as { brand?: string; category?: string };
    expect(lastQuery.brand).toBe('aarong');
    expect(lastQuery.category).toBeUndefined();
  });

  it('shows the brand’s banner with the count on it, and the identity below', async () => {
    const api = brandApi();
    api.getBrand.mockResolvedValue({
      brand: brand({
        banner: {
          url: 'https://media.example.test/brands/aarong/full.webp',
          thumbUrl: 'https://media.example.test/brands/aarong/thumb.webp',
        },
      }),
      redirectTo: null,
    });
    await renderWithProviders(<BrandScreen />, { api });

    const banner = await screen.findByTestId('brand-banner');
    expect((banner.props as { source: { uri: string } }).source.uri).toBe(
      'https://media.example.test/brands/aarong/full.webp',
    );
    // The artwork carries only the count: the mark never sits on the picture.
    expect(screen.getByText('1 product')).toBeOnTheScreen();
    // One heading only, and it belongs to the heading block below the banner — a quiet eyebrow,
    // the mark beside it, and the name on the page's own background, so it is always readable.
    expect(screen.getByText('Shop by Brand')).toBeOnTheScreen();
    const heading = screen.getByRole('header', { name: 'Aarong' });
    expect(screen.getAllByRole('header', { name: 'Aarong' })).toHaveLength(1);
    expect(styleOf(heading).color).toBe(theme.colors.foreground);
    expect(banner).not.toHaveTextContent('Aarong');
  });

  it('falls back to the brand’s own band when the banner cannot load', async () => {
    const api = brandApi();
    api.getBrand.mockResolvedValue({
      brand: brand({
        banner: {
          url: 'https://media.example.test/brands/aarong/full.webp',
          thumbUrl: 'https://media.example.test/brands/aarong/thumb.webp',
        },
      }),
      redirectTo: null,
    });
    await renderWithProviders(<BrandScreen />, { api });

    await fireEvent(await screen.findByTestId('brand-banner'), 'error');

    expect(screen.queryByTestId('brand-banner')).not.toBeOnTheScreen();
    // The name is still the page's heading, so nothing is lost with the picture.
    expect(screen.getByRole('header', { name: 'Aarong' })).toBeOnTheScreen();
  });

  it('follows the API when a former slug has a new address', async () => {
    const api = brandApi();
    api.getBrand.mockResolvedValue({ brand: null, redirectTo: 'aarong-bangladesh' });
    await renderWithProviders(<BrandScreen />, { api });

    // The screen spins instead of claiming the brand is missing.
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/brand/[slug]',
        params: { slug: 'aarong-bangladesh' },
      });
    });
    expect(screen.queryByRole('header', { name: 'Brand not found' })).not.toBeOnTheScreen();
  });

  it('explains a brand the API does not know, without listing products', async () => {
    const api = brandApi();
    api.getBrand.mockResolvedValue({ brand: null, redirectTo: null });
    await renderWithProviders(<BrandScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Brand not found' })).toBeOnTheScreen();
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('treats a 404 as not found', async () => {
    const api = brandApi();
    api.getBrand.mockRejectedValue(new ApiError(404, 'not_found', 'Missing'));
    await renderWithProviders(<BrandScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Brand not found' })).toBeOnTheScreen();
  });

  it('treats a malformed slug as not found without calling the API', async () => {
    searchParams.slug = 'Not A Slug';
    const api = brandApi();
    await renderWithProviders(<BrandScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Brand not found' })).toBeOnTheScreen();
    expect(api.getBrand).not.toHaveBeenCalled();
  });

  it('says the brand has no products yet instead of showing an empty grid', async () => {
    const api = brandApi();
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<BrandScreen />, { api });

    expect(await screen.findByRole('header', { name: 'No Aarong products yet' })).toBeOnTheScreen();
  });

  it('offers a retry when the product list fails', async () => {
    const api = brandApi();
    api.listProducts.mockRejectedValueOnce(new Error('network down'));
    const { user } = await renderWithProviders(<BrandScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /^Jamdani saree/ })).toBeOnTheScreen();
  });
});
