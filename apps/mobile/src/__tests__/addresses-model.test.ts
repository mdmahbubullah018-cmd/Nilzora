import { BD_DISTRICTS, BD_DIVISIONS } from '@nilzora/contracts';
import {
  EMPTY_ADDRESS_VALUES,
  fieldErrorsFromApi,
  firstErrorField,
  validateAddressForm,
  valuesFromAddress,
  type AddressFormValues,
} from '../features/addresses/address-form-model';
import {
  addressLines,
  addressSummary,
  addressTitle,
  formatBdPhone,
  sortAddresses,
} from '../features/addresses/address-format';
import { filterOptions } from '../features/addresses/option-picker';
import { ADDRESS_HOME, ADDRESS_OFFICE } from '../test-utils/checkout-fakes';

const VALID: AddressFormValues = {
  recipientName: '  Ayesha Rahman ',
  phone: '01712-345 678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5',
  postalCode: '',
  landmark: '',
  label: '',
  isDefault: false,
};

describe('validateAddressForm', () => {
  it('accepts a valid address and sends what the API expects', () => {
    const result = validateAddressForm(VALID);

    expect(result).toEqual({
      ok: true,
      input: {
        recipientName: 'Ayesha Rahman',
        // Local number written with spaces and dashes becomes +8801XXXXXXXXX.
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        area: 'Dhanmondi',
        addressLine: 'House 12, Road 5',
        // Blank optional fields are sent as null, not as empty text.
        postalCode: null,
        landmark: null,
        label: null,
      },
    });
  });

  it.each(['+8801712345678', '8801712345678', '01712345678'])(
    'normalises the Bangladeshi mobile number %s',
    (phone) => {
      const result = validateAddressForm({ ...VALID, phone });
      expect(result.ok && result.input.phone).toBe('+8801712345678');
    },
  );

  it('sends isDefault only when it is switched on', () => {
    const off = validateAddressForm(VALID);
    const on = validateAddressForm({ ...VALID, isDefault: true });

    expect(off.ok && off.input.isDefault).toBeFalsy();
    expect(on.ok && on.input.isDefault).toBe(true);
  });

  it('keeps optional details when they are given', () => {
    const result = validateAddressForm({
      ...VALID,
      postalCode: '1209',
      landmark: ' Near the park ',
      label: 'Home',
    });

    expect(result.ok && result.input).toMatchObject({
      postalCode: '1209',
      landmark: 'Near the park',
      label: 'Home',
    });
  });

  it('reports every empty required field in the storefront wording', () => {
    const result = validateAddressForm(EMPTY_ADDRESS_VALUES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      recipientName: "Enter the recipient's name in 120 characters or fewer.",
      phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
      division: 'Choose a division',
      district: 'Choose a district',
      area: 'Enter the area, thana or upazila in 80 characters or fewer.',
      addressLine: 'Enter the house, road and block in 200 characters or fewer.',
    });
  });

  it.each([
    ['phone', '0171234', 'phone'],
    ['phone', '02123456789', 'phone'],
    ['postalCode', '12', 'postalCode'],
    ['postalCode', '12a4', 'postalCode'],
    ['area', 'x', 'area'],
    ['addressLine', 'abc', 'addressLine'],
  ] as const)('rejects %s = "%s"', (field, value, errorField) => {
    const result = validateAddressForm({ ...VALID, [field]: value });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[errorField]).toBeTruthy();
  });

  it('rejects a district that is not in the chosen division', () => {
    const result = validateAddressForm({ ...VALID, division: 'Sylhet', district: 'Dhaka' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.district).toBe('Choose a district in the selected division');
  });

  it('rejects over-long text', () => {
    const result = validateAddressForm({
      ...VALID,
      label: 'x'.repeat(41),
      landmark: 'y'.repeat(121),
    });

    expect(!result.ok && result.errors).toMatchObject({
      label: 'Keep the label under 40 characters.',
      landmark: 'Keep the landmark under 120 characters.',
    });
  });
});

