import { screen } from '@testing-library/react-native';
import { HomeHeader } from '../features/catalog/home-sections';
import { PRODUCT_A } from '../test-utils/cart-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
// The app only draws the microphone where the platform supports voice search; this test is
// about where the two icons sit, so the phone is assumed to have it.
jest.mock('@/voice/native-speech', () => ({ isVoiceSearchSupported: () => true }));

beforeEach(resetRouterMock);

describe('HomeHeader', () => {
  it('keeps the brand, the promise and the search box', async () => {
    await renderWithProviders(<HomeHeader onSearch={jest.fn()} onPhotoSearch={jest.fn()} />);

    expect(screen.getByRole('image', { name: 'Nilzora' })).toBeOnTheScreen();
    expect(screen.getByText('Shop now, pay on delivery')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search products' })).toBeOnTheScreen();
  });

  it('puts the cart in the header, with the units it holds, and opens the cart', async () => {
    const { user } = await renderWithProviders(
      <HomeHeader onSearch={jest.fn()} onPhotoSearch={jest.fn()} />,
      {
        cart: [{ productId: PRODUCT_A, quantity: 2 }],
      },
    );

    await user.press(screen.getByRole('button', { name: 'Cart, 2 items' }));

    expect(router.navigate).toHaveBeenCalledWith('/cart');
  });

  it('offers the camera beside the search box, for searching with a photo', async () => {
    const onPhotoSearch = jest.fn();
    const { user } = await renderWithProviders(
      <HomeHeader onSearch={jest.fn()} onPhotoSearch={onPhotoSearch} />,
    );

    await user.press(screen.getByRole('button', { name: 'Search by photo' }));

    expect(onPhotoSearch).toHaveBeenCalledTimes(1);
  });

  it('groups the camera and the microphone as one compact trailing control', async () => {
    await renderWithProviders(
      <HomeHeader onSearch={jest.fn()} onPhotoSearch={jest.fn()} onVoiceSearch={jest.fn()} />,
    );

    const camera = screen.getByRole('button', { name: 'Search by photo' });
    const mic = screen.getByRole('button', { name: 'Search by voice' });
    // One row, not two separately padded 48dp buttons: each slot is 30dp wide, so the two
    // 20dp glyphs sit about 10dp apart, and the hit slop keeps the targets comfortable.
    const row = screen.getByTestId('home-search-actions');
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(camera).toHaveStyle({ width: 30 });
    expect(mic).toHaveStyle({ width: 30 });
    expect(row).toContainElement(camera);
    expect(row).toContainElement(mic);
  });

  it('no longer offers a chat shortcut here: chat is the bottom bar’s fourth item', async () => {
    await renderWithProviders(<HomeHeader onSearch={jest.fn()} onPhotoSearch={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Chat with us' })).not.toBeOnTheScreen();
  });
});
