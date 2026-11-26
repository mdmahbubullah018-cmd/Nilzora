import type { ProductVariant } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import WishlistScreen from '../../app/(tabs)/wishlist';
import { ProductCard } from '../features/catalog/product-card';
import { product as detailOf, productId, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * Quick add of a product that is sold in variants. A listing entry does not say so, so a press
 * reads the product first; these tests check that nothing reaches the cart without the exact
 * variant, from a card and from a wishlist row.
 */

const SHIRT_ID = productId(1);
const M = 'ee000000-0000-4000-8000-00000000000a';
const L = 'ee000000-0000-4000-8000-00000000000b';
const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';
const RED_L = 'ee000000-0000-4000-8000-000000000003';

type Option = [attribute: string, value: string];

function variant(
  id: string,
  options: Option[],
  over: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    sku: `SKU-${id.slice(-2)}`,
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    imageUrl: null,
    options: options.map(([attribute, value]) => ({
      attribute,
      attributeSlug: attribute.toLowerCase(),
      kind: attribute === 'Size' ? 'size' : attribute === 'Colour' ? 'color' : 'other',
      value,
      valueSlug: value.toLowerCase(),
    })),
    ...over,
  };
}

const CARD = summary({ id: SHIRT_ID, slug: 'cotton-shirt', name: 'Cotton shirt' });
const SIZES = [variant(M, [['Size', 'M']]), variant(L, [['Size', 'L']])];

function apiWith(variants: ProductVariant[]): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: detailOf({ id: SHIRT_ID, variants }) });
  return api;
}

let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

