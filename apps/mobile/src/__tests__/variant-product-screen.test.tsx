import type { ProductVariant } from '@nilzora/contracts';
import { screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import ProductScreen from '../../app/product/[slug]';
import { product, productId } from '../features/catalog/test-fixtures';
import { emptyReviews, myReview } from '../features/reviews/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
}));

const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';

function colourVariant(
  overrides: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'sku'>,
): ProductVariant {
  return {
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    imageUrl: null,
    options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' }],
    ...overrides,
  };
}

const red = colourVariant({ id: RED, sku: 'SHIRT-RED' });
const blue = colourVariant({
  id: BLUE,
  sku: 'SHIRT-BLUE',
  priceMinor: 140_000,
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
});

function productApi(found = product({ variants: [red, blue] })): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: found });
  api.productReviews.mockResolvedValue(emptyReviews());
  api.myProductReview.mockResolvedValue(myReview());
  return api;
}

beforeEach(() => {
  resetRouterMock();
  searchParams.slug = 'cotton-shirt';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProductScreen with variants', () => {
  it('offers the product options and asks for a choice before ordering', async () => {
    await renderWithProviders(<ProductScreen />, { api: productApi() });

    expect(await screen.findByRole('button', { name: 'Red' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeOnTheScreen();

    const addButton = screen.getByRole('button', {
      name: 'Choose your options before adding this to your cart',
    });
    expect(addButton).toBeDisabled();
    // "Buy now" stays put and disabled, so the bar does not reflow once a choice is made.
    expect(screen.getByRole('button', { name: /^Buy now/ })).toBeDisabled();
    expect(screen.getByText('Choose a colour to continue.')).toBeOnTheScreen();
  });

  it('shows the chosen variant price and SKU, then adds that variant', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
    });

    await user.press(await screen.findByRole('button', { name: 'Blue' }));

    expect(screen.getByText('SKU SHIRT-BLUE')).toBeOnTheScreen();
    expect(screen.getByText('Add to cart · ৳1,400')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Add to cart, 1 item, total 1,400 taka' }));

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: productId(1), variantId: BLUE, quantity: 1 },
    ]);
  });

  it('keeps two variants of one product as two cart lines', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
    });

    await user.press(await screen.findByRole('button', { name: 'Red' }));
    await user.press(screen.getByRole('button', { name: /^Add to cart/ }));
    await user.press(screen.getByRole('button', { name: 'Blue' }));
    await user.press(screen.getByRole('button', { name: /^Add to cart/ }));

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: productId(1), variantId: RED, quantity: 1 },
      { productId: productId(1), variantId: BLUE, quantity: 1 },
    ]);
  });

  it('marks a variant that is out of stock', async () => {
    const soldOut = colourVariant({
      id: BLUE,
      sku: 'SHIRT-BLUE',
      availability: 'out_of_stock',
      maxOrderQuantity: 0,
      options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
    });
    await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ variants: [red, soldOut] })),
    });

    expect(await screen.findByRole('button', { name: 'Blue, Sold out' })).toBeOnTheScreen();
  });

  it('draws a colour attribute as an accessible swatch and refuses a sold-out one', async () => {
    const black = colourVariant({
      id: RED,
      sku: 'SHIRT-BLACK',
      options: [
        {
          attribute: 'Colour',
          attributeSlug: 'colour',
          kind: 'color',
          value: 'Black',
          valueSlug: 'black',
          swatchHex: '#0F172A',
        },
      ],
    });
    const white = colourVariant({
      id: BLUE,
      sku: 'SHIRT-WHITE',
      availability: 'out_of_stock',
      maxOrderQuantity: 0,
      options: [
        {
          attribute: 'Colour',
          attributeSlug: 'colour',
          kind: 'color',
          value: 'White',
          valueSlug: 'white',
          swatchHex: '#F1F5F9',
        },
      ],
    });
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ variants: [black, white] })),
    });

    // The swatch carries its colour name: colour is never the only cue.
    const whiteSwatch = await screen.findByRole('button', { name: 'White, Sold out' });
    await user.press(whiteSwatch);
    expect(cartStore.getSnapshot().items).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Black' }));
    expect(await screen.findByText('SKU SHIRT-BLACK')).toBeOnTheScreen();
  });

  it('chooses a single variant for the customer', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ variants: [red] })),
    });

    expect(await screen.findByText('SKU SHIRT-RED')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: /^Add to cart/ }));

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: productId(1), variantId: RED, quantity: 1 },
    ]);
  });

  it('keeps a product without variants adding exactly as before', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ variants: [] })),
    });

    await user.press(await screen.findByRole('button', { name: /^Add to cart/ }));

    expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 1 }]);
  });
});