describe('fieldErrorsFromApi', () => {
  it('maps the API validation issues on body fields to the form fields', () => {
    const errors = fieldErrorsFromApi({
      issues: [
        { location: 'body', path: 'phone', message: 'Enter a valid Bangladeshi mobile number' },
        {
          location: 'body',
          path: 'district',
          message: 'Choose a district in the selected division',
        },
        { location: 'body', path: 'phone', message: 'a second problem is ignored' },
        { location: 'params', path: 'id', message: 'not a form field' },
        { location: 'body', path: 'isDefault', message: 'not shown on a field' },
      ],
    });

    expect(errors).toEqual({
      phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
      district: 'Check this field.',
    });
  });

  it('ignores details that are not validation issues', () => {
    expect(fieldErrorsFromApi(undefined)).toEqual({});
    expect(fieldErrorsFromApi({ problems: [] })).toEqual({});
    expect(fieldErrorsFromApi('nope')).toEqual({});
  });
});

describe('address helpers', () => {
  it('finds the first error in the order the form shows its fields', () => {
    expect(firstErrorField({ label: 'x', area: 'y' })).toBe('area');
    expect(firstErrorField({})).toBeNull();
  });

  it('turns a saved address into form text, with the phone written locally', () => {
    expect(valuesFromAddress(ADDRESS_HOME)).toEqual({
      recipientName: 'Ayesha Rahman',
      phone: '01712-345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5, Block C',
      postalCode: '1209',
      landmark: '',
      label: 'Home',
      isDefault: false,
    });
  });

  it('writes a parcel address, a summary and a title', () => {
    expect(addressLines(ADDRESS_HOME)).toEqual([
      'House 12, Road 5, Block C',
      'Dhanmondi, Dhaka 1209',
      'Dhaka Division',
    ]);
    expect(addressLines(ADDRESS_OFFICE)).toEqual([
      'Hall road, 2nd floor',
      'Near the post office',
      'Kotbari, Cumilla',
      'Chattogram Division',
    ]);
    expect(addressSummary(ADDRESS_HOME)).toBe('Home · Dhanmondi, Dhaka');
    expect(addressSummary(ADDRESS_OFFICE)).toBe('Kotbari, Cumilla');
    expect(addressTitle(ADDRESS_HOME)).toBe('Home');
    expect(addressTitle(ADDRESS_OFFICE)).toBe('Rahim Uddin');
  });

  it('formats only normalised Bangladeshi numbers', () => {
    expect(formatBdPhone('+8801712345678')).toBe('01712-345678');
    expect(formatBdPhone('01712345678')).toBe('01712345678');
    expect(formatBdPhone('')).toBe('');
  });

  it('puts the default address first and keeps the server order otherwise', () => {
    const other = { ...ADDRESS_OFFICE, id: 'c4d5e6f7-1a2b-4c3d-9e4f-5a6b7c8d9e01' };

    expect(sortAddresses([ADDRESS_OFFICE, other, ADDRESS_HOME]).map((a) => a.id)).toEqual([
      ADDRESS_HOME.id,
      ADDRESS_OFFICE.id,
      other.id,
    ]);
  });
});

describe('filterOptions', () => {
  const allDistricts = BD_DIVISIONS.flatMap((division) => BD_DISTRICTS[division]);

  it('knows all 64 districts', () => {
    expect(allDistricts).toHaveLength(64);
  });

  it('returns everything for a blank search', () => {
    expect(filterOptions(allDistricts, '')).toHaveLength(64);
    expect(filterOptions(allDistricts, '   ')).toHaveLength(64);
  });

  it('matches part of a name, ignoring case and surrounding spaces', () => {
    expect(filterOptions(BD_DISTRICTS.Dhaka, ' NAR ')).toEqual(['Narayanganj', 'Narsingdi']);
    expect(filterOptions(allDistricts, "cox's")).toEqual(["Cox's Bazar"]);
  });

  it('returns nothing when no name matches', () => {
    expect(filterOptions(allDistricts, 'atlantis')).toEqual([]);
  });
});
