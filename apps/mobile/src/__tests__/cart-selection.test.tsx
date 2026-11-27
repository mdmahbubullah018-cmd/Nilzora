import type { CartLine, CartQuote } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import {
  CART_SELECTION_KEY,
  CART_STORAGE_KEY,
  createCartStore,
  lineKey,
  serializeCart,
} from '../cart';
import { CartScreen } from '../features/cart/cart-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';
import { cartLine } from '../test-utils/checkout-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';

/*
 * Which lines an order will contain.
 *
 * The cart is the customer's own list; the selection is the part of it they mean to buy now.
 * Deselecting never removes anything, the selection survives a restart, and everything that
 * touches money — the subtotal on the cart, the checkout quote, the order itself — is worked out
 * over the selected lines only. These tests hold the store and the cart screen to that.
 */

const MUG = lineKey({ productId: PRODUCT_A });
const PLATE = lineKey({ productId: PRODUCT_B });

async function hydratedStore(initial: Record<string, string> = {}) {
  const storage = createMemoryCartStorage(initial);
  const store = createCartStore({ storage });
  await store.hydrate();
  return { storage, store };
}

describe('cart selection store', () => {
  it('selects everything on a cart saved before selection existed', async () => {
    // A device from before this feature: its payload has no selection at all.
    const { store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 1 },
      ]),
    });

    expect([...store.getSnapshot().selected].sort()).toEqual([MUG, PLATE].sort());
  });

  it('selects a line the moment it is added, and deselecting never removes it', async () => {
    const { store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([{ productId: PRODUCT_A, quantity: 1 }]),
    });
    store.add(PRODUCT_B, 1);

    expect(store.getSnapshot().selected.has(PLATE)).toBe(true);

    store.setSelected(PLATE, false);
    expect(store.getSnapshot().items).toHaveLength(2);
    expect(store.getSnapshot().selected.has(PLATE)).toBe(false);
  });

  it('selects all and clears all without touching the cart', async () => {
    const { store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 2 },
      ]),
    });

    store.setAllSelected(false);
    expect(store.getSnapshot().selected.size).toBe(0);
    expect(store.getSnapshot().items).toHaveLength(2);

    store.setAllSelected(true);
    expect([...store.getSnapshot().selected].sort()).toEqual([MUG, PLATE].sort());
  });

  it('forgets the selection of a line that leaves the cart', async () => {
    const { store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 2 },
      ]),
    });

    store.remove(PRODUCT_B);
    expect(store.getSnapshot().selected.has(PLATE)).toBe(false);
    expect(store.getSnapshot().selected.has(MUG)).toBe(true);
  });

  it('keeps the selection across a restart', async () => {
    const { storage, store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 2 },
      ]),
    });
    store.setSelected(PLATE, false);
    await store.flush();

    // The device is reopened: a new store reading the same storage.
    const reopened = createCartStore({ storage });
    await reopened.hydrate();

    expect(reopened.getSnapshot().items).toHaveLength(2);
    expect(reopened.getSnapshot().selected.has(MUG)).toBe(true);
    expect(reopened.getSnapshot().selected.has(PLATE)).toBe(false);
    expect(storage.read(CART_SELECTION_KEY)).not.toBeNull();
  });

  it('removes only the lines an order took, leaving the rest in the cart', async () => {
    const { store } = await hydratedStore({
      [CART_STORAGE_KEY]: serializeCart([
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 2 },
      ]),
    });

    store.removeMany([{ productId: PRODUCT_A }]);

    expect(store.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 2 }]);
    expect(store.getSnapshot().count).toBe(2);
  });
});

describe('cart screen selection', () => {
  const mug: CartLine = cartLine({
    productId: PRODUCT_A,
    name: 'Blue mug',
    quantity: 2,
    unitPriceMinor: 50_000,
    lineTotalMinor: 100_000,
  });
  const plate: CartLine = cartLine({
    productId: PRODUCT_B,
    name: 'Ceramic plate',
    quantity: 1,
    unitPriceMinor: 30_000,
    lineTotalMinor: 30_000,
  });

  function quoteOf(lines: CartLine[]): CartQuote {
    return {
      lines,
      itemCount: lines.reduce((total, line) => total + line.quantity, 0),
      subtotalMinor: lines.reduce((total, line) => total + (line.lineTotalMinor ?? 0), 0),
      deliveryZone: null,
      shippingFeeMinor: null,
      purchasable: lines.every((line) => line.problem === null),
    } as CartQuote;
  }

  async function renderCart() {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue({ quote: quoteOf([mug, plate]) });
    const view = await renderWithProviders(<CartScreen />, {
      api,
      cart: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
    });
    await screen.findByText(/Subtotal/);
    return view;
  }

  it('prices only the selected lines and drops a deselected line from the subtotal', async () => {
    const { user } = await renderCart();
    expect(screen.getByLabelText(/^Subtotal \(3 items\): 1,300 taka/)).toBeOnTheScreen();

    await user.press(screen.getByRole('checkbox', { name: /Include Blue mug/ }));

    // 3 units → 1, and 500 + 300 taka → 300: the deselected line is still in the cart.
    expect(screen.getByLabelText(/^Subtotal \(1 item\): 300 taka/)).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: /Include Blue mug/ })).not.toBeChecked();
    expect(screen.getByText('1 of 2 selected')).toBeOnTheScreen();
  });

  it('closes checkout when nothing is selected and reopens it with Select all', async () => {
    const { user } = await renderCart();

    await user.press(screen.getByRole('checkbox', { name: 'Deselect all items' }));

    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    expect(screen.getByText('Select at least one item to check out.')).toBeOnTheScreen();

    await user.press(screen.getByRole('checkbox', { name: 'Select all items' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();
    });
    expect(screen.getByText('2 of 2 selected')).toBeOnTheScreen();
  });
});
