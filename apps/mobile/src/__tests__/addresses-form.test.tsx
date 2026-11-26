import { ApiError } from '@nilzora/api-client';
import { MAX_ADDRESSES, type Address } from '@nilzora/contracts';
import { fireEvent, screen, within, type userEvent } from '@testing-library/react-native';
import EditAddressRoute from '../../app/addresses/[addressId]';
import NewAddressRoute from '../../app/addresses/new';
import { AddressFormScreen } from '../features/addresses/address-form-screen';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import {
  ADDRESS_HOME,
  ADDRESS_HOME_ID,
  ADDRESS_OFFICE,
  ADDRESS_OFFICE_ID,
  renderCommerce,
} from '../test-utils/checkout-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

type User = ReturnType<typeof userEvent.setup>;

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

const SAVED: Address = {
  ...ADDRESS_OFFICE,
  id: 'aaaaaaaa-1111-4222-8333-444444444444',
  recipientName: 'Ayesha Rahman',
  isDefault: false,
};

function apiWithAddresses(addresses: Address[]): FakeApiClient {
  const api = createFakeApiClient();
  api.listAddresses.mockResolvedValue({ addresses });
  return api;
}

/** The accessible names of list options. */
function labelsOf(elements: ReturnType<typeof screen.getAllByRole>): string[] {
  return elements.map((element) => String(element.props.accessibilityLabel));
}

/** Sets a text field's value in one step (typing is covered by the tests that use user.type). */
async function replaceText(label: string, text: string) {
  await fireEvent.changeText(screen.getByLabelText(label), text);
}

async function choose(user: User, field: 'Division' | 'District', option: string) {
  await user.press(screen.getByRole('button', { name: field }));
  await user.press(screen.getByRole('radio', { name: option }));
}

/** Fills every required field with a valid Dhaka address. */
async function fillValidAddress(user: User) {
  await replaceText('Recipient name', 'Ayesha Rahman');
  await replaceText('Mobile phone', '01712 345678');
  await choose(user, 'Division', 'Dhaka');
  await choose(user, 'District', 'Dhaka');
  await replaceText('Area, thana or upazila', 'Dhanmondi');
  await replaceText('House, road and block', 'House 12, Road 5');
}

