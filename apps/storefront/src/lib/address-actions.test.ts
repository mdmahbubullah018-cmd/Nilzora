// @vitest-environment node
import type { Address, AddressInput } from '@nilzora/contracts';
import type { FormState, SessionAct, SessionCall } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  address,
  apiError,
  HOME_ID,
  OFFICE_ID,
  officeAddress,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import {
  deleteAddressAction,
  makeDefaultAddressAction,
  saveAddressAction,
} from './address-actions';

type Gate = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const browser = vi.hoisted(() => {
  const holder: { gate: Gate } = { gate: 'ok' };
  return holder;
});
const api = vi.hoisted(() => ({
  listAddresses: vi.fn<(token: string) => Promise<{ addresses: Address[] }>>(),
  createAddress: vi.fn<(token: string, body: AddressInput) => Promise<{ address: Address }>>(),
  updateAddress:
    vi.fn<(token: string, id: string, body: AddressInput) => Promise<{ address: Address }>>(),
  deleteAddress: vi.fn<(token: string, id: string) => Promise<void>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    act: async <T>(_formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>> => {
      if (browser.gate !== 'ok') return { kind: browser.gate };
      return { kind: 'ok', value: await call(api as never, 'tok') };
    },
  },
}));

const idle: FormState = { status: 'idle' };

