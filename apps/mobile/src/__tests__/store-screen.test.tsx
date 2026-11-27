import type { PublicStoreProfile } from '@nilzora/contracts';
import { screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import StoreRoute from '../../app/store';
import { createFakeApiClient, fakeStoreProfile, type FakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';

/** A profile with every field the store may publish filled in. */
function publishedProfile(): PublicStoreProfile {
  return fakeStoreProfile({
    tagline: 'Everyday essentials, thoughtfully chosen.',
    description: 'Nilzora is a single-vendor shop for everyday essentials.',
    contactEmail: 'help@nilzora.test',
    contactPhone: '+880 1712 345678',
    addressLine: 'House 12, Road 5',
    addressArea: 'Dhanmondi',
    addressDistrict: 'Dhaka',
    businessHours: 'Saturday to Thursday, 10am to 8pm',
    supportEmail: 'help@nilzora.test',
    supportPhone: '+880 1712 345678',
    social: { facebook: 'https://facebook.com/nilzora', instagram: null, youtube: null },
  });
}

/** A profile with nothing published: every optional field empty, as the API would send it. */
function bareProfile(): PublicStoreProfile {
  return fakeStoreProfile({
    tagline: null,
    description: null,
    addressLine: null,
    addressArea: null,
    addressDistrict: null,
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
  });
}

function storeApi(profile: PublicStoreProfile | null): FakeApiClient {
  const api = createFakeApiClient();
  if (profile === null) {
    api.publicStoreProfile.mockReturnValue(new Promise(() => undefined));
  } else {
    api.publicStoreProfile.mockResolvedValue({ profile });
  }
  return api;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('StoreScreen', () => {
  it('shows a placeholder while the profile loads', async () => {
    await renderWithProviders(<StoreRoute />, { api: storeApi(null) });

    expect(await screen.findByLabelText('Loading contact details')).toBeOnTheScreen();
  });

  it('renders the published contact details the API returned', async () => {
    await renderWithProviders(<StoreRoute />, { api: storeApi(publishedProfile()) });

    expect(await screen.findByRole('header', { name: 'Nilzora' })).toBeOnTheScreen();
    expect(screen.getByText('Everyday essentials, thoughtfully chosen.')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Email: help@nilzora.test' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Phone: +880 1712 345678' })).toBeOnTheScreen();
    expect(screen.getByText('House 12, Road 5, Dhanmondi, Dhaka')).toBeOnTheScreen();
    expect(screen.getByText('Saturday to Thursday, 10am to 8pm')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Facebook: Facebook' })).toBeOnTheScreen();
  });

  it('shows the logo the store published', async () => {
    await renderWithProviders(<StoreRoute />, {
      api: storeApi(
        fakeStoreProfile({ logoUrl: 'https://media.nilzora.test/brand/logo/thumb.webp' }),
      ),
    });

    const logo = await screen.findByTestId('store-logo');
    expect(logo.props.source).toStrictEqual({
      uri: 'https://media.nilzora.test/brand/logo/thumb.webp',
    });
  });

  it('shows no logo when the store has published none', async () => {
    await renderWithProviders(<StoreRoute />, {
      api: storeApi(fakeStoreProfile({ logoUrl: null })),
    });

    expect(await screen.findByRole('header', { name: 'Nilzora' })).toBeOnTheScreen();
    expect(screen.queryByTestId('store-logo')).not.toBeOnTheScreen();
  });

  it('opens the phone app for the published support number', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { user } = await renderWithProviders(<StoreRoute />, {
      api: storeApi(publishedProfile()),
    });

    await user.press(await screen.findByRole('link', { name: 'Phone: +880 1712 345678' }));

    expect(openURL).toHaveBeenCalledWith('tel:+8801712345678');
  });

  it('falls back to the general contact address when no support address is published', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { user } = await renderWithProviders(<StoreRoute />, {
      api: storeApi(
        fakeStoreProfile({
          supportEmail: null,
          supportPhone: null,
          contactEmail: 'hello@nilzora.test',
          contactPhone: '+880 1999 000000',
        }),
      ),
    });

    await user.press(await screen.findByRole('link', { name: 'Email: hello@nilzora.test' }));

    expect(openURL).toHaveBeenCalledWith('mailto:hello@nilzora.test');
    expect(screen.getByRole('link', { name: 'Phone: +880 1999 000000' })).toBeOnTheScreen();
  });

  it('says plainly that no contact details are published, without inventing any', async () => {
    await renderWithProviders(<StoreRoute />, { api: storeApi(bareProfile()) });

    expect(
      await screen.findByRole('header', { name: 'No contact details published yet' }),
    ).toBeOnTheScreen();
    // Only the store's own name is left; nothing reusable, no fake address or number.
    expect(screen.getByRole('header', { name: 'Nilzora' })).toBeOnTheScreen();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText(/Nilzora is a single-vendor shop/)).not.toBeOnTheScreen();
  });

  it('offers a retry when the profile cannot be read', async () => {
    const api = createFakeApiClient();
    api.publicStoreProfile.mockRejectedValueOnce(new Error('network down'));
    const { user } = await renderWithProviders(<StoreRoute />, { api });

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(api.publicStoreProfile).toHaveBeenCalledTimes(2);
  });

  it('reports an unconfigured build instead of spinning forever', async () => {
    await renderWithProviders(<StoreRoute />, { api: null });

    expect(await screen.findByText(/it cannot reach Nilzora/)).toBeOnTheScreen();
  });
});
