import { screen } from '@testing-library/react-native';
import PaymentScreen from '../../app/payment';
import SettingsScreen from '../../app/settings';
import { resetRouterMock } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
jest.mock('expo-notifications', () => ({}));

beforeEach(resetRouterMock);

describe('Account: payment information', () => {
  it('says cash on delivery is the only method, and stores no cards', async () => {
    await renderWithProviders(<PaymentScreen />);

    // The native header names the screen; the page itself starts with its first card.
    expect(screen.getByRole('header', { name: 'Cash on delivery' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'No cards are stored' })).toBeOnTheScreen();
    expect(screen.queryByText(/add card/i)).not.toBeOnTheScreen();
    expect(screen.queryByText(/saved card/i)).not.toBeOnTheScreen();
  });
});

describe('Account: settings', () => {
  it('offers order updates to a signed-in customer', async () => {
    await renderWithProviders(<SettingsScreen />);

    // The native header names the screen, so the content does not repeat the title.
    expect(screen.getByRole('header', { name: 'Order updates' })).toBeOnTheScreen();
  });

  it('asks a signed-out visitor to sign in rather than offering a switch that cannot work', async () => {
    await renderWithProviders(<SettingsScreen />, { session: { status: 'signed_out' } });

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Order updates' })).not.toBeOnTheScreen();
  });
});
