import { ApiError } from '@nilzora/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartLine, CartQuote } from '@nilzora/contracts';
import { act, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CartProvider, useCart } from '../cart/cart-context';
import { cartBadgeLabel } from '../cart/cart-badge';
import {
  applyCartFixes,
  cartLineName,
  cartLineProblemText,
  describeCartFixes,
  planCartFixes,
  summarizeCartFixes,
} from '../cart/cart-problems';
import { CART_STORAGE_KEY, createCartStore, parseStoredCart } from '../cart/cart-store';
import { useCartQuote } from '../cart/use-cart-quote';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B, PRODUCT_C } from '../test-utils/cart-fakes';
import {
  renderHookWithProviders,
  renderWithProviders,
  resetAsyncStorage,
} from '../test-utils/render-with-providers';

function line(overrides: Partial<CartLine> & { productId: string }): CartLine {
  return {
    variantId: null,
    variantLabel: null,
    slug: 'mug',
    name: 'Blue mug',
    sku: 'MUG-1',
    unitPriceMinor: 50_000,
    compareAtPriceMinor: null,
    listPriceMinor: null,
    campaignDiscountMinor: 0,
    campaign: null,
    quantity: 1,
    lineTotalMinor: 50_000,
    availableQuantity: 10,
    problem: null,
    image: null,
    ...overrides,
  };
}

function quoteOf(lines: CartLine[]): CartQuote {
  return {
    lines,
    itemCount: lines.reduce((total, l) => total + (l.problem === null ? l.quantity : 0), 0),
    subtotalMinor: lines.reduce((total, l) => total + (l.lineTotalMinor ?? 0), 0),
    campaignDiscountMinor: 0,
    deliveryZone: null,
    shippingFeeMinor: null,
    totalMinor: null,
    purchasable: lines.every((l) => l.problem === null),
  };
}

describe('CartProvider and useCart', () => {
  beforeEach(resetAsyncStorage);

  it('hydrates the saved cart from AsyncStorage by default and persists changes to it', async () => {
    await AsyncStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ v: 1, items: [{ productId: PRODUCT_A, quantity: 2 }] }),
    );

    const { result } = await renderHook(() => useCart(), { wrapper: CartProvider });
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
    });
    expect(result.current.items).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    expect(result.current.count).toBe(2);

    await act(() => {
      result.current.add(PRODUCT_B, 3);
    });
    expect(result.current.count).toBe(5);
    await waitFor(async () => {
      expect(parseStoredCart((await AsyncStorage.getItem(CART_STORAGE_KEY)) ?? '')).toHaveLength(2);
    });
  });

  it('exposes the actions and a per-product quantity', async () => {
    const { result } = await renderHookWithProviders(() => useCart(), {
      cart: [{ productId: PRODUCT_A, quantity: 2 }],
    });

    expect(result.current.quantityOf(PRODUCT_A)).toBe(2);
    expect(result.current.quantityOf(PRODUCT_A.toUpperCase())).toBe(2);
    expect(result.current.quantityOf(PRODUCT_B)).toBe(0);

    await act(() => {
      expect(result.current.add(PRODUCT_A, 1, 2)).toBe('at_limit');
      result.current.setQuantity(PRODUCT_A, 4);
      result.current.add(PRODUCT_B);
    });
    expect(result.current.items).toEqual([
      { productId: PRODUCT_A, quantity: 4 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);

    await act(() => {
      result.current.remove(PRODUCT_A);
    });
    expect(result.current.count).toBe(1);
    await act(() => {
      result.current.clear();
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.hydrated).toBe(true);
  });

  it('exposes the selection as part of the cart snapshot', async () => {
    const { result } = await renderHookWithProviders(() => useCart(), {
      cart: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
    });

    // A cart that was saved before selection existed starts fully selected.
    expect(result.current.selectedItems).toEqual([
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);
    // Units, not lines: the same count the cart's subtotal is labelled with.
    expect(result.current.selectedCount).toBe(3);

    await act(() => {
      result.current.setSelected(PRODUCT_B, null, false);
    });
    // The cart is untouched; only what an order would contain changes.
    expect(result.current.items).toHaveLength(2);
    expect(result.current.selectedItems).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected(PRODUCT_A)).toBe(true);
    expect(result.current.isSelected(PRODUCT_B)).toBe(false);

    await act(() => {
      result.current.setAllSelected(true);
    });
    expect(result.current.selectedCount).toBe(3);

    await act(() => {
      result.current.removeMany([{ productId: PRODUCT_A }]);
    });
    expect(result.current.items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
    expect(result.current.selectedItems).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
  });

  it('keeps the same handle between renders when nothing changed', async () => {
    const { result, rerender } = await renderHookWithProviders(() => useCart());
    const first = result.current;
    await rerender(undefined);
    expect(result.current).toBe(first);
  });

  it('refuses to be used without a provider', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useCart())).rejects.toThrow(
      'useCart() must be used inside <CartProvider>',
    );
    error.mockRestore();
  });

  it('survives a storage that cannot be written', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cartStorage = createMemoryCartStorage();
    cartStorage.setItem.mockRejectedValue(new Error('disk full'));
    const { result, cartStore } = await renderHookWithProviders(() => useCart(), { cartStorage });

    await act(() => {
      result.current.add(PRODUCT_A, 2);
    });
    await cartStore.flush();

    expect(result.current.count).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cart could not be saved'));
    warn.mockRestore();
  });
});

