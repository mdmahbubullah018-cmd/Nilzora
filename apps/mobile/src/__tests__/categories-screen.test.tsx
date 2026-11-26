import { screen } from '@testing-library/react-native';
import CategoriesScreen from '../../app/(tabs)/categories';
import { category, FASHION, GROCERIES } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const HIDDEN = { includeHiddenElements: true } as const;

beforeEach(resetRouterMock);

function categoriesApi(categories = [FASHION, GROCERIES]): FakeApiClient {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories });
  return api;
}

describe('CategoriesScreen', () => {
  it('lists the real categories with their product counts', async () => {
    await renderWithProviders(<CategoriesScreen />, { api: categoriesApi() });

    // Wait for the grid (the state list is replaced by the two-column one).
    expect(await screen.findByText('Fashion')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Categories' })).toBeOnTheScreen();
    expect(screen.getByText('3 products')).toBeOnTheScreen();
    expect(screen.getByText('1 product')).toBeOnTheScreen();
  });

  it('opens the chosen category page', async () => {
    const { user } = await renderWithProviders(<CategoriesScreen />, { api: categoriesApi() });

    await user.press(await screen.findByRole('button', { name: 'Fashion, 3 products' }));

    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'fashion' },
    });
  });

  it('shows the real cover image when a category has one, and the icon when it does not', async () => {
    const withCover = category({
      image: {
        url: 'https://media.example.test/categories/c/full.webp',
        thumbUrl: 'https://media.example.test/categories/c/thumb.webp',
      },
    });
    await renderWithProviders(<CategoriesScreen />, {
      api: categoriesApi([withCover, GROCERIES]),
    });

    await screen.findByText('Fashion');
    const covers = screen.getAllByTestId('category-tile-cover', HIDDEN);
    expect(covers).toHaveLength(1);
    expect((covers[0]?.props as { source: { uri: string } }).source.uri).toBe(
      'https://media.example.test/categories/c/thumb.webp',
    );
  });

  it('lists departments only, each saying how many subcategories it has', async () => {
    const child = category({
      slug: 'child-one',
      name: 'Child one',
      parentSlug: 'fashion',
      productCount: 2,
    });
    const { user } = await renderWithProviders(<CategoriesScreen />, {
      api: categoriesApi([FASHION, GROCERIES, child]),
    });

    expect(await screen.findByText('1 subcategory')).toBeOnTheScreen();
    // The subcategory is reached from its department, not listed beside it.
    expect(screen.queryByText('Child one')).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Fashion, 3 products, 1 subcategory' }));
    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'fashion' },
    });
  });

  it('explains an empty catalog instead of showing empty tiles', async () => {
    await renderWithProviders(<CategoriesScreen />, { api: categoriesApi([]) });

    expect(
      await screen.findByRole('header', { name: 'Categories are on their way' }),
    ).toBeOnTheScreen();
  });

  it('has the same header as the brand directory, with a working way back', async () => {
    const { user } = await renderWithProviders(<CategoriesScreen />, { api: categoriesApi() });

    await screen.findByText('Fashion');
    // Back on the left, the name, the cart on the right — and the search field under them.
    expect(screen.getByRole('header', { name: 'Categories' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Search categories')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cart' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Go back' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('narrows the departments with the search field, keeping a department that holds a match', async () => {
    const child = category({
      slug: 'kids',
      name: 'Kids',
      parentSlug: 'fashion',
      productCount: 1,
    });
    const { user } = await renderWithProviders(<CategoriesScreen />, {
      api: categoriesApi([FASHION, GROCERIES, child]),
    });

    await screen.findByText('Fashion');
    await user.type(screen.getByLabelText('Search categories'), 'groc');
    expect(screen.getByText('Groceries')).toBeOnTheScreen();
    expect(screen.queryByText('Fashion')).toBeNull();

    // The subcategory matches even though its department's own name does not.
    await user.clear(screen.getByLabelText('Search categories'));
    await user.type(screen.getByLabelText('Search categories'), 'kids');
    expect(screen.getByText('Fashion')).toBeOnTheScreen();
    expect(screen.queryByText('Groceries')).toBeNull();
  });

  it('says when nothing matches, and offers the whole list again', async () => {
    const { user } = await renderWithProviders(<CategoriesScreen />, { api: categoriesApi() });

    await screen.findByText('Fashion');
    await user.type(screen.getByLabelText('Search categories'), 'zzz');

    expect(screen.getByText(/No categories match/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Show all categories' }));
    expect(screen.getByText('Fashion')).toBeOnTheScreen();
    expect(screen.getByText('Groceries')).toBeOnTheScreen();
  });

  it('offers a retry when the categories could not be loaded', async () => {
    const api = createFakeApiClient();
    api.listCategories.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<CategoriesScreen />, { api });

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
