import { screen } from '@testing-library/react-native';
import CategoryScreen from '../../app/category/[slug]';
import { category, FASHION, GROCERIES, page, product } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(() => {
  resetRouterMock();
  searchParams.slug = 'fashion';
});

/** The category's name is the title of the screen's own header, drawn above the list. */
async function barTitle(name: string): Promise<void> {
  expect(await screen.findByRole('header', { name })).toBeOnTheScreen();
}

function categoryApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION, GROCERIES] });
  api.listProducts.mockResolvedValue(page([product()]));
  api.listBanners.mockResolvedValue({ banners: [] });
  api.listCampaigns.mockResolvedValue({ campaigns: [] });
  return api;
}

describe('CategoryScreen', () => {
  it('shows the real category name, count and its products', async () => {
    const api = categoryApi();
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByText('3 products')).toBeOnTheScreen();
    await barTitle('Fashion');
    // The card is one accessible element named with the product and its price (the quick-add
    // button starts with "Add", so anchoring the pattern picks the card).
    expect(await screen.findByRole('button', { name: /^Cotton shirt/ })).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion' }),
      expect.anything(),
    );
  });

  it('fixes the category filter, so the empty state cannot clear it', async () => {
    const api = categoryApi();
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByRole('header', { name: 'No products here yet' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeOnTheScreen();
  });

  it('sorts through the API-supported orders', async () => {
    const api = categoryApi();
    const { user } = await renderWithProviders(<CategoryScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Sort' }));
    await user.press(await screen.findByRole('radio', { name: 'Price: low to high' }));

    expect(api.listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'fashion', sort: 'price_asc' }),
      expect.anything(),
    );
  });

  it('explains an unknown category instead of inventing one', async () => {
    searchParams.slug = 'not-a-category';
    await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    expect(await screen.findByRole('header', { name: 'Category not found' })).toBeOnTheScreen();
  });

  it('treats a malformed slug as not found without calling the product list', async () => {
    searchParams.slug = 'Not A Slug';
    const api = categoryApi();
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Category not found' })).toBeOnTheScreen();
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('offers a way out of the not-found state', async () => {
    searchParams.slug = 'gone';
    const { user } = await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await user.press(await screen.findByRole('button', { name: 'Browse the shop' }));

    expect(router.replace).toHaveBeenCalledWith('/categories');
  });

  it('links the parent category and its subcategories from the published tree', async () => {
    const api = categoryApi();
    const parent = category({ slug: 'fashion', name: 'Fashion', productCount: 5 });
    const shirts = category({
      slug: 'shirts',
      name: 'Shirts',
      parentSlug: 'fashion',
      depth: 2,
      productCount: 2,
    });
    const child = category({
      slug: 'casual-shirts',
      name: 'Casual shirts',
      parentSlug: 'shirts',
      depth: 3,
      productCount: 1,
    });
    api.listCategories.mockResolvedValue({ categories: [parent, shirts, child] });
    api.listProducts.mockResolvedValue(page([]));
    searchParams.slug = 'shirts';
    const { user } = await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByRole('link', { name: 'All of Fashion' })).toBeOnTheScreen();
    await barTitle('Shirts');

    await user.press(screen.getByRole('link', { name: 'All of Fashion' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'fashion' },
    });

    await user.press(screen.getByRole('button', { name: 'Casual shirts, 1 product' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'casual-shirts' },
    });
  });

  it('names every subcategory in text, so none depends on its picture', async () => {
    const api = categoryApi();
    const parent = category({ slug: 'fashion', name: 'Fashion', productCount: 5 });
    const shirts = category({ slug: 'shirts', name: 'Shirts', parentSlug: 'fashion', depth: 2 });
    const pants = category({ slug: 'trousers', name: 'Trousers', parentSlug: 'fashion', depth: 2 });
    api.listCategories.mockResolvedValue({ categories: [parent, shirts, pants] });
    api.listProducts.mockResolvedValue(page([]));
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByText('Shirts')).toBeOnTheScreen();
    expect(screen.getByText('Trousers')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Shop Fashion by type' })).toBeOnTheScreen();
  });

  it('shows no subcategory block for a category without subcategories', async () => {
    await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await barTitle('Fashion');
    expect(screen.queryByText(/by type/)).not.toBeOnTheScreen();
  });

  it("shows the admin's banner when the category has one, in place of the cover", async () => {
    const api = categoryApi();
    api.listCategories.mockResolvedValue({
      categories: [
        category({
          image: {
            url: 'https://media.example.test/categories/c/cover.webp',
            thumbUrl: 'https://media.example.test/categories/c/cover-thumb.webp',
          },
          banner: {
            url: 'https://media.example.test/categories/c/banner.webp',
            thumbUrl: 'https://media.example.test/categories/c/banner-thumb.webp',
          },
        }),
      ],
    });
    await renderWithProviders(<CategoryScreen />, { api });

    const banner = await screen.findByTestId('category-banner', { includeHiddenElements: true });
    expect((banner.props as { source: { uri: string } }).source.uri).toBe(
      'https://media.example.test/categories/c/banner.webp',
    );
    expect(screen.queryByTestId('category-cover', { includeHiddenElements: true })).toBeNull();
  });

  it('shows a slim promotion bar only for a campaign the API returns for this category', async () => {
    const api = categoryApi();
    api.listCampaigns.mockResolvedValue({
      campaigns: [
        {
          id: '9d000000-0000-4000-8000-000000000001',
          title: 'Eid sale',
          discountKind: 'percent',
          discountValue: 20,
          maxDiscountMinor: null,
          startsAt: null,
          endsAt: null,
          productCount: 4,
          banner: null,
        },
      ] as never,
    });
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByTestId('category-campaign-bar')).toBeOnTheScreen();
    expect(screen.getByText('Eid sale')).toBeOnTheScreen();
    expect(screen.getByText('20% off')).toBeOnTheScreen();
    expect(api.listCampaigns).toHaveBeenCalledWith({ category: 'fashion' }, expect.anything());
  });

  it('shows no promotion bar when there is no live campaign', async () => {
    await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await barTitle('Fashion');
    expect(screen.queryByTestId('category-campaign-bar')).not.toBeOnTheScreen();
  });

  it('shows the real cover image when the category has one', async () => {
    const api = categoryApi();
    api.listCategories.mockResolvedValue({
      categories: [
        category({
          image: {
            url: 'https://media.example.test/categories/f/full.webp',
            thumbUrl: 'https://media.example.test/categories/f/thumb.webp',
          },
        }),
      ],
    });
    await renderWithProviders(<CategoryScreen />, { api });

    await barTitle('Fashion');
    const cover = screen.getByTestId('category-cover');
    expect((cover.props as { source: { uri: string } }).source.uri).toBe(
      'https://media.example.test/categories/f/full.webp',
    );
  });

  it('shows no cover and no hierarchy links for a top-level category without one', async () => {
    await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await barTitle('Fashion');
    expect(screen.queryByTestId('category-cover')).not.toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: /^All of / })).not.toBeOnTheScreen();
  });

  it('shows a real category banner when the API has one', async () => {
    const api = categoryApi();
    api.listBanners.mockResolvedValue({
      banners: [
        {
          id: '00000000-0000-4000-a000-000000000001',
          placement: 'category',
          title: 'Fashion week',
          subtitle: null,
          ctaLabel: null,
          ctaHref: null,
          image: null,
          categorySlug: 'fashion',
        },
      ],
    });
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByRole('button', { name: 'Fashion week' })).toBeOnTheScreen();
    expect(api.listBanners).toHaveBeenCalledWith(
      { placement: 'category', category: 'fashion' },
      expect.anything(),
    );
  });

  it('draws its own header: the category name, a back control and the cart, and no brand logo', async () => {
    await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await barTitle('Fashion');
    expect(screen.getByRole('button', { name: 'Go back' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cart' })).toBeOnTheScreen();
    expect(screen.queryByTestId('brand-logo')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('brand-logo-image')).not.toBeOnTheScreen();
  });

  it('shows a generic title until the category list has arrived, never a made-up name', async () => {
    const api = categoryApi();
    api.listCategories.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<CategoryScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Category' })).toBeOnTheScreen();
  });

  it('ellipsizes a long category name on one line so it cannot reach the cart', async () => {
    const api = categoryApi();
    const longName = 'Traditional handwoven festival and wedding collection for everyone';
    api.listCategories.mockResolvedValue({
      categories: [category({ slug: 'fashion', name: longName })],
    });
    await renderWithProviders(<CategoryScreen />, { api });

    const title = await screen.findByRole('header', { name: longName });
    expect(title.props.numberOfLines).toBe(1);
  });

  it('goes back through history when there is some', async () => {
    const { user } = await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await user.press(await screen.findByRole('button', { name: 'Go back' }));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('replaces with the Categories list when opened first (deep link or notification)', async () => {
    router.canGoBack.mockReturnValue(false);
    const { user } = await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    await user.press(await screen.findByRole('button', { name: 'Go back' }));

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/categories');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps the same header and back behaviour on the not-found screen', async () => {
    searchParams.slug = 'gone';
    router.canGoBack.mockReturnValue(false);
    const { user } = await renderWithProviders(<CategoryScreen />, { api: categoryApi() });

    expect(await screen.findByRole('header', { name: 'Category not found' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Category' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cart' })).toBeOnTheScreen();
    expect(screen.queryByTestId('brand-logo')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Go back' }));
    expect(router.replace).toHaveBeenCalledWith('/categories');
    expect(router.back).not.toHaveBeenCalled();
  });
});
