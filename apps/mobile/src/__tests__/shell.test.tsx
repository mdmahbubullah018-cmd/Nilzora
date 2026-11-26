import { render, screen } from '@testing-library/react-native';
import AccountScreen from '../../app/(tabs)/account';
import CartScreen from '../../app/cart';
import { Logo } from '../components/logo';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
jest.mock('expo-notifications', () => ({}));

describe('tab screens', () => {
  it('shows the cart, empty until something is added', async () => {
    // The cart opens from the Home header; the bar itself carries Home, Categories, Wishlist,
    // Chat and Account.
    await renderWithProviders(<CartScreen />);

    expect(screen.getByRole('header', { name: 'Your cart is empty' })).toBeOnTheScreen();
  });

  it('offers sign-in on the account tab when signed out', async () => {
    await renderWithProviders(<AccountScreen />, { session: { status: 'signed_out' } });

    expect(screen.getByRole('header', { name: 'Account' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeOnTheScreen();
  });
});

describe('Logo', () => {
  it('is announced once as the brand name', async () => {
    await render(<Logo />);

    expect(screen.getByRole('image', { name: 'Nilzora' })).toBeTruthy();
  });

  it('draws the official artwork instead of a typographic stand-in', async () => {
    await render(<Logo />);

    // One bundled picture from assets/brand, and no letter tiles: the supplied lockup already
    // carries the wordmark, so nothing is redrawn next to it.
    expect(screen.getByTestId('brand-logo-image')).toBeOnTheScreen();
    expect(screen.queryByText('Nil')).toBeNull();
    expect(screen.queryByText('zora')).toBeNull();
  });

  it.each([
    ['sm', 22],
    ['md', 30],
    ['lg', 40],
  ] as const)('keeps the artwork proportions at the %s size', async (size, height) => {
    await render(<Logo size={size} />);

    const style = screen.getByTestId('brand-logo-image').props.style as {
      width: number;
      height: number;
    };
    expect(style.height).toBe(height);
    expect(style.width / style.height).toBeCloseTo(1023 / 243, 1);
  });

  it('stays silent when a surrounding heading already names the store', async () => {
    await render(<Logo decorative />);

    expect(screen.queryByRole('image')).toBeNull();
  });
});
