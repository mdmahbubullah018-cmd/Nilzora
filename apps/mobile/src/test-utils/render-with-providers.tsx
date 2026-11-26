import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { act, render, renderHook, userEvent } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import type { SessionState } from '@/auth/session-manager';
import type { CartItem } from '@/cart/cart-items';
import { createCartStore, type CartStore } from '@/cart/cart-store';
import { AppProviders } from '@/providers';
import {
  createWishlistStore,
  type WishlistStorage,
  type WishlistStore,
} from '@/wishlist/wishlist-store';
import { createFakeApiClient, type FakeApiClient } from './api-fakes';
import { createMemoryCartStorage, type MemoryCartStorage } from './cart-fakes';
import {
  createControllableManager,
  signedInState,
  type ControllableManager,
} from './session-fakes';

/*
 * renderWithProviders
 * -------------------
 * Renders a screen or component inside the app's real providers (AppProviders: session,
 * API, React Query, cart), with fakes where the network, keychain and disk would be.
 *
 *   jest.mock('expo-router', () => require('@/test-utils/expo-router-mock').expoRouterMock);
 *
 *   it('lists the orders', async () => {
 *     const api = createFakeApiClient();
 *     api.listOrders.mockResolvedValue({ orders: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
 *     const { user } = await renderWithProviders(<OrdersScreen />, { api });
 *     expect(await screen.findByText('No orders yet')).toBeOnTheScreen();
 *   });
 *
 * Options (all optional):
 *   api          a FakeApiClient (default: a new one whose methods reject until stubbed), or
 *                null for a build without an API address.
 *   session      a SessionState (default: signed in as the sample customer), a
 *                ControllableManager, or null for an unconfigured build. A state becomes a
 *                ControllableManager whose authorized() calls back with FAKE_ACCESS_TOKEN.
 *   cart         the lines the cart already holds (default: none), or a ready CartStore.
 *                The cart is hydrated before rendering (unless hydrateCart is false);
 *                `cartStorage` is its backing store.
 *   wishlist     saved product slugs (device-local), or a ready WishlistStore; hydrated
 *                before rendering. `wishlistStorage` is its backing store.
 *   queryClient  default: a fresh client with retries disabled; every client made here is
 *                cleared after each test, so no test sees another's cache.
 *
 * Resolves to the render result plus { api, manager, cartStore, cartStorage, queryClient,
 * user, setSession } (renderHookWithProviders does the same for a hook) where `user` comes from userEvent.setup() (`await user.press(...)`)
 * and `setSession(state)` changes the session mid-test (sign-out, another account).
 *
 * AsyncStorage is mocked for every test (jest-setup.ts) and keeps its data for the whole
 * test file; call resetAsyncStorage() in a beforeEach when that matters.
 */

export interface RenderWithProvidersOptions {
  api?: FakeApiClient | null;
  session?: SessionState | ControllableManager | null;
  cart?: readonly CartItem[] | CartStore;
  cartStorage?: MemoryCartStorage;
  /** Set to false to test the moment before the saved cart has been read. Default: true. */
  hydrateCart?: boolean;
  /** Saved product slugs (device-local wishlist), or a ready store. Default: none. */
  wishlist?: readonly string[] | WishlistStore;
  /** The wishlist's backing store, when the default memory one is not enough. */
  wishlistStorage?: WishlistStorage;
  queryClient?: QueryClient;
}

const clients = new Set<QueryClient>();

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

/** A QueryClient for tests: no retries and no garbage-collection timers. */
export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      // A finished mutation keeps a collection timer of its own; without this, a test that
      // completes one leaves a five-minute timer behind and Jest cannot exit.
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.add(client);
  return client;
}

/** Empties the mocked AsyncStorage that the app's default cart storage writes to. */
export async function resetAsyncStorage(): Promise<void> {
  await AsyncStorage.clear();
}

function isCartStore(cart: RenderWithProvidersOptions['cart']): cart is CartStore {
  return cart !== undefined && !Array.isArray(cart);
}

function isWishlistStore(
  wishlist: RenderWithProvidersOptions['wishlist'],
): wishlist is WishlistStore {
  return wishlist !== undefined && !Array.isArray(wishlist);
}

async function createHarness(options: RenderWithProvidersOptions) {
  const api = options.api === undefined ? createFakeApiClient() : options.api;
  const queryClient = options.queryClient ?? createTestQueryClient();

  const requested = options.session === undefined ? signedInState() : options.session;
  const manager: ControllableManager | null =
    requested === null || 'getState' in requested
      ? requested
      : createControllableManager(requested);

  const cartStorage = options.cartStorage ?? createMemoryCartStorage();
  const cartStore = isCartStore(options.cart)
    ? options.cart
    : createCartStore({ storage: cartStorage });
  if (options.cart !== undefined && !isCartStore(options.cart) && options.cart.length > 0) {
    const lines = options.cart;
    cartStore.update(() => lines);
  }
  if (options.hydrateCart !== false) await cartStore.hydrate();

  const wishlistStorage = options.wishlistStorage ?? createMemoryCartStorage();
  const wishlistStore = isWishlistStore(options.wishlist)
    ? options.wishlist
    : createWishlistStore({ storage: wishlistStorage });
  if (isWishlistStore(options.wishlist)) {
    await wishlistStore.hydrate();
  } else {
    for (const slug of options.wishlist ?? []) wishlistStore.toggle(slug);
    await wishlistStore.hydrate();
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders
        session={manager}
        api={api}
        queryClient={queryClient}
        cartStore={cartStore}
        wishlistStore={wishlistStore}
      >
        {children}
      </AppProviders>
    );
  }

  async function setSession(next: SessionState): Promise<void> {
    if (manager === null) throw new Error('setSession() needs a session; none was configured');
    await act(() => {
      manager.setState(next);
    });
  }

  return {
    Wrapper,
    api,
    manager,
    cartStore,
    cartStorage,
    wishlistStore,
    wishlistStorage,
    queryClient,
    user: userEvent.setup(),
    setSession,
  };
}

/** Renders `ui` inside the app's providers. See the notes at the top of this file. */
export async function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const { Wrapper, ...harness } = await createHarness(options);
  const result = await render(ui, { wrapper: Wrapper });
  return { ...result, ...harness };
}

/** Renders a hook inside the app's providers; `result.current` is the hook's latest value. */
export async function renderHookWithProviders<Result>(
  hook: () => Result,
  options: RenderWithProvidersOptions = {},
) {
  const { Wrapper, ...harness } = await createHarness(options);
  const result = await renderHook(hook, { wrapper: Wrapper });
  return { ...result, ...harness };
}