const VALID_FIELDS = {
  label: 'Home',
  recipientName: 'Rahima Khatun',
  phone: '01712-345678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5',
  postalCode: '1205',
  landmark: '',
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.append('csrf_token', 'signed-csrf-value');
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

beforeEach(() => {
  browser.gate = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  api.createAddress.mockResolvedValue({ address: officeAddress() });
  api.updateAddress.mockResolvedValue({ address: address() });
  api.deleteAddress.mockResolvedValue(undefined);
  api.listAddresses.mockResolvedValue({ addresses: [address(), officeAddress()] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('saveAddressAction', () => {
  it('creates an address from validated fields only, then returns to the address book', async () => {
    const fields = { ...VALID_FIELDS, isDefault: 'true', userId: 'someone-else', role: 'admin' };

    await expect(saveAddressAction(idle, form(fields))).rejects.toMatchObject(
      redirectedTo('/account/addresses?saved=1'),
    );

    expect(api.createAddress).toHaveBeenCalledWith('tok', {
      label: 'Home',
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: '1205',
      landmark: null,
      isDefault: true,
    });
    expect(api.updateAddress).not.toHaveBeenCalled();
  });

  it('never sends isDefault: false', async () => {
    await expect(saveAddressAction(idle, form(VALID_FIELDS))).rejects.toMatchObject(
      redirectedTo('/account/addresses?saved=1'),
    );
    expect(api.createAddress.mock.calls[0]?.[1].isDefault).toBeUndefined();
  });

  it('replaces an address when the form names one', async () => {
    await expect(
      saveAddressAction(idle, form({ ...VALID_FIELDS, addressId: HOME_ID })),
    ).rejects.toMatchObject(redirectedTo('/account/addresses?saved=1'));

    expect(api.updateAddress).toHaveBeenCalledWith('tok', HOME_ID, expect.anything());
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it('returns to checkout with the saved address selected', async () => {
    await expect(
      saveAddressAction(idle, form({ ...VALID_FIELDS, next: '/checkout' })),
    ).rejects.toMatchObject(redirectedTo(`/checkout?address=${OFFICE_ID}`));
  });

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['another page', '/account'],
  ])('ignores `next` naming %s', async (_label, next) => {
    await expect(saveAddressAction(idle, form({ ...VALID_FIELDS, next }))).rejects.toMatchObject(
      redirectedTo('/account/addresses?saved=1'),
    );
  });

  it('marks invalid fields and keeps what was typed', async () => {
    const result = await saveAddressAction(
      idle,
      form({ ...VALID_FIELDS, phone: '0123', postalCode: '12', division: 'Khulna' }),
    );

    expect(result.status).toBe('error');
    expect(result.message).toBe('Check the highlighted fields.');
    expect(result.fieldErrors).toStrictEqual({
      phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
      postalCode: 'Postal codes have 4 digits.',
      district: 'Choose a district in the selected division',
    });
    expect(result.values).toMatchObject({ phone: '0123', postalCode: '12', division: 'Khulna' });
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it('asks for every required field', async () => {
    const result = await saveAddressAction(idle, form({}));

    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual([
      'addressLine',
      'area',
      'district',
      'division',
      'phone',
      'recipientName',
    ]);
    expect(result.fieldErrors?.division).toBe('Choose a division');
    expect(result.fieldErrors?.district).toBe('Choose a district');
  });

  it('refuses a malformed address id without calling the API', async () => {
    const result = await saveAddressAction(idle, form({ ...VALID_FIELDS, addressId: '../me' }));

    expect(result.message).toBe('This page has expired. Reload the page and try again.');
    expect(api.updateAddress).not.toHaveBeenCalled();
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it('reports an expired or cross-site form', async () => {
    browser.gate = 'untrusted';

    const result = await saveAddressAction(idle, form(VALID_FIELDS));

    expect(result.message).toContain('This form has expired');
    expect(result.values?.recipientName).toBe('Rahima Khatun');
  });

  it('sends a signed-out customer to sign in, back to where they came from', async () => {
    browser.gate = 'signed_out';

    await expect(
      saveAddressAction(idle, form({ ...VALID_FIELDS, next: '/checkout' })),
    ).rejects.toMatchObject(redirectedTo('/login?next=/checkout&session=expired'));
  });

  it.each([
    ['address_limit_reached', 409, 'You can keep up to 10 addresses. Remove one to add another.'],
    ['not_found', 404, 'This address no longer exists. It may have been deleted.'],
    ['rate_limited', 429, 'Too many attempts. Wait a few minutes, then try again.'],
    ['account_suspended', 403, 'This account is suspended, so its addresses cannot be changed.'],
    ['service_unavailable', 503, 'Nilzora could not be reached. Please try again in a moment.'],
    ['network_error', 0, 'Nilzora could not be reached. Please try again in a moment.'],
    ['forbidden', 403, 'The address could not be saved. Please try again.'],
  ])('maps %s to a fixed message', async (code, status, message) => {
    api.createAddress.mockRejectedValue(apiError(status, code));

    const result = await saveAddressAction(idle, form(VALID_FIELDS));

    expect(result.message).toContain(message);
    expect(result.message).not.toContain('API says');
    expect(result.values?.area).toBe('Dhanmondi');
  });

  it('maps API validation issues to the form fields', async () => {
    api.createAddress.mockRejectedValue(
      apiError(400, 'validation_failed', {
        issues: [
          { location: 'body', path: 'district', message: 'raw API words' },
          { location: 'body', path: 'secretField', message: 'ignored' },
        ],
      }),
    );

    const result = await saveAddressAction(idle, form(VALID_FIELDS));

    expect(result.fieldErrors).toStrictEqual({ district: 'Check this field.' });
  });
});

describe('deleteAddressAction', () => {
  it('deletes the address and returns to the address book', async () => {
    await expect(deleteAddressAction(idle, form({ addressId: HOME_ID }))).rejects.toMatchObject(
      redirectedTo('/account/addresses?deleted=1'),
    );
    expect(api.deleteAddress).toHaveBeenCalledWith('tok', HOME_ID);
  });

  it('treats an address that is already gone as deleted', async () => {
    api.deleteAddress.mockRejectedValue(apiError(404, 'not_found'));

    await expect(deleteAddressAction(idle, form({ addressId: HOME_ID }))).rejects.toMatchObject(
      redirectedTo('/account/addresses?deleted=1'),
    );
  });

  it('refuses a malformed id, an untrusted form and an outage', async () => {
    expect((await deleteAddressAction(idle, form({ addressId: 'x' }))).status).toBe('error');
    expect(api.deleteAddress).not.toHaveBeenCalled();

    browser.gate = 'untrusted';
    expect((await deleteAddressAction(idle, form({ addressId: HOME_ID }))).message).toContain(
      'This form has expired',
    );

    browser.gate = 'unavailable';
    expect((await deleteAddressAction(idle, form({ addressId: HOME_ID }))).message).toBe(
      'Nilzora could not be reached. Please try again in a moment.',
    );
  });

  it('uses its own wording for an unexpected refusal', async () => {
    api.deleteAddress.mockRejectedValue(apiError(409, 'conflict'));

    const result = await deleteAddressAction(idle, form({ addressId: HOME_ID }));

    expect(result.message).toBe('The address could not be deleted. Please try again.');
  });

  it('sends a signed-out customer to sign in', async () => {
    browser.gate = 'signed_out';
    await expect(deleteAddressAction(idle, form({ addressId: HOME_ID }))).rejects.toMatchObject(
      redirectedTo('/login?next=/account/addresses&session=expired'),
    );
  });
});

describe('makeDefaultAddressAction', () => {
  it('re-sends the saved fields from the API with isDefault, never fields from the form', async () => {
    const fields = { addressId: OFFICE_ID, recipientName: 'Someone else', phone: '01999999999' };

    await expect(makeDefaultAddressAction(idle, form(fields))).rejects.toMatchObject(
      redirectedTo('/account/addresses?default=1'),
    );

    expect(api.updateAddress).toHaveBeenCalledWith('tok', OFFICE_ID, {
      label: 'Office',
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      division: 'Chattogram',
      district: 'Chattogram',
      area: 'Agrabad',
      addressLine: 'Level 4, Agrabad Tower',
      postalCode: null,
      landmark: null,
      isDefault: true,
    });
  });

  it('does nothing more for the address that is already the default', async () => {
    await expect(
      makeDefaultAddressAction(idle, form({ addressId: HOME_ID })),
    ).rejects.toMatchObject(redirectedTo('/account/addresses?default=1'));
    expect(api.updateAddress).not.toHaveBeenCalled();
  });

  it("reports an address that is not one of the customer's own", async () => {
    const result = await makeDefaultAddressAction(
      idle,
      form({ addressId: 'ad000000-0000-4000-8000-0000000000ff' }),
    );

    expect(result.message).toBe('This address no longer exists. It may have been deleted.');
    expect(api.updateAddress).not.toHaveBeenCalled();
  });

  it('maps failures to fixed messages', async () => {
    api.updateAddress.mockRejectedValue(apiError(500, 'internal_error'));
    expect((await makeDefaultAddressAction(idle, form({ addressId: OFFICE_ID }))).message).toBe(
      'Nilzora could not be reached. Please try again in a moment.',
    );

    api.updateAddress.mockRejectedValue(apiError(409, 'conflict'));
    expect((await makeDefaultAddressAction(idle, form({ addressId: OFFICE_ID }))).message).toBe(
      'The default address could not be changed. Please try again.',
    );

    browser.gate = 'untrusted';
    expect(
      (await makeDefaultAddressAction(idle, form({ addressId: OFFICE_ID }))).message,
    ).toContain('This form has expired');
  });
});
