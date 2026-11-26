import { ApiError } from '@nilzora/api-client';
import { MAX_ADDRESSES, type Address } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import AddressesRoute from '../../app/addresses/index';
import { AddressesScreen } from '../features/addresses/addresses-screen';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import {
  ADDRESS_HOME,
  ADDRESS_OFFICE,
  ADDRESS_OFFICE_ID,
  renderCommerce,
} from '../test-utils/checkout-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

/** The list calls answer with each list in turn; the last one answers every call after that. */
function apiWithAddresses(...lists: Address[][]): FakeApiClient {
  const api = createFakeApiClient();
  for (const list of lists.slice(0, -1))
    api.listAddresses.mockResolvedValueOnce({ addresses: list });
  api.listAddresses.mockResolvedValue({ addresses: lists.at(-1) ?? [] });
  return api;
}

const BOTH = [ADDRESS_HOME, ADDRESS_OFFICE];

describe('AddressesScreen: listing', () => {
  it('shows each address as it is written on a parcel, with the default marked and first', async () => {
    // The API may list the default last: the screen puts it first.
    await renderCommerce(<AddressesScreen />, {
      api: apiWithAddresses([ADDRESS_OFFICE, ADDRESS_HOME]),
    });

    const titles = await screen.findAllByRole('header', { name: /Home|Rahim Uddin/ });
    expect(titles.map((title) => String(title.props.children))).toEqual(['Home', 'Rahim Uddin']);
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getByText('House 12, Road 5, Block C')).toBeOnTheScreen();
    expect(screen.getByText('Dhanmondi, Dhaka 1209')).toBeOnTheScreen();
    expect(screen.getByText('Dhaka Division')).toBeOnTheScreen();
    expect(screen.getByLabelText('Phone: 01712-345678')).toBeOnTheScreen();
    expect(screen.getByText('Delivery zone: Inside Dhaka')).toBeOnTheScreen();
    expect(screen.getByText('Near the post office')).toBeOnTheScreen();
    expect(screen.getByText('Delivery zone: Outside Dhaka')).toBeOnTheScreen();
  });

  it('only offers "Set as default" on addresses that are not the default', async () => {
    await renderCommerce(<AddressesScreen />, { api: apiWithAddresses(BOTH) });
    await screen.findByText('Rahim Uddin');

    expect(
      screen.queryByRole('button', { name: 'Set Home · Dhanmondi, Dhaka as default' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Set Kotbari, Cumilla as default' }),
    ).toBeOnTheScreen();
  });

  it('invites a customer without addresses to add one', async () => {
    const { user } = await renderCommerce(<AddressesScreen />, { api: apiWithAddresses([]) });

    expect(await screen.findByRole('header', { name: 'No saved addresses yet' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Add address' }));
    expect(router.push).toHaveBeenCalledWith('/addresses/new');
  });

  it('opens the form to add, and the form for the address to edit', async () => {
    const { user } = await renderCommerce(<AddressesScreen />, { api: apiWithAddresses(BOTH) });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Add address' }));
    expect(router.push).toHaveBeenLastCalledWith('/addresses/new');

    await user.press(screen.getByRole('button', { name: 'Edit Kotbari, Cumilla' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/addresses/[addressId]',
      params: { addressId: ADDRESS_OFFICE_ID },
    });
  });

  it('explains the limit instead of offering another address when it is reached', async () => {
    const full = Array.from({ length: MAX_ADDRESSES }, (_, index) => ({
      ...ADDRESS_HOME,
      id: `aaaaaaaa-1111-4222-8333-4444444444${String(index).padStart(2, '0')}`,
      isDefault: index === 0,
    }));
    await renderCommerce(<AddressesScreen />, { api: apiWithAddresses(full) });

    expect(
      await screen.findByText('You can keep up to 10 addresses. Delete one to add another.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add address' })).not.toBeOnTheScreen();
  });

  it('shows the error with a retry when the list cannot be loaded', async () => {
    const api = createFakeApiClient();
    api.listAddresses
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'))
      .mockResolvedValueOnce({ addresses: BOTH });
    const { user } = await renderCommerce(<AddressesScreen />, { api });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Rahim Uddin')).toBeOnTheScreen();
  });
});

describe('AddressesScreen: set as default', () => {
  it('sends the whole current address with isDefault and shows the new default', async () => {
    const swapped = [
      { ...ADDRESS_OFFICE, isDefault: true },
      { ...ADDRESS_HOME, isDefault: false },
    ];
    // 1: the screen's list; 2: the mutation's fresh read; 3: the refresh after the change.
    const api = apiWithAddresses(BOTH, BOTH, swapped);
    api.updateAddress.mockResolvedValue({ address: { ...ADDRESS_OFFICE, isDefault: true } });
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Set Kotbari, Cumilla as default' }));

    await waitFor(() => {
      expect(api.updateAddress).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, ADDRESS_OFFICE_ID, {
        label: null,
        recipientName: 'Rahim Uddin',
        phone: '+8801912345678',
        division: 'Chattogram',
        district: 'Cumilla',
        area: 'Kotbari',
        addressLine: 'Hall road, 2nd floor',
        postalCode: null,
        landmark: 'the post office',
        isDefault: true,
      });
    });
    expect(await screen.findByText('Your default address has been updated.')).toBeOnTheScreen();
    const titles = await screen.findAllByRole('header', { name: /Home|Rahim Uddin/ });
    expect(titles.map((title) => String(title.props.children))).toEqual(['Rahim Uddin', 'Home']);
    expect(api.listAddresses.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('reports a failure and changes nothing', async () => {
    const api = apiWithAddresses(BOTH);
    api.updateAddress.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Set Kotbari, Cumilla as default' }));

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    expect(screen.queryByText('Your default address has been updated.')).not.toBeOnTheScreen();
  });

  it('says so when the address was deleted meanwhile', async () => {
    // The fresh read inside the change no longer has it.
    const api = apiWithAddresses(BOTH, [ADDRESS_HOME]);
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Set Kotbari, Cumilla as default' }));

    expect(await screen.findByText('Not found')).toBeOnTheScreen();
    expect(api.updateAddress).not.toHaveBeenCalled();
  });
});

describe('AddressesScreen: delete', () => {
  it('asks first, and cancelling deletes nothing', async () => {
    const api = apiWithAddresses(BOTH);
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Delete Kotbari, Cumilla' }));

    expect(screen.getByRole('header', { name: 'Delete this address?' })).toBeOnTheScreen();
    expect(
      screen.getByText(/Orders you have already placed keep their delivery details/),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('header', { name: 'Delete this address?' })).not.toBeOnTheScreen();
    expect(api.deleteAddress).not.toHaveBeenCalled();
  });

  it('deletes after confirmation and refreshes the list', async () => {
    const api = apiWithAddresses(BOTH, [ADDRESS_HOME]);
    api.deleteAddress.mockResolvedValue(undefined);
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Delete Kotbari, Cumilla' }));
    await user.press(screen.getByRole('button', { name: 'Delete address' }));

    await waitFor(() => {
      expect(api.deleteAddress).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, ADDRESS_OFFICE_ID);
    });
    expect(await screen.findByText('The address has been deleted.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Delete this address?' })).not.toBeOnTheScreen();
    expect(await screen.findByText('Home')).toBeOnTheScreen();
    expect(screen.queryByText('Rahim Uddin')).not.toBeOnTheScreen();
  });

  it('tells the customer which address becomes the default when the default is deleted', async () => {
    const { user } = await renderCommerce(<AddressesScreen />, { api: apiWithAddresses(BOTH) });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Delete Home · Dhanmondi, Dhaka' }));

    expect(screen.getByRole('header', { name: 'Delete this address?' })).toBeOnTheScreen();
    expect(screen.getByText(/One of your other addresses becomes the default/)).toBeOnTheScreen();
  });

  it('treats an address that is already gone as deleted', async () => {
    const api = apiWithAddresses(BOTH, [ADDRESS_HOME]);
    api.deleteAddress.mockRejectedValue(new ApiError(404, 'not_found', 'No such address'));
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Delete Kotbari, Cumilla' }));
    await user.press(screen.getByRole('button', { name: 'Delete address' }));

    expect(await screen.findByText('The address has been deleted.')).toBeOnTheScreen();
  });

  it('reports a failed delete and keeps the address', async () => {
    const api = apiWithAddresses(BOTH);
    api.deleteAddress.mockRejectedValue(new ApiError(503, 'service_unavailable', 'down'));
    const { user } = await renderCommerce(<AddressesScreen />, { api });
    await screen.findByText('Rahim Uddin');

    await user.press(screen.getByRole('button', { name: 'Delete Kotbari, Cumilla' }));
    await user.press(screen.getByRole('button', { name: 'Delete address' }));

    expect(await screen.findByText('Nilzora is unavailable right now')).toBeOnTheScreen();
    expect(screen.getByText('Rahim Uddin')).toBeOnTheScreen();
  });
});

describe('addresses route', () => {
  it('asks a signed-out customer to sign in and returns to the address book afterwards', async () => {
    const { user } = await renderCommerce(<AddressesRoute />, {
      api: createFakeApiClient(),
      session: { status: 'signed_out' },
    });

    expect(screen.getByText(/to manage your delivery addresses/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/addresses' },
    });
  });

  it('shows the address book to a signed-in customer', async () => {
    await renderCommerce(<AddressesRoute />, { api: apiWithAddresses([ADDRESS_HOME]) });

    expect(await screen.findByRole('header', { name: 'Home' })).toBeOnTheScreen();
    expect(screen.getAllByText('Default')).toHaveLength(1);
  });
});
