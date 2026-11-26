import { ApiError } from '@nilzora/api-client';
import {
  changedLines,
  CHECKOUT_ATTEMPT_SYNC_KEY,
  createCartSync,
  GUEST_HANDLE_KEY,
  type CartSyncDeps,
} from '@/cart';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B } from '@/test-utils/cart-fakes';

/*
 * The device keeps the cart; the server keeps a copy so a signed-in cart follows the account
 * and so staff can see checkouts that genuinely started. These tests read only that copy's
 * behaviour: what is sent, for which line, and that a failure never disturbs the cart.
 */

const VARIANT = 'ee000000-0000-4000-8000-000000000001';
const HANDLE = '9f000000-0000-4000-8000-000000000001';
const SESSION = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

function setup(overrides: Partial<CartSyncDeps> = {}) {
  const api = createFakeApiClient();
  const storage = createMemoryCartStorage();
  // A plain generic function: jest.fn() would erase the type parameter the sync relies on.
  const tokensUsed: string[] = [];
  function authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
    tokensUsed.push('access-token');
    return call('access-token');
  }
  const sync = createCartSync({
    storage,
    api,
    authorized,
    signedIn: () => true,
    newHandle: () => HANDLE,
    ...overrides,
  });
  return { api, storage, tokensUsed, sync };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('changedLines', () => {
  it('names an added line with its quantity', () => {
    expect(changedLines([], [{ productId: PRODUCT_A, quantity: 2 }])).toEqual([
      { item: { productId: PRODUCT_A, quantity: 2 }, quantity: 2 },
    ]);
  });

  it('sends 0 for a line that was removed, which is how the API deletes it', () => {
    expect(changedLines([{ productId: PRODUCT_A, quantity: 2 }], [])).toEqual([
      { item: { productId: PRODUCT_A, quantity: 2 }, quantity: 0 },
    ]);
  });

  it('ignores a line whose quantity did not change, so an unrelated edit sends nothing', () => {
    expect(
      changedLines(
        [{ productId: PRODUCT_A, quantity: 2 }],
        [{ productId: PRODUCT_A, quantity: 2 }],
      ),
    ).toEqual([]);
  });

  it('treats two variants of one product as two separate lines', () => {
    const changes = changedLines(
      [{ productId: PRODUCT_A, variantId: VARIANT, quantity: 1 }],
      [
        { productId: PRODUCT_A, variantId: VARIANT, quantity: 1 },
        { productId: PRODUCT_A, quantity: 3 },
      ],
    );
    expect(changes).toEqual([{ item: { productId: PRODUCT_A, quantity: 3 }, quantity: 3 }]);
  });
});

describe('createCartSync for a signed-in customer', () => {
  it('writes the line to the account cart with the caller’s token', async () => {
    const { api, sync, tokensUsed } = setup();
    api.setCartItem.mockResolvedValue({ cart: {} } as never);

    await sync.syncLines([], [{ productId: PRODUCT_A, variantId: VARIANT, quantity: 2 }]);

    expect(tokensUsed).toEqual(['access-token']);
    expect(api.setCartItem).toHaveBeenCalledWith('access-token', {
      productId: PRODUCT_A,
      variantId: VARIANT,
      quantity: 2,
    });
    // No guest handle is minted for a signed-in customer.
    expect(api.setGuestCartItem).not.toHaveBeenCalled();
  });

  it('keeps going when the API refuses one line', async () => {
    const { api, sync } = setup();
    api.setCartItem.mockRejectedValueOnce(new Error('offline'));
    api.setCartItem.mockResolvedValue({ cart: {} } as never);

    await sync.syncLines(
      [],
      [
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 4 },
      ],
    );

    expect(api.setCartItem).toHaveBeenCalledTimes(2);
  });
});

