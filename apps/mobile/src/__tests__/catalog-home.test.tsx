import { ApiError } from '@nilzora/api-client';
import { screen } from '@testing-library/react-native';
import HomeScreen from '../../app/(tabs)/index';
import { brand } from '../features/brands/test-fixtures';
import {
  banner,
  FASHION,
  GROCERIES,
  page,
  productId,
  pullToRefresh,
  summary,
} from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

const SHIRT = summary({
  id: productId(1),
  slug: 'cotton-shirt',
  name: 'Cotton shirt',
  isFeatured: true,
});
const RICE = summary({
  id: productId(2),
  slug: 'basmati-rice',
  name: 'Basmati rice',
  priceMinor: 90_000,
  isFeatured: false,
  category: { slug: 'groceries', name: 'Groceries' },
});

/** An API with a small catalog: featured listing = [shirt, rice], newest = [rice, shirt]. */
function catalogApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION, GROCERIES] });
  api.listProducts.mockImplementation((query) =>
    Promise.resolve(page(query?.sort === 'newest' ? [RICE, SHIRT] : [SHIRT, RICE])),
  );
  return api;
}

const offline = () => new ApiError(0, 'network_error', 'offline');

describe('HomeScreen', () => {
  it('shows the welcome, categories, featured and new arrivals from the API', async () => {
    const api = catalogApi();
    await renderWithProviders(<HomeScreen />, { api });

    expect(
      await screen.findByRole('header', {
        name: 'Everyday style and essentials, delivered to your door.',
      }),
    ).toBeOnTheScreen();
    expect(screen.getAllByText('Cash on delivery')[0]).toBeOnTheScreen();

    expect(await screen.findByRole('button', { name: 'Fashion, 3 products' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Groceries, 1 product' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Featured' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'New arrivals' })).toBeOnTheScreen();

    // The shirt is featured and new; the rice only new: it appears once.
    expect(screen.getAllByRole('button', { name: /^Cotton shirt, Price/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Basmati rice, Price/ })).toHaveLength(1);

    expect(api.listProducts).toHaveBeenCalledWith(
      { sort: 'featured', pageSize: 8, page: 1 },
      expect.anything(),
    );
    expect(api.listProducts).toHaveBeenCalledWith(
      { sort: 'newest', pageSize: 8, page: 1 },
      expect.anything(),
    );
  });

  it('shows an accessible loading state in each section while data loads', async () => {
    const api = createFakeApiClient();
    api.listCategories.mockReturnValue(new Promise(() => undefined));
    api.listProducts.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<HomeScreen />, { api });

    expect(screen.getByRole('progressbar', { name: 'Loading categories' })).toBeBusy();
    expect(screen.getByRole('progressbar', { name: 'Loading featured products' })).toBeBusy();
    expect(screen.getByRole('progressbar', { name: 'Loading new arrivals' })).toBeBusy();
  });

  it('opens search, the shop, a category page and a product row from the home screen', async () => {
    const { user } = await renderWithProviders(<HomeScreen />, { api: catalogApi() });
    await screen.findByRole('button', { name: 'Fashion, 3 products' });

    await user.press(screen.getByRole('button', { name: 'Search products' }));
    // Search is its own screen now, not the shop page with the field focused.
    expect(router.push).toHaveBeenLastCalledWith('/search');

    await user.press(screen.getByRole('button', { name: 'Shop all products' }));
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/shop', params: {} });

    // A category tile opens that category's own page, not a filtered shop.
    await user.press(screen.getByRole('button', { name: 'Groceries, 1 product' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'groceries' },
    });

    await user.press(screen.getByRole('link', { name: 'See all categories' }));
    expect(router.navigate).toHaveBeenLastCalledWith('/categories');

    await user.press(screen.getByRole('link', { name: 'See all: New arrivals' }));
    expect(router.navigate).toHaveBeenLastCalledWith({
      pathname: '/shop',
      params: { sort: 'newest' },
    });

    await user.press(screen.getByRole('link', { name: 'See all: Featured' }));
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/shop', params: {} });
  });

  it('opens a product from a card', async () => {
    const { user } = await renderWithProviders(<HomeScreen />, { api: catalogApi() });

    await user.press(await screen.findByRole('button', { name: /^Basmati rice, Price/ }));

    expect(router.push).toHaveBeenCalledWith('/product/basmati-rice');
  });

  it("shows a category's real cover picture instead of the generic icon", async () => {
    const api = catalogApi();
    const withCover = {
      ...FASHION,
      image: {
        url: 'https://media.example.com/categories/fashion/full.webp',
        thumbUrl: 'https://media.example.com/categories/fashion/thumb.webp',
      },
    };
    api.listCategories.mockResolvedValue({ categories: [withCover, GROCERIES] });
    await renderWithProviders(<HomeScreen />, { api });

    const covers = await screen.findAllByTestId('category-tile-cover', {
      includeHiddenElements: true,
    });
    // Both tiles are the same frame; only the category with a cover draws a picture in it.
    expect(covers).toHaveLength(1);
    expect((covers[0]?.props as { source: { uri: string } }).source.uri).toBe(
      'https://media.example.com/categories/fashion/thumb.webp',
    );
  });

  it('lists a brand that has no products yet, so a new brand is not invisible', async () => {
    const api = catalogApi();
    api.listBrands.mockResolvedValue({
      brands: [brand({ slug: 'north-star', name: 'North Star', productCount: 0 })],
    });
    await renderWithProviders(<HomeScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Shop by brand' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'North Star, 0 products' })).toBeOnTheScreen();
  });

  it('hides sections that have nothing to show', async () => {
    const api = createFakeApiClient();
    api.listCategories.mockResolvedValue({ categories: [] });
    api.listProducts.mockResolvedValue(page([RICE])); // nothing is featured
    await renderWithProviders(<HomeScreen />, { api });

    expect(await screen.findByRole('header', { name: 'New arrivals' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Featured' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Shop by category' })).not.toBeOnTheScreen();
  });

  it('shows the published hero and campaign banners instead of the fallback hero card', async () => {
    const api = catalogApi();
    api.listBanners.mockImplementation((query) =>
      Promise.resolve({
        banners:
          query?.placement === 'home_hero'
            ? [banner({ title: 'Eid edit', subtitle: 'Fresh arrivals' })]
            : [
                banner({
                  id: '00000000-0000-4000-a000-000000000002',
                  placement: 'home_secondary',
                  title: 'Beauty week',
                }),
              ],
      }),
    );
    await renderWithProviders(<HomeScreen />, { api });

    expect(
      await screen.findByRole('button', { name: 'Eid edit. Fresh arrivals' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Beauty week' })).toBeOnTheScreen();
    // The strip is unlabelled: the banners speak for themselves.
    expect(screen.queryByRole('header', { name: 'Promotions' })).toBeNull();
    // The welcome card stands in only when the API has no hero banner.
    expect(screen.queryByRole('button', { name: 'Shop all products' })).not.toBeOnTheScreen();
  });

  it('leaves the promotion sections out when the placements are empty', async () => {
    const api = catalogApi();
    api.listBanners.mockResolvedValue({ banners: [] });
    await renderWithProviders(<HomeScreen />, { api });

    await screen.findByRole('button', { name: 'Fashion, 3 products' });
    expect(screen.queryByRole('header', { name: 'Promotions' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Shop all products' })).toBeOnTheScreen();
  });

  it('shows one friendly message when the whole catalog is empty', async () => {
    const api = createFakeApiClient();
    api.listCategories.mockResolvedValue({ categories: [FASHION] });
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<HomeScreen />, { api });

    expect(
      await screen.findByRole('header', { name: 'Products are on their way' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Featured' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Shop by category' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: /See all/ })).not.toBeOnTheScreen();
  });

  it('shows one error with a retry when nothing can be loaded, then recovers', async () => {
    const api = createFakeApiClient();
    api.listCategories.mockRejectedValue(offline());
    api.listProducts.mockRejectedValue(offline());
    const { user } = await renderWithProviders(<HomeScreen />, { api });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

    api.listCategories.mockResolvedValue({ categories: [FASHION] });
    api.listProducts.mockResolvedValue(page([SHIRT]));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Fashion, 3 products' })).toBeOnTheScreen();
    expect(screen.queryByText('Nilzora could not be reached')).not.toBeOnTheScreen();
  });

  it('keeps the rest of the page when one section fails, and retries just that one', async () => {
    const api = catalogApi();
    api.listProducts.mockImplementation((query) =>
      query?.sort === 'newest' ? Promise.reject(offline()) : Promise.resolve(page([SHIRT, RICE])),
    );
    const { user } = await renderWithProviders(<HomeScreen />, { api });

    expect(await screen.findByText('We could not load new arrivals')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Featured' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fashion, 3 products' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Basmati rice, Price/ })).not.toBeOnTheScreen();

    api.listProducts.mockImplementation(() => Promise.resolve(page([SHIRT, RICE])));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /^Basmati rice, Price/ })).toBeOnTheScreen();
    expect(screen.queryByText('We could not load new arrivals')).not.toBeOnTheScreen();
  });

  it('refreshes everything on pull-to-refresh', async () => {
    const api = catalogApi();
    await renderWithProviders(<HomeScreen />, { api });
    await screen.findByRole('button', { name: 'Fashion, 3 products' });
    expect(api.listCategories).toHaveBeenCalledTimes(1);
    expect(api.listProducts).toHaveBeenCalledTimes(2);

    await pullToRefresh('home-scroll');

    expect(api.listCategories).toHaveBeenCalledTimes(2);
    expect(api.listProducts).toHaveBeenCalledTimes(4);
  });

  it('keeps what is on screen and says so when a refresh fails', async () => {
    const api = catalogApi();
    await renderWithProviders(<HomeScreen />, { api });
    await screen.findByRole('button', { name: 'Fashion, 3 products' });

    api.listProducts.mockRejectedValue(offline());
    await pullToRefresh('home-scroll');

    expect(await screen.findByText('Could not refresh')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fashion, 3 products' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Cotton shirt, Price/ })).toHaveLength(2);
  });

  it('says the build is not set up when it has no API address', async () => {
    await renderWithProviders(<HomeScreen />, { api: null });

    expect(await screen.findByText('Nilzora is not set up')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
  });
});
