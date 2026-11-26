import { screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import { MAX_CART_LINES } from '@nilzora/contracts';
import { ProductCard } from '../features/catalog/product-card';
import { product as detailOf, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

beforeEach(() => {
  resetRouterMock();
  jest.clearAllMocks();
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
});

const SHIRT = summary({ id: productId(1), slug: 'cotton-shirt', name: 'Cotton shirt' });

/** A quick add asks the catalog whether the product has variants; this one has none. */
function plainApi(found = detailOf({ id: productId(1) })) {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: found });
  return api;
}

describe('ProductCard', () => {
  it('is one element that reads the name, price and stock', async () => {
    await renderWithProviders(<ProductCard product={SHIRT} width={160} />);

    expect(
      screen.getByRole('button', { name: 'Cotton shirt, Price 1,250 taka, In stock' }),
    ).toBeOnTheScreen();
    // What is drawn inside the card is hidden from screen readers, so it is not read twice.
    expect(screen.queryByText('Cotton shirt')).not.toBeOnTheScreen();
    expect(screen.getByText('Cotton shirt', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('৳1,250', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('reads the former price and the saving, and shows the offer badge', async () => {
    const product = summary({
      id: productId(2),
      name: 'Rice cooker',
      priceMinor: 100_000,
      compareAtPriceMinor: 125_000,
      availability: 'low_stock',
    });
    await renderWithProviders(<ProductCard product={product} width={160} />);

    expect(
      screen.getByRole('button', {
        name: 'Rice cooker, Price 1,000 taka, was 1,250 taka, save 20 percent, Only a few left',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Save 20%', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('opens the product', async () => {
    const { user } = await renderWithProviders(<ProductCard product={SHIRT} width={160} />);

    await user.press(screen.getByRole('button', { name: /^Cotton shirt, Price/ }));

    expect(router.push).toHaveBeenCalledWith('/product/cotton-shirt');
  });

  it('previews the colours a product is sold in, and says the count', async () => {
    const colours = [
      { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
      { valueSlug: 'navy', value: 'Navy', swatchHex: '#1E3A8A' },
      { valueSlug: 'white', value: 'White', swatchHex: '#F1F5F9' },
    ];
    await renderWithProviders(
      <ProductCard product={summary({ ...SHIRT, colors: colours })} width={160} />,
    );

    // The card is still one element, and it now names the choice it previews.
    expect(
      screen.getByRole('button', { name: /^Cotton shirt, Price 1,250 taka, In stock, 3 colours$/ }),
    ).toBeOnTheScreen();
  });

  it('says nothing about colours when there is no choice to make', async () => {
    const one = [{ valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' }];
    await renderWithProviders(
      <ProductCard product={summary({ ...SHIRT, colors: one })} width={160} />,
    );

    expect(screen.getByRole('button', { name: /In stock$/ })).toBeOnTheScreen();
  });

  it('says when a product is out of stock and offers no quick add', async () => {
    const product = summary({ id: productId(3), name: 'Mug', availability: 'out_of_stock' });
    await renderWithProviders(<ProductCard product={product} width={160} />);

    expect(screen.getByRole('button', { name: /Mug, Price .*, Out of stock$/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Add Mug to cart/ })).not.toBeOnTheScreen();
  });

  it('offers no quick add when nothing can be ordered', async () => {
    const product = summary({ id: productId(3), name: 'Mug', maxOrderQuantity: 0 });
    await renderWithProviders(<ProductCard product={product} width={160} />);

    expect(screen.queryByRole('button', { name: /^Add Mug to cart/ })).not.toBeOnTheScreen();
  });
});

describe('ProductCard quick add', () => {
  it('adds one to the cart and shows the quantity it now holds', async () => {
    const { user, cartStore } = await renderWithProviders(
      <ProductCard product={SHIRT} width={160} />,
      { api: plainApi() },
    );

    await user.press(screen.getByRole('button', { name: 'Add Cotton shirt to cart' }));

    await waitFor(() => {
      expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 1 }]);
    });
    expect(announce).toHaveBeenCalledWith('Cotton shirt added to cart. 1 in your cart.');
    const again = await screen.findByRole('button', {
      name: 'Add one more Cotton shirt to cart, 1 in cart',
    });
    expect(again).toBeEnabled();
    expect(router.push).not.toHaveBeenCalled();

    await user.press(again);
    await waitFor(() => {
      expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 2 }]);
    });
  });

  it('stops at the most one order may hold and says so', async () => {
    const product = summary({ id: productId(1), name: 'Cotton shirt', maxOrderQuantity: 2 });
    const { user, cartStore } = await renderWithProviders(
      <ProductCard product={product} width={160} />,
      { cart: [{ productId: productId(1), quantity: 1 }], api: plainApi() },
    );

    await user.press(screen.getByRole('button', { name: /^Add one more Cotton shirt/ }));

    await waitFor(() => {
      expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 2 }]);
    });
    const atLimit = await screen.findByRole('button', {
      name: 'Cotton shirt: 2 in cart, the most you can order',
    });
    expect(atLimit).toBeDisabled();
  });

  it('tells the customer when the cart is full instead of failing silently', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const full = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: productId(100 + index),
      quantity: 1,
    }));
    const { user, cartStore } = await renderWithProviders(
      <ProductCard product={SHIRT} width={160} />,
      { cart: full, api: plainApi() },
    );

    await user.press(screen.getByRole('button', { name: 'Add Cotton shirt to cart' }));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith(
        'Cotton shirt',
        `Your cart is full (${MAX_CART_LINES} different products). Remove an item to add this one.`,
      );
    });
    expect(cartStore.getSnapshot().items).toHaveLength(MAX_CART_LINES);
    expect(announce).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