describe('createCartSync for a guest', () => {
  it('mints a handle once and writes the guest line with it', async () => {
    const { api, storage, sync } = setup({ signedIn: () => false });
    api.startGuestCart.mockResolvedValue({ cart: {} } as never);
    api.setGuestCartItem.mockResolvedValue({ cart: {} } as never);

    await sync.syncLines([], [{ productId: PRODUCT_A, quantity: 1 }]);

    expect(storage.read(GUEST_HANDLE_KEY)).toBe(HANDLE);
    expect(api.setGuestCartItem).toHaveBeenCalledWith({
      productId: PRODUCT_A,
      variantId: null,
      quantity: 1,
      token: HANDLE,
    });
  });

  it('creates the guest cart when the handle is unknown, then sends the line again', async () => {
    const { api, sync } = setup({ signedIn: () => false });
    api.setGuestCartItem.mockRejectedValueOnce(
      new ApiError(404, 'cart_guest_token_invalid', 'no such cart'),
    );
    api.startGuestCart.mockResolvedValue({ cart: {} } as never);
    api.setGuestCartItem.mockResolvedValue({ cart: {} } as never);

    await sync.syncLines([], [{ productId: PRODUCT_A, quantity: 1 }]);

    expect(api.startGuestCart).toHaveBeenCalledWith(HANDLE);
    expect(api.setGuestCartItem).toHaveBeenCalledTimes(2);
  });

  it('reuses a handle this device already has instead of minting another', async () => {
    const storage = createMemoryCartStorage({ [GUEST_HANDLE_KEY]: HANDLE });
    const { api, sync } = setup({ signedIn: () => false, storage });
    api.setGuestCartItem.mockResolvedValue({ cart: {} } as never);

    await sync.syncLines([], [{ productId: PRODUCT_A, quantity: 1 }]);

    expect(api.setGuestCartItem).toHaveBeenCalledWith(expect.objectContaining({ token: HANDLE }));
    expect(api.startGuestCart).not.toHaveBeenCalled();
  });
});

describe('guest cart merge', () => {
  it('folds the guest cart into the account and forgets the handle', async () => {
    const storage = createMemoryCartStorage({ [GUEST_HANDLE_KEY]: HANDLE });
    const { api, sync } = setup({ storage });
    api.mergeGuestCart.mockResolvedValue({ cart: {} } as never);

    await sync.mergeGuestCart();

    expect(api.mergeGuestCart).toHaveBeenCalledWith('access-token', HANDLE);
    expect(storage.read(GUEST_HANDLE_KEY)).toBeNull();
  });

  it('does nothing at all when this device never had a guest cart', async () => {
    const { api, storage, sync } = setup();
    await sync.mergeGuestCart();
    expect(api.mergeGuestCart).not.toHaveBeenCalled();
    expect(storage.read(GUEST_HANDLE_KEY)).toBeNull();
  });

  it('keeps the handle when the merge failed, so it can be retried', async () => {
    const storage = createMemoryCartStorage({ [GUEST_HANDLE_KEY]: HANDLE });
    const { api, sync } = setup({ storage });
    api.mergeGuestCart.mockRejectedValue(new Error('offline'));

    await sync.mergeGuestCart();

    expect(storage.read(GUEST_HANDLE_KEY)).toBe(HANDLE);
  });
});

describe('checkout lifecycle', () => {
  it('remembers the attempt it started, so the order can convert it later', async () => {
    const { api, storage, sync } = setup();
    api.startCheckout.mockResolvedValue({
      checkout: { id: SESSION, status: 'started', startedAt: '', lastActivityAt: '' },
    } as never);

    await sync.startCheckout({ addressId: undefined, couponCode: 'EID10' });

    expect(api.startCheckout).toHaveBeenCalledWith('access-token', {
      addressId: undefined,
      couponCode: 'EID10',
    });
    expect(storage.read(CHECKOUT_ATTEMPT_SYNC_KEY)).toBe(SESSION);
  });

  it('converts the remembered attempt with the order number and then forgets it', async () => {
    const storage = createMemoryCartStorage({ [CHECKOUT_ATTEMPT_SYNC_KEY]: SESSION });
    const { api, sync } = setup({ storage });
    api.checkoutConverted.mockResolvedValue(undefined);

    await sync.convertCheckout('NZ100042');

    expect(api.checkoutConverted).toHaveBeenCalledWith('access-token', SESSION, 'NZ100042');
    expect(storage.read(CHECKOUT_ATTEMPT_SYNC_KEY)).toBeNull();
  });

  it('converts nothing when no attempt was recorded', async () => {
    const { api, sync } = setup();
    await sync.convertCheckout('NZ100042');
    expect(api.checkoutConverted).not.toHaveBeenCalled();
  });

  it('never throws when the API is unreachable, so an order still finishes', async () => {
    const storage = createMemoryCartStorage({ [CHECKOUT_ATTEMPT_SYNC_KEY]: SESSION });
    const { api, sync } = setup({ storage });
    api.checkoutConverted.mockRejectedValue(new Error('offline'));

    await expect(sync.convertCheckout('NZ100042')).resolves.toBeUndefined();
    // The attempt is kept, so a later conversion can still record it.
    expect(storage.read(CHECKOUT_ATTEMPT_SYNC_KEY)).toBe(SESSION);
  });
});
