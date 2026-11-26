import { render, screen, userEvent } from '@testing-library/react-native';
import AccountScreen from '../../app/(tabs)/account';
import { createSessionManager, MESSAGES, type SessionManager } from '../auth/session-manager';
import { createCartStore } from '../cart/cart-store';
import { AppProviders } from '../providers';
import { createMemoryCartStorage } from '../test-utils/cart-fakes';
import {
  createFakeApi,
  createMemoryStore,
  createStaticManager,
  CUSTOMER,
  fakeStoredSession,
  TOKEN_MARKER,
} from '../test-utils/session-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { createWishlistStore } from '../wishlist/wishlist-store';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
// The settings screen reads the notification permission; nothing here depends on it.
jest.mock('expo-notifications', () => ({}));

beforeEach(resetRouterMock);

function renderAccount(manager: SessionManager | null) {
  // The whole provider stack: the cart and wishlist rows read both device-local stores.
  return render(
    <AppProviders
      session={manager}
      api={null}
      cartStore={createCartStore({ storage: createMemoryCartStorage() })}
      wishlistStore={createWishlistStore({ storage: createMemoryCartStorage() })}
    >
      <AccountScreen />
    </AppProviders>,
  );
}

describe('AccountScreen', () => {
  it('explains when the build has no API address', async () => {
    await renderAccount(null);

    expect(screen.getByRole('header', { name: 'Sign-in is not available' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
  });

  it('shows an accessible loading state while the session is restored', async () => {
    await renderAccount(createStaticManager({ status: 'restoring' }));

    expect(screen.getByRole('progressbar', { name: 'Checking your sign-in' })).toBeOnTheScreen();
  });

  it('restores the saved session when it mounts', async () => {
    const manager = createStaticManager({ status: 'restoring' });
    await renderAccount(manager);

    expect(manager.restore).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in and registration when signed out', async () => {
    const user = userEvent.setup();
    await renderAccount(createStaticManager({ status: 'signed_out' }));

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
    await user.press(screen.getByRole('button', { name: 'Create account' }));
    expect(router.push).toHaveBeenCalledWith('/register');
  });

  it('says why a session ended', async () => {
    await renderAccount(
      createStaticManager({ status: 'signed_out', notice: MESSAGES.sessionEnded }),
    );

    expect(screen.getByText(MESSAGES.sessionEnded)).toBeOnTheScreen();
  });

  it('shows who is signed in and opens their profile details', async () => {
    const user = userEvent.setup();
    await renderAccount(createStaticManager({ status: 'signed_in', user: CUSTOMER.user }));

    expect(screen.getByText('Ayesha Rahman')).toBeOnTheScreen();
    expect(screen.getByText('customer@example.test')).toBeOnTheScreen();

    await user.press(screen.getByRole('link', { name: 'Profile details for Ayesha Rahman' }));
    expect(router.push).toHaveBeenLastCalledWith('/profile');

    await user.press(screen.getByRole('link', { name: 'Profile details' }));
    expect(router.push).toHaveBeenLastCalledWith('/profile');
  });

  it('groups every row the account really offers', async () => {
    await renderWithProviders(<AccountScreen />);

    expect(await screen.findByRole('link', { name: 'My orders' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Cart' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Saved addresses' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Returns' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Payment information' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Help & support' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Contact Nilzora' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  it('opens the screen each row names', async () => {
    const { user } = await renderWithProviders(<AccountScreen />);

    await user.press(await screen.findByRole('link', { name: 'My orders' }));
    expect(router.push).toHaveBeenLastCalledWith('/orders');
    await user.press(screen.getByRole('link', { name: 'Wishlist' }));
    expect(router.navigate).toHaveBeenLastCalledWith('/wishlist');
    await user.press(screen.getByRole('link', { name: 'Cart' }));
    expect(router.navigate).toHaveBeenLastCalledWith('/cart');
    await user.press(screen.getByRole('link', { name: 'Saved addresses' }));
    expect(router.push).toHaveBeenLastCalledWith('/addresses');
    await user.press(screen.getByRole('link', { name: 'Returns' }));
    expect(router.push).toHaveBeenLastCalledWith('/returns');
    await user.press(screen.getByRole('link', { name: 'Payment information' }));
    expect(router.push).toHaveBeenLastCalledWith('/payment');
    await user.press(screen.getByRole('link', { name: 'Help & support' }));
    expect(router.push).toHaveBeenLastCalledWith('/support');
    await user.press(screen.getByRole('link', { name: 'Settings' }));
    expect(router.push).toHaveBeenLastCalledWith('/settings');
  });

  it('shows the counts the device really holds', async () => {
    await renderWithProviders(<AccountScreen />, {
      cart: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 3 }],
      wishlist: ['cotton-shirt'],
    });

    expect(await screen.findByLabelText('3 items')).toBeOnTheScreen();
    expect(screen.getByLabelText('1 saved')).toBeOnTheScreen();
  });

  it('offers no orders or addresses to a signed-out visitor', async () => {
    await renderWithProviders(<AccountScreen />, { session: { status: 'signed_out' } });

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: 'Saved addresses' })).not.toBeOnTheScreen();
    // Support is open to everyone, signed in or not.
    expect(screen.getByRole('link', { name: 'Help & support' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Contact Nilzora' })).toBeOnTheScreen();
  });

  it('reaches your own conversations from the account, signed in', async () => {
    const { user } = await renderWithProviders(<AccountScreen />);
    await user.press(await screen.findByRole('link', { name: 'Help & support' }));
    expect(router.push).toHaveBeenLastCalledWith('/support');
  });

  it('offers a signed-out visitor the same way to reach the store', async () => {
    const { user } = await renderWithProviders(<AccountScreen />, {
      session: { status: 'signed_out' },
    });
    await user.press(await screen.findByRole('link', { name: 'Contact Nilzora' }));
    expect(router.push).toHaveBeenLastCalledWith('/store');
  });

  it('signs out from the account view', async () => {
    const user = userEvent.setup();
    const manager = createStaticManager({ status: 'signed_in', user: CUSTOMER.user });
    await renderAccount(manager);

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the session could not be checked', async () => {
    const user = userEvent.setup();
    const manager = createStaticManager({ status: 'offline' });
    await renderAccount(manager);
    manager.restore.mockClear();

    expect(screen.getByRole('header', { name: 'Nilzora could not be reached' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(manager.restore).toHaveBeenCalledTimes(1);
  });

  it('shows a suspended account with only a sign-out action', async () => {
    const user = userEvent.setup();
    const manager = createStaticManager({ status: 'suspended' });
    await renderAccount(manager);

    expect(screen.getByRole('alert')).toHaveTextContent(/Account suspended/);
    expect(screen.queryByRole('link', { name: 'Profile details' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });

  it('never renders a token, end to end with the real session manager', async () => {
    const api = createFakeApi();
    api.getMe.mockResolvedValue(CUSTOMER);
    const { store } = createMemoryStore(fakeStoredSession(1, Date.now()));
    const manager = createSessionManager({ api, store });
    await renderAccount(manager);

    expect(await screen.findByText('Ayesha Rahman')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_MARKER);
  });
});