describe('AddressFormScreen: new address', () => {
  it('starts from the account name, and a first address needs no default switch', async () => {
    await renderCommerce(<AddressFormScreen />, { api: apiWithAddresses([]) });

    expect(await screen.findByLabelText('Recipient name')).toHaveDisplayValue('Ayesha Rahman');
    expect(screen.getByLabelText('Mobile phone')).toHaveDisplayValue('');
    expect(
      screen.getByText('Your first address becomes your default delivery address.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
  });

  it('shows what is wrong with each empty field and sends nothing', async () => {
    const api = apiWithAddresses([]);
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    await fireEvent.changeText(screen.getByLabelText('Recipient name'), '');

    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(screen.getByText('Check the highlighted fields.')).toBeOnTheScreen();
    expect(
      screen.getByText("Enter the recipient's name in 120 characters or fewer."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Enter a valid Bangladeshi mobile number, e.g. 01712-345678.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('alert', { name: 'Choose a division' })).toBeOnTheScreen();
    expect(screen.getByRole('alert', { name: 'Choose a district' })).toBeOnTheScreen();
    expect(api.createAddress).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('clears a field’s error as soon as it is edited', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');
    await user.press(screen.getByRole('button', { name: 'Save address' }));
    expect(
      screen.getByText('Enter a valid Bangladeshi mobile number, e.g. 01712-345678.'),
    ).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Mobile phone'), '0');

    expect(
      screen.queryByText('Enter a valid Bangladeshi mobile number, e.g. 01712-345678.'),
    ).not.toBeOnTheScreen();
  });

  it('saves a valid address with the normalised phone and goes back', async () => {
    const api = apiWithAddresses([]);
    api.createAddress.mockResolvedValue({ address: { ...ADDRESS_HOME, id: SAVED.id } });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');

    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(api.createAddress).toHaveBeenCalledTimes(1);
    expect(api.createAddress).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, {
      recipientName: 'Ayesha Rahman',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: null,
      landmark: null,
      label: null,
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('offers the default switch next to existing addresses and sends it when on', async () => {
    const api = apiWithAddresses([ADDRESS_HOME]);
    api.createAddress.mockResolvedValue({ address: SAVED });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');

    const toggle = screen.getByRole('switch', { name: 'Use as my default delivery address' });
    expect(toggle).not.toBeChecked();
    await user.press(toggle);
    expect(
      screen.getByRole('switch', { name: 'Use as my default delivery address' }),
    ).toBeChecked();
    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(api.createAddress).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('puts the server’s field messages on the fields and stays on the form', async () => {
    const api = apiWithAddresses([]);
    api.createAddress.mockRejectedValue(
      new ApiError(400, 'validation_failed', 'Invalid', 'req-1', {
        details: {
          issues: [
            { location: 'body', path: 'phone', message: 'Enter a valid Bangladeshi mobile number' },
            { location: 'body', path: 'area', message: 'Too short' },
          ],
        },
      }),
    );
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    await fillValidAddress(user);

    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(
      await screen.findByText('Enter a valid Bangladeshi mobile number, e.g. 01712-345678.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Enter the area, thana or upazila in 80 characters or fewer.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Check the highlighted fields.')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
    // Typed values are kept, and the button is usable again.
    expect(screen.getByLabelText('Area, thana or upazila')).toHaveDisplayValue('Dhanmondi');
    expect(screen.getByRole('button', { name: 'Save address' })).toBeEnabled();
  });

  it('explains a refusal that is not about a field', async () => {
    const api = apiWithAddresses([]);
    api.createAddress.mockRejectedValue(
      new ApiError(409, 'address_limit_reached', 'Too many addresses'),
    );
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    await fillValidAddress(user);

    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(await screen.findByText('Address limit reached')).toBeOnTheScreen();
    expect(screen.getByText('Remove a saved address before adding another.')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says so when the connection fails, and keeps the form', async () => {
    const api = apiWithAddresses([]);
    api.createAddress.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    await fillValidAddress(user);

    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    expect(screen.getByLabelText('Mobile phone')).toHaveDisplayValue('01712 345678');
  });

  it('does not save twice when the button is pressed again while saving', async () => {
    const api = apiWithAddresses([]);
    let finish!: (value: { address: Address }) => void;
    api.createAddress.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    await fillValidAddress(user);

    await user.press(screen.getByRole('button', { name: 'Save address' }));
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(api.createAddress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save address' })).toBeDisabled();
    finish({ address: SAVED });
    await screen.findByLabelText('Recipient name');
  });

  it('is blocked, with an explanation, once the limit of addresses is reached', async () => {
    const full = Array.from({ length: MAX_ADDRESSES }, (_, index) => ({
      ...ADDRESS_HOME,
      id: `aaaaaaaa-1111-4222-8333-4444444444${String(index).padStart(2, '0')}`,
      isDefault: index === 0,
    }));
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses(full),
    });

    expect(await screen.findByText('Address limit reached')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Recipient name')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Back to addresses' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('retries when the address list cannot be loaded', async () => {
    const api = createFakeApiClient();
    api.listAddresses
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'))
      .mockResolvedValueOnce({ addresses: [] });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Recipient name')).toBeOnTheScreen();
  });
});

describe('AddressFormScreen: returning after a save', () => {
  it('returns to checkout with the saved address selected', async () => {
    searchParams.returnTo = '/checkout';
    const api = apiWithAddresses([ADDRESS_HOME]);
    api.createAddress.mockResolvedValue({ address: SAVED });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');

    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(router.dismissTo).toHaveBeenCalledWith({
      pathname: '/checkout',
      params: { address: SAVED.id },
    });
    expect(router.back).not.toHaveBeenCalled();
  });

  it('ignores a return path that is not one of the app’s own screens', async () => {
    searchParams.returnTo = 'https://evil.example/steal';
    const api = apiWithAddresses([]);
    api.createAddress.mockResolvedValue({ address: SAVED });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');

    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('opens the address book when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    const api = apiWithAddresses([]);
    api.createAddress.mockResolvedValue({ address: SAVED });
    const { user } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');

    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    expect(router.replace).toHaveBeenCalledWith('/addresses');
  });

  it('refreshes the address list and the checkout prices after saving', async () => {
    const api = apiWithAddresses([ADDRESS_HOME]);
    api.createAddress.mockResolvedValue({ address: SAVED });
    const { user, queryClient } = await renderCommerce(<AddressFormScreen />, { api });
    await screen.findByLabelText('Recipient name');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await fillValidAddress(user);
    await user.press(screen.getByRole('button', { name: 'Save address' }));

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(['user', expect.any(String), 'addresses']);
    expect(keys).toContainEqual(['user', expect.any(String), 'checkout']);
    // The list was fetched again, now including the new address.
    expect(api.listAddresses.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('AddressFormScreen: division and district', () => {
  it('keeps the district closed until a division is chosen', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');

    const district = screen.getByRole('button', { name: 'District' });
    expect(district).toBeDisabled();
    expect(within(district).getByText('Choose a division first')).toBeOnTheScreen();

    await choose(user, 'Division', 'Sylhet');

    expect(screen.getByRole('button', { name: 'District' })).toBeEnabled();
  });

  it('lists only the chosen division’s districts, and filters them as you type', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');
    await choose(user, 'Division', 'Sylhet');

    await user.press(screen.getByRole('button', { name: 'District' }));
    expect(labelsOf(screen.getAllByRole('radio'))).toEqual([
      'Habiganj',
      'Moulvibazar',
      'Sunamganj',
      'Sylhet',
    ]);
    expect(screen.queryByRole('radio', { name: 'Dhaka' })).not.toBeOnTheScreen();

    await user.type(screen.getByLabelText('Search district'), 'GANJ');
    expect(labelsOf(screen.getAllByRole('radio'))).toEqual(['Habiganj', 'Sunamganj']);

    await user.clear(screen.getByLabelText('Search district'));
    await user.type(screen.getByLabelText('Search district'), 'atlantis');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('No district matches "atlantis".')).toBeOnTheScreen();
  });

  it('marks the chosen option and closes the list when one is picked', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');
    await choose(user, 'Division', 'Rangpur');

    await user.press(screen.getByRole('button', { name: 'Division' }));
    expect(screen.getByRole('radio', { name: 'Rangpur' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sylhet' })).not.toBeChecked();
    await user.press(screen.getByRole('button', { name: 'Close Division list' }));

    expect(screen.queryByRole('radio', { name: 'Rangpur' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Division' })).toHaveAccessibilityValue({
      text: 'Rangpur',
    });
  });

  it('drops a district that does not belong to a newly chosen division', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');
    await choose(user, 'Division', 'Dhaka');
    await choose(user, 'District', 'Gazipur');
    expect(screen.getByRole('button', { name: 'District' })).toHaveAccessibilityValue({
      text: 'Gazipur',
    });

    await choose(user, 'Division', 'Khulna');

    expect(screen.getByRole('button', { name: 'District' })).toHaveAccessibilityValue({
      text: 'Not chosen',
    });
  });

  it('keeps a district that belongs to the newly chosen division', async () => {
    const { user } = await renderCommerce(<AddressFormScreen />, {
      api: apiWithAddresses([]),
    });
    await screen.findByLabelText('Recipient name');
    await choose(user, 'Division', 'Dhaka');
    await choose(user, 'District', 'Gazipur');

    await choose(user, 'Division', 'Dhaka');

    expect(screen.getByRole('button', { name: 'District' })).toHaveAccessibilityValue({
      text: 'Gazipur',
    });
  });
});

describe('AddressFormScreen: edit address', () => {
  it('loads the address from the list, saves every field and goes back', async () => {
    const api = apiWithAddresses([ADDRESS_HOME, ADDRESS_OFFICE]);
    api.updateAddress.mockResolvedValue({ address: { ...ADDRESS_OFFICE, area: 'Kandirpar' } });
    const { user } = await renderCommerce(<AddressFormScreen addressId={ADDRESS_OFFICE_ID} />, {
      api,
    });

    expect(await screen.findByLabelText('Recipient name')).toHaveDisplayValue('Rahim Uddin');
    expect(screen.getByLabelText('Mobile phone')).toHaveDisplayValue('01912-345678');
    expect(screen.getByRole('button', { name: 'Division' })).toHaveAccessibilityValue({
      text: 'Chattogram',
    });
    expect(screen.getByRole('button', { name: 'District' })).toHaveAccessibilityValue({
      text: 'Cumilla',
    });
    expect(screen.getByLabelText('Nearby landmark')).toHaveDisplayValue('the post office');

    await replaceText('Area, thana or upazila', 'Kandirpar');
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.updateAddress).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, ADDRESS_OFFICE_ID, {
      recipientName: 'Rahim Uddin',
      phone: '+8801912345678',
      division: 'Chattogram',
      district: 'Cumilla',
      area: 'Kandirpar',
      addressLine: 'Hall road, 2nd floor',
      postalCode: null,
      landmark: 'the post office',
      label: null,
    });
    expect(api.createAddress).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('does not offer the default switch for the current default address', async () => {
    await renderCommerce(<AddressFormScreen addressId={ADDRESS_HOME_ID} />, {
      api: apiWithAddresses([ADDRESS_HOME, ADDRESS_OFFICE]),
    });

    expect(await screen.findByText('This is your default delivery address.')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
  });

  it('offers to make another address the default', async () => {
    const api = apiWithAddresses([ADDRESS_HOME, ADDRESS_OFFICE]);
    api.updateAddress.mockResolvedValue({ address: { ...ADDRESS_OFFICE, isDefault: true } });
    const { user } = await renderCommerce(<AddressFormScreen addressId={ADDRESS_OFFICE_ID} />, {
      api,
    });
    await screen.findByLabelText('Recipient name');

    await user.press(screen.getByRole('switch', { name: 'Use as my default delivery address' }));
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.updateAddress).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      ADDRESS_OFFICE_ID,
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('says the address is gone instead of showing an empty form', async () => {
    const { user } = await renderCommerce(
      <AddressFormScreen addressId="11111111-2222-4333-8444-555555555555" />,
      { api: apiWithAddresses([ADDRESS_HOME]) },
    );

    expect(await screen.findByRole('header', { name: 'Address not found' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Recipient name')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Back to addresses' }));
    expect(router.replace).toHaveBeenCalledWith('/addresses');
  });

  it('reports a failed save and keeps the edits', async () => {
    const api = apiWithAddresses([ADDRESS_HOME, ADDRESS_OFFICE]);
    api.updateAddress.mockRejectedValue(new ApiError(404, 'not_found', 'No such address'));
    const { user } = await renderCommerce(<AddressFormScreen addressId={ADDRESS_OFFICE_ID} />, {
      api,
    });
    await screen.findByLabelText('Recipient name');
    await replaceText('Area, thana or upazila', 'Kandirpar');

    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Not found')).toBeOnTheScreen();
    expect(screen.getByLabelText('Area, thana or upazila')).toHaveDisplayValue('Kandirpar');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('address form routes', () => {
  it('asks a signed-out customer to sign in and brings them back to the new-address form', async () => {
    const { user } = await renderCommerce(<NewAddressRoute />, {
      api: createFakeApiClient(),
      session: { status: 'signed_out' },
    });

    expect(screen.getByText(/to add a delivery address/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/addresses/new' },
    });
  });

  it('brings a signed-out customer back to the address they were editing', async () => {
    searchParams.addressId = ADDRESS_OFFICE_ID;
    const { user } = await renderCommerce(<EditAddressRoute />, {
      api: createFakeApiClient(),
      session: { status: 'signed_out' },
    });

    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: `/addresses/${ADDRESS_OFFICE_ID}` },
    });
  });

  it('falls back to the address book as the way back for a malformed address id', async () => {
    searchParams.addressId = 'not-an-id';
    const { user } = await renderCommerce(<EditAddressRoute />, {
      api: createFakeApiClient(),
      session: { status: 'signed_out' },
    });

    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/addresses' },
    });
  });
});
