import {
  addressInputSchema,
  validationErrorDetailsSchema,
  type Address,
  type AddressInput,
} from '@nilzora/contracts';
import { formatBdPhone } from './address-format';

/*
 * The address form's data and rules. Validation is the shared contract's
 * (addressInputSchema, the same schema the API runs), worded as on the storefront; the
 * API's own field issues are mapped back onto the same fields.
 */

export const ADDRESS_FIELDS = [
  'recipientName',
  'phone',
  'division',
  'district',
  'area',
  'addressLine',
  'postalCode',
  'landmark',
  'label',
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type AddressFieldErrors = Partial<Record<AddressField, string>>;

export interface AddressFormValues extends Record<AddressField, string> {
  isDefault: boolean;
}

export const EMPTY_ADDRESS_VALUES: AddressFormValues = {
  recipientName: '',
  phone: '',
  division: '',
  district: '',
  area: '',
  addressLine: '',
  postalCode: '',
  landmark: '',
  label: '',
  isDefault: false,
};

/** The saved address as form text. The default switch starts off: it only ever moves the default. */
export function valuesFromAddress(address: Address): AddressFormValues {
  return {
    recipientName: address.recipientName,
    phone: formatBdPhone(address.phone),
    division: address.division,
    district: address.district,
    area: address.area,
    addressLine: address.addressLine,
    postalCode: address.postalCode ?? '',
    landmark: address.landmark ?? '',
    label: address.label ?? '',
    isDefault: false,
  };
}

/** Fixed wording per field; the division and district use the contract's own messages. */
const FIELD_MESSAGES: Readonly<Partial<Record<AddressField, string>>> = {
  label: 'Keep the label under 40 characters.',
  recipientName: "Enter the recipient's name in 120 characters or fewer.",
  phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
  area: 'Enter the area, thana or upazila in 80 characters or fewer.',
  addressLine: 'Enter the house, road and block in 200 characters or fewer.',
  postalCode: 'Postal codes have 4 digits.',
  landmark: 'Keep the landmark under 120 characters.',
};

function isAddressField(value: unknown): value is AddressField {
  return typeof value === 'string' && (ADDRESS_FIELDS as readonly string[]).includes(value);
}

export type AddressValidation =
  { ok: true; input: AddressInput } | { ok: false; errors: AddressFieldErrors };

/**
 * Checks the form with the shared contract. On success `input` is what the API expects
 * (phone normalised to +8801XXXXXXXXX, blank optional fields as null). `isDefault` is only
 * ever sent as true: the contract ignores false, because the default only moves by choosing
 * another address.
 */
export function validateAddressForm(values: AddressFormValues): AddressValidation {
  const parsed = addressInputSchema.safeParse({
    recipientName: values.recipientName,
    phone: values.phone,
    division: values.division,
    district: values.district,
    area: values.area,
    addressLine: values.addressLine,
    postalCode: values.postalCode,
    landmark: values.landmark,
    label: values.label,
    isDefault: values.isDefault ? true : undefined,
  });
  if (parsed.success) return { ok: true, input: parsed.data };

  const errors: AddressFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (!isAddressField(field) || errors[field] !== undefined) continue;
    errors[field] = FIELD_MESSAGES[field] ?? issue.message;
  }
  return { ok: false, errors };
}

/** The API's validation issues on body fields (`details.issues`), in this form's wording. */
export function fieldErrorsFromApi(details: unknown): AddressFieldErrors {
  const parsed = validationErrorDetailsSchema.safeParse(details);
  if (!parsed.success) return {};
  const errors: AddressFieldErrors = {};
  for (const issue of parsed.data.issues) {
    const [field] = issue.path.split('.');
    if (issue.location !== 'body' || !isAddressField(field)) continue;
    errors[field] ??= FIELD_MESSAGES[field] ?? 'Check this field.';
  }
  return errors;
}

/** The first field with an error, in the order the form shows them; null when there is none. */
export function firstErrorField(errors: AddressFieldErrors): AddressField | null {
  return ADDRESS_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}
