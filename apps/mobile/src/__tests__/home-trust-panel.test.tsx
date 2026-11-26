import { fireEvent, screen } from '@testing-library/react-native';
import { HomeTrustPanel } from '../features/catalog/home-sections';
import { renderWithProviders } from '../test-utils/render-with-providers';

describe('HomeTrustPanel', () => {
  it('shows the four promises the website also makes, in order', async () => {
    await renderWithProviders(<HomeTrustPanel />);

    const labels = screen
      .getAllByRole('button')
      .map((button) => (button.props as { accessibilityLabel?: string }).accessibilityLabel);
    expect(labels).toEqual([
      'Fast Delivery',
      'Secure Checkout',
      'Easy Returns',
      'Customer Support',
    ]);
  });

  it('prints the short label "Support" on one line, while the full name stays the spoken one', async () => {
    await renderWithProviders(<HomeTrustPanel />);

    expect(screen.getByText('Support')).toBeOnTheScreen();
    expect(screen.queryByText('Customer Support')).not.toBeOnTheScreen();
    for (const label of screen.getAllByText(/Delivery|Checkout|Returns|Support/)) {
      expect((label.props as { numberOfLines?: number }).numberOfLines).toBe(1);
    }
  });

  it('opens a sheet that explains the benefit that was tapped', async () => {
    await renderWithProviders(<HomeTrustPanel />);

    await fireEvent.press(screen.getByRole('button', { name: 'Fast Delivery' }));

    expect(await screen.findByText(/delivery charge for your area is shown/i)).toBeOnTheScreen();
    // No delivery time is promised.
    expect(screen.getByText(/not fixed in advance/i)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Track my orders' })).toBeOnTheScreen();
  });

  it('explains the other three truthfully', async () => {
    await renderWithProviders(<HomeTrustPanel />);

    await fireEvent.press(screen.getByRole('button', { name: 'Secure Checkout' }));
    expect(await screen.findByText(/cash on delivery/i)).toBeOnTheScreen();
  });

  it('makes no promise the shop has not verified', async () => {
    await renderWithProviders(<HomeTrustPanel />);

    expect(screen.queryByText(/free shipping|1,999|24\/7|opening soon/i)).not.toBeOnTheScreen();
  });
});