beforeEach(() => {
  resetRouterMock();
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openFromCard(api: FakeApiClient) {
  const rendered = await renderWithProviders(<ProductCard product={CARD} width={160} />, { api });
  await rendered.user.press(screen.getByRole('button', { name: 'Add Cotton shirt to cart' }));
  return rendered;
}

const addButton = () => screen.getByRole('button', { name: /^Add to cart/ });

describe('quick add from a card, product with variants', () => {
  it('opens the options instead of adding anything', async () => {
    const { cartStore } = await openFromCard(apiWith(SIZES));

    expect(await screen.findByRole('header', { name: 'Select options' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'M' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'L' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'M' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false }),
    );
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('points at the missing size, keeps the customer in place and adds nothing', async () => {
    const { user, cartStore } = await openFromCard(apiWith(SIZES));
    await screen.findByRole('header', { name: 'Select options' });

    await user.press(addButton());

    expect(screen.getByText('Select a size')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Select options' })).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
    expect(announce).toHaveBeenCalledWith('Choose your options before adding this to your cart.');
  });

  it('adds the exact variant, with the quantity chosen, and closes', async () => {
    const { user, cartStore } = await openFromCard(apiWith(SIZES));
    await screen.findByRole('header', { name: 'Select options' });

    await user.press(screen.getByRole('button', { name: 'L' }));
    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));
    await user.press(addButton());

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: SHIRT_ID, variantId: L, quantity: 2 },
    ]);
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('Cotton shirt, L, added to cart'),
    );
    await waitFor(() => {
      expect(screen.queryByRole('header', { name: 'Select options' })).not.toBeOnTheScreen();
    });
  });

  it('requires a colour when the product only varies by colour', async () => {
    const { user, cartStore } = await openFromCard(
      apiWith([variant(RED, [['Colour', 'Red']]), variant(BLUE, [['Colour', 'Blue']])]),
    );
    await screen.findByRole('header', { name: 'Select options' });

    await user.press(addButton());

    expect(screen.getByText('Select a colour')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('blocks a partial choice across dimensions, then adds the exact combination', async () => {
    const redM = variant(RED, [
      ['Size', 'M'],
      ['Colour', 'Red'],
    ]);
    const blueM = variant(BLUE, [
      ['Size', 'M'],
      ['Colour', 'Blue'],
    ]);
    const redL = variant(RED_L, [
      ['Size', 'L'],
      ['Colour', 'Red'],
    ]);
    const { user, cartStore } = await openFromCard(apiWith([redM, blueM, redL]));
    await screen.findByRole('header', { name: 'Select options' });

    await user.press(screen.getByRole('button', { name: 'M' }));
    await user.press(addButton());
    // Only what is missing is pointed at.
    expect(screen.getByText('Select a colour')).toBeOnTheScreen();
    expect(screen.queryByText('Select a size')).not.toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Blue' }));
    await user.press(screen.getByRole('button', { name: /^Add to cart/ }));
    expect(cartStore.getSnapshot().items).toEqual([
      { productId: SHIRT_ID, variantId: BLUE, quantity: 1 },
    ]);
  });

  it('does not let a sold-out option be selected', async () => {
    const { user, cartStore } = await openFromCard(
      apiWith([
        variant(M, [['Size', 'M']], { availability: 'out_of_stock', maxOrderQuantity: 0 }),
        variant(L, [['Size', 'L']]),
      ]),
    );
    await screen.findByRole('header', { name: 'Select options' });

    const soldOut = screen.getByRole('button', { name: 'M, Sold out' });
    expect(soldOut).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true, selected: false }),
    );
    await user.press(soldOut);
    await user.press(addButton());

    expect(screen.getByText('Select a size')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('drops a choice no variant sells together, so an unsold combination cannot be added', async () => {
    const redM = variant(M, [
      ['Size', 'M'],
      ['Colour', 'Red'],
    ]);
    const blueL = variant(L, [
      ['Size', 'L'],
      ['Colour', 'Blue'],
    ]);
    const { user, cartStore } = await openFromCard(apiWith([redM, blueL]));
    await screen.findByRole('header', { name: 'Select options' });

    await user.press(screen.getByRole('button', { name: 'Red' }));
    await user.press(screen.getByRole('button', { name: 'L, not with this choice' }));
    await user.press(addButton());

    expect(screen.getByText('Select a colour')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('opens a single variant with it already chosen, and adds it', async () => {
    const { user, cartStore } = await openFromCard(apiWith([variant(M, [['Size', 'M']])]));
    await screen.findByRole('header', { name: 'Select options' });

    expect(screen.getByRole('button', { name: 'M' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );
    await user.press(addButton());

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: SHIRT_ID, variantId: M, quantity: 1 },
    ]);
  });

  it('keeps two variants of one product as separate lines', async () => {
    const { user, cartStore } = await openFromCard(apiWith(SIZES));
    await screen.findByRole('header', { name: 'Select options' });
    await user.press(screen.getByRole('button', { name: 'M' }));
    await user.press(addButton());
    await waitFor(() => {
      expect(screen.queryByRole('header', { name: 'Select options' })).not.toBeOnTheScreen();
    });

    await user.press(
      screen.getByRole('button', { name: /^Add one more Cotton shirt|^Add Cotton shirt/ }),
    );
    await screen.findByRole('header', { name: 'Select options' });
    await user.press(screen.getByRole('button', { name: 'L' }));
    await user.press(addButton());

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: SHIRT_ID, variantId: M, quantity: 1 },
      { productId: SHIRT_ID, variantId: L, quantity: 1 },
    ]);
  });
});

describe('quick add when the variants cannot be read', () => {
  it('adds nothing and offers a retry and the product', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockRejectedValue(new Error('offline'));
    const { user, cartStore } = await openFromCard(api);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(screen.getByText('Options could not be loaded')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'View product' }));
    expect(router.push).toHaveBeenCalledWith('/product/cotton-shirt');
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('shows the options when a retry succeeds, still adding nothing by itself', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockRejectedValueOnce(new Error('offline'));
    api.getProduct.mockResolvedValue({ product: detailOf({ id: SHIRT_ID, variants: SIZES }) });
    const { user, cartStore } = await openFromCard(api);

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'M' })).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('treats an answer about another product as unreadable', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockResolvedValue({ product: detailOf({ id: productId(99), variants: [] }) });
    const { cartStore } = await openFromCard(api);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('adds nothing in a build without an API address', async () => {
    const { user, cartStore } = await renderWithProviders(
      <ProductCard product={CARD} width={160} />,
      { api: null },
    );

    await user.press(screen.getByRole('button', { name: 'Add Cotton shirt to cart' }));

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });
});

describe('quick add from the wishlist', () => {
  it('adds a product without variants straight away, as before', async () => {
    const api = apiWith([]);
    const { user, cartStore } = await renderWithProviders(<WishlistScreen />, {
      api,
      wishlist: ['cotton-shirt'],
    });

    await user.press(await screen.findByRole('button', { name: 'Add Cotton shirt to cart' }));

    await waitFor(() => {
      expect(cartStore.getSnapshot().items).toEqual([{ productId: SHIRT_ID, quantity: 1 }]);
    });
  });

  it('opens the options for a product with variants and adds the exact one', async () => {
    const { user, cartStore } = await renderWithProviders(<WishlistScreen />, {
      api: apiWith(SIZES),
      wishlist: ['cotton-shirt'],
    });

    await user.press(await screen.findByRole('button', { name: 'Add Cotton shirt to cart' }));
    const header = await screen.findByRole('header', { name: 'Select options' });
    expect(header).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);

    await user.press(addButton());
    expect(screen.getByText('Select a size')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'M' }));
    await user.press(addButton());
    expect(cartStore.getSnapshot().items).toEqual([
      { productId: SHIRT_ID, variantId: M, quantity: 1 },
    ]);
  });
});