describe('useCartQuote', () => {
  const lines = [line({ productId: PRODUCT_A, quantity: 2, lineTotalMinor: 100_000 })];

  it('does not call the API while the cart is empty', async () => {
    const api = createFakeApiClient();
    const { result } = await renderHookWithProviders(() => useCartQuote(), { api });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(api.quoteCart).not.toHaveBeenCalled();
  });

  it('waits for the saved cart to be read before pricing anything', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({ quote: quoteOf(lines) });
    const cartStorage = createMemoryCartStorage();
    // The store reads two keys on start (the cart and its selection). Nothing is answered until
    // the test says so; from then on every read answers at once, as a device would.
    let released = false;
    const waiting: (() => void)[] = [];
    cartStorage.getItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          const answer = () => {
            resolve(null);
          };
          if (released) answer();
          else waiting.push(answer);
        }),
    );
    const cartStore = createCartStore({ storage: cartStorage });
    cartStore.add(PRODUCT_A, 2); // made before the saved cart was read
    const { result } = await renderHookWithProviders(() => useCartQuote(), {
      api,
      cart: cartStore,
      hydrateCart: false,
    });

    expect(cartStore.getSnapshot().hydrated).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.quoteCart).not.toHaveBeenCalled();

    await act(() => {
      released = true;
      for (const answer of waiting.splice(0)) answer();
    });
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    expect(api.quoteCart.mock.calls[0]?.[0]).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
  });

  it('asks the server to price exactly the ids and quantities in the cart', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({ quote: quoteOf(lines) });
    const { result } = await renderHookWithProviders(() => useCartQuote(), {
      api,
      cart: [{ productId: PRODUCT_A, quantity: 2 }],
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(api.quoteCart).toHaveBeenCalledTimes(1);
    expect(api.quoteCart.mock.calls[0]?.[0]).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    expect(result.current.data?.lines[0]?.lineTotalMinor).toBe(100_000);
    expect(result.current.data?.purchasable).toBe(true);
  });

  it('sends the chosen variant of each line, because that is what the server prices', async () => {
    const api = createFakeApiClient();
    const variant = 'ee000000-0000-4000-8000-000000000001';
    api.quoteCart.mockResolvedValue({ quote: quoteOf(lines) });
    await renderHookWithProviders(() => useCartQuote(), {
      api,
      cart: [{ productId: PRODUCT_A, variantId: variant, quantity: 2 }],
    });

    await waitFor(() => {
      expect(api.quoteCart).toHaveBeenCalledTimes(1);
    });
    expect(api.quoteCart.mock.calls[0]?.[0]).toEqual([
      { productId: PRODUCT_A, variantId: variant, quantity: 2 },
    ]);
  });

  it("exposes the server's problem codes", async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({
      quote: quoteOf([
        line({
          productId: PRODUCT_A,
          quantity: 5,
          availableQuantity: 2,
          problem: 'insufficient_stock',
        }),
        line({
          productId: PRODUCT_B,
          name: null,
          unitPriceMinor: null,
          lineTotalMinor: null,
          availableQuantity: null,
          problem: 'unavailable',
        }),
      ]),
    });
    const { result } = await renderHookWithProviders(() => useCartQuote(), {
      api,
      cart: [
        { productId: PRODUCT_A, quantity: 5 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.lines.map((l) => l.problem)).toEqual([
      'insufficient_stock',
      'unavailable',
    ]);
    expect(result.current.data?.purchasable).toBe(false);
  });

  it('keeps the previous quote while a changed cart is re-priced, then shows the new one', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValueOnce({ quote: quoteOf(lines) });
    let finish!: (value: { quote: CartQuote }) => void;
    api.quoteCart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await renderHookWithProviders(
      () => ({ quote: useCartQuote(), cart: useCart() }),
      { api, cart: [{ productId: PRODUCT_A, quantity: 2 }] },
    );
    await waitFor(() => {
      expect(result.current.quote.data?.subtotalMinor).toBe(100_000);
    });

    await act(() => {
      result.current.cart.setQuantity(PRODUCT_A, 3);
    });

    expect(result.current.quote.isPlaceholderData).toBe(true);
    expect(result.current.quote.data?.subtotalMinor).toBe(100_000);

    await act(() => {
      finish({
        quote: quoteOf([line({ productId: PRODUCT_A, quantity: 3, lineTotalMinor: 150_000 })]),
      });
    });
    await waitFor(() => {
      expect(result.current.quote.data?.subtotalMinor).toBe(150_000);
    });
    expect(result.current.quote.isPlaceholderData).toBe(false);
  });

  it('shows nothing for a cart that has just been emptied', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({ quote: quoteOf(lines) });
    const { result } = await renderHookWithProviders(
      () => ({ quote: useCartQuote(), cart: useCart() }),
      { api, cart: [{ productId: PRODUCT_A, quantity: 2 }] },
    );
    await waitFor(() => {
      expect(result.current.quote.data).toBeDefined();
    });

    await act(() => {
      result.current.cart.clear();
    });

    expect(result.current.quote.data).toBeUndefined();
    expect(api.quoteCart).toHaveBeenCalledTimes(1);
  });

  it('reports a failure so QueryState can show it', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockRejectedValue(new ApiError(404, 'not_found', 'x'));
    const { result } = await renderHookWithProviders(() => useCartQuote(), {
      api,
      cart: [{ productId: PRODUCT_A, quantity: 1 }],
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it('stays idle, without crashing, in a build without an API address', async () => {
    const { result } = await renderHookWithProviders(() => useCartQuote(), {
      api: null,
      cart: [{ productId: PRODUCT_A, quantity: 1 }],
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('renders inside a screen', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({ quote: quoteOf(lines) });
    function Subtotal() {
      const { data } = useCartQuote();
      return <Text>{data ? `subtotal ${data.subtotalMinor}` : 'pricing'}</Text>;
    }
    await renderWithProviders(<Subtotal />, {
      api,
      cart: [{ productId: PRODUCT_A, quantity: 2 }],
    });

    expect(await screen.findByText('subtotal 100000')).toBeOnTheScreen();
  });
});

describe('cart problems', () => {
  const problemLines = [
    line({
      productId: PRODUCT_A,
      quantity: 5,
      availableQuantity: 2,
      problem: 'insufficient_stock',
    }),
    line({ productId: PRODUCT_B, quantity: 9, availableQuantity: 4, problem: 'quantity_limit' }),
    line({ productId: PRODUCT_C, name: null, availableQuantity: null, problem: 'unavailable' }),
    line({
      productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
      quantity: 2,
      availableQuantity: 0,
      problem: 'insufficient_stock',
    }),
    line({ productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', quantity: 1 }),
  ];

  it('explains each problem in plain words', () => {
    expect(cartLineProblemText(problemLines[0]!)).toBe('Only 2 left');
    expect(cartLineProblemText(problemLines[1]!)).toBe('At most 4 per order');
    expect(cartLineProblemText(problemLines[2]!)).toBe('No longer available');
    expect(cartLineProblemText(problemLines[3]!)).toBe('Out of stock');
    expect(cartLineProblemText(problemLines[4]!)).toBeNull();
    expect(cartLineName(problemLines[2]!)).toBe('Product no longer available');
    expect(cartLineName(problemLines[0]!)).toBe('Blue mug');
  });

  it('plans removals and reductions, and leaves healthy lines alone', () => {
    const fixes = planCartFixes(problemLines);

    expect(fixes).toEqual([
      { action: 'adjust', productId: PRODUCT_A, variantId: null, name: 'Blue mug', from: 5, to: 2 },
      { action: 'adjust', productId: PRODUCT_B, variantId: null, name: 'Blue mug', from: 9, to: 4 },
      { action: 'remove', productId: PRODUCT_C, variantId: null, name: null },
      {
        action: 'remove',
        productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        variantId: null,
        name: 'Blue mug',
      },
    ]);
    expect(summarizeCartFixes(fixes)).toEqual({ removed: 2, adjusted: 2 });
    expect(describeCartFixes({ removed: 2, adjusted: 2 })).toBe(
      '2 items were removed and 2 were lowered to what is available',
    );
    expect(describeCartFixes({ removed: 1, adjusted: 0 })).toBe('1 item was removed');
    expect(describeCartFixes({ removed: 0, adjusted: 0 })).toBeNull();
  });

  it('applies the plan to the cart, skipping a line that changed since the quote', () => {
    const items = [
      { productId: PRODUCT_A, quantity: 5 },
      { productId: PRODUCT_B, quantity: 7 }, // changed from the 9 the server saw
      { productId: PRODUCT_C, quantity: 1 },
    ];

    expect(applyCartFixes(items, planCartFixes(problemLines))).toEqual([
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 7 },
    ]);
  });

  it('fixes the cart through useCart().fixProblems and reports what changed', async () => {
    const { result } = await renderHookWithProviders(() => useCart(), {
      cart: [
        { productId: PRODUCT_A, quantity: 5 },
        { productId: PRODUCT_C, quantity: 1 },
      ],
    });

    let summary = { removed: 0, adjusted: 0 };
    await act(() => {
      summary = result.current.fixProblems(problemLines);
    });

    expect(summary).toEqual({ removed: 2, adjusted: 2 });
    expect(result.current.items).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
  });
});

describe('cartBadgeLabel', () => {
  it('names an empty cart without a count', () => {
    expect(cartBadgeLabel(0)).toBe('Cart');
  });

  it('speaks the unit count', () => {
    expect(cartBadgeLabel(1)).toBe('Cart, 1 item');
    expect(cartBadgeLabel(7)).toBe('Cart, 7 items');
  });

  it('still speaks the real count beyond the bubble\u2019s 99+ cap', () => {
    expect(cartBadgeLabel(99)).toBe('Cart, 99 items');
    expect(cartBadgeLabel(100)).toBe('Cart, 100 items');
  });
});
