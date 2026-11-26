import { screen } from '@testing-library/react-native';
import { CartButton } from '../components/cart-button';
import { TabHeader } from '../components/tab-header';
import { PRODUCT_A } from '../test-utils/cart-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

describe('TabHeader', () => {
  it('shows the brand, the promise and whatever the screen adds below', async () => {
    await renderWithProviders(<TabHeader subtitle="Shop now, pay on delivery" />);

    expect(screen.getByRole('image', { name: 'Nilzora' })).toBeOnTheScreen();
    expect(screen.getByText('Shop now, pay on delivery')).toBeOnTheScreen();
  });

  it('does not repeat the cart: the bar has its own cart tab', async () => {
    await renderWithProviders(<TabHeader />);

    expect(screen.queryByRole('button', { name: /^Cart/ })).not.toBeOnTheScreen();
  });
});

describe('CartButton (the header of a screen above the tabs)', () => {
  it('is a plain cart with no count while the cart is empty', async () => {
    await renderWithProviders(<CartButton />);

    expect(screen.getByRole('button', { name: 'Cart' })).toBeOnTheScreen();
  });

  it('speaks the unit count and opens the cart', async () => {
    const { user } = await renderWithProviders(<CartButton />, {
      cart: [{ productId: PRODUCT_A, quantity: 3 }],
    });

    await user.press(screen.getByRole('button', { name: 'Cart, 3 items' }));

    expect(router.navigate).toHaveBeenCalledWith('/cart');
  });
});
