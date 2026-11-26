import type { ProductListQuery } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { RelatedProducts } from '../features/catalog/related-products';
import { page, product, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { resetRouterMock, router } from '@/test-utils/expo-router-mock';
import { renderWithProviders } from '@/test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * "You may also like" on a product screen. The website's rule is the app's rule: more from the
 * same category first, then more from the same brand, never the product being read and never
 * the same product twice. A section with nothing to suggest is not drawn at all.
 */

const current = product({
  id: productId(1),
  slug: 'cotton-shirt',
  name: 'Cotton shirt',
  category: { slug: 'fashion', name: 'Fashion' },
  brand: { slug: 'aarong', name: 'Aarong' },
});

function suggestion(n: number, name: string) {
  return summary({ id: productId(n), slug: `product-${String(n)}`, name });
}

beforeEach(resetRouterMock);

describe('the product recommendations', () => {
  it('suggests other products from the category, never the product being read', async () => {
    const api = createFakeApiClient();
    api.listProducts.mockImplementation(() =>
      Promise.resolve(
        page([
          suggestion(2, 'Linen shirt'),
          current,
          suggestion(3, 'Oxford shirt'),
          suggestion(2, 'Linen shirt'),
        ]),
      ),
    );

    await renderWithProviders(<RelatedProducts product={current} />, { api });

    expect(await screen.findByText('You may also like')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Linen shirt, Price/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Oxford shirt, Price/ })).toBeOnTheScreen();
    // The product being read is never one of its own suggestions.
    expect(screen.queryByRole('button', { name: /^Cotton shirt, Price/ })).toBeNull();
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'fashion', sort: 'featured', page: 1 }),
      expect.anything(),
    );

    const row = screen.getByTestId('related-products-row');
    expect(row).toBeOnTheScreen();
  });

  it('falls back to the brand only when the category has not filled the row', async () => {
    const api = createFakeApiClient();
    api.listProducts.mockImplementation((query?: ProductListQuery) =>
      Promise.resolve(
        query?.brand === 'aarong'
          ? page([suggestion(4, 'Aarong kurta'), suggestion(5, 'Aarong panjabi')])
          : page([current, suggestion(2, 'Linen shirt')]),
      ),
    );

    await renderWithProviders(<RelatedProducts product={current} />, { api });

    expect(await screen.findByRole('button', { name: /^Aarong kurta, Price/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Aarong panjabi, Price/ })).toBeOnTheScreen();
    expect(api.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'aarong' }),
      expect.anything(),
    );
  });

  it('draws nothing when there is nothing to suggest', async () => {
    const api = createFakeApiClient();
    api.listProducts.mockResolvedValue(page([current]));

    const view = await renderWithProviders(<RelatedProducts product={current} />, { api });

    await waitFor(() => expect(api.listProducts).toHaveBeenCalled());
    await waitFor(() => expect(view.toJSON()).toBeNull());
  });

  it('says so and offers a retry when the suggestions cannot be read', async () => {
    const api = createFakeApiClient();
    api.listProducts.mockRejectedValue(new Error('offline'));

    const view = await renderWithProviders(<RelatedProducts product={current} />, { api });

    expect(await screen.findByText('We could not load recommendations')).toBeOnTheScreen();
    await view.user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(api.listProducts.mock.calls.length).toBeGreaterThan(1);
  });

  it('opens the whole category from its See all action', async () => {
    const api = createFakeApiClient();
    api.listProducts.mockResolvedValue(page([suggestion(2, 'Linen shirt')]));

    const view = await renderWithProviders(<RelatedProducts product={current} />, { api });
    await screen.findByRole('button', { name: /^Linen shirt, Price/ });

    await view.user.press(screen.getByRole('link', { name: 'See all products in Fashion' }));

    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/shop',
      params: { category: 'fashion' },
    });
  });
});
