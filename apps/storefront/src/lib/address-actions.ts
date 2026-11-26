'use server';

import {
  addressInputSchema,
  addressSchema,
  MAX_ADDRESSES,
  validationErrorDetailsSchema,
  type Address,
  type AddressInput,
} from '@nilzora/contracts';
import {
  ApiError,
  FORM_EXPIRED,
  type FormState,
  type SessionAct,
  type SessionCall,
} from '@nilzora/web-session';
import { redirect } from 'next/navigation';
import { ADDRESSES_PATH, addressReturnPathFrom, type AddressReturnPath } from '@/lib/auth-routes';
import { session } from '@/lib/session';

/*
 * Address book actions. Each one checks the Origin and CSRF token (session.act) before
 * any API call; the API decides ownership (another account's address answers 404 like
 * a missing one). Fields are validated here with the shared contract, so mistakes come
 * back as field messages, and again by the API. Successes redirect, so the pages
 * re-render with the saved state with or without JavaScript. redirect() throws, so it
 * is never called inside try/catch.
 */

const FIELDS = [
  'label',
  'recipientName',
  'phone',
  'division',
  'district',
  'area',
  'addressLine',
  'postalCode',
  'landmark',
] as const;

/** Fixed wording per field; the division and district use the contract's own messages. */
const FIELD_MESSAGES: Partial<Record<string, string>> = {
  label: 'Keep the label under 40 characters.',
  recipientName: "Enter the recipient's name in 120 characters or fewer.",
  phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
  area: 'Enter the area, thana or upazila in 80 characters or fewer.',
  addressLine: 'Enter the house, road and block in 200 characters or fewer.',
  postalCode: 'Postal codes have 4 digits.',
  landmark: 'Keep the landmark under 120 characters.',
};

const CHECK_FIELDS = 'Check the highlighted fields.';
const UNAVAILABLE = 'Nilzora could not be reached. Please try again in a moment.';
const NOT_FOUND = 'This address no longer exists. It may have been deleted.';
const PAGE_EXPIRED = 'This page has expired. Reload the page and try again.';

const ADDRESS_MESSAGES: Partial<Record<string, string>> = {
  address_limit_reached: `You can keep up to ${MAX_ADDRESSES} addresses. Remove one to add another.`,
  not_found: NOT_FOUND,
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  account_suspended:
    'This account is suspended, so its addresses cannot be changed. Contact Nilzora support for help.',
};

type Values = Partial<Record<string, string>>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function logFailure(action: string, error: unknown): void {
  if (error instanceof ApiError) {
    console.error(`[nilzora] ${action} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error(`[nilzora] ${action} failed unexpectedly`);
  }
}

function fieldMessage(field: string, fallback: string): string {
  return FIELD_MESSAGES[field] ?? fallback;
}

/** The first problem of each field, from the contract's issues. */
function fieldErrorsFrom(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Values {
  const errors: Values = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || errors[field] !== undefined) continue;
    errors[field] = fieldMessage(field, issue.message);
  }
  return errors;
}

/** The API's validation issues on body fields, with this form's own wording. */
function apiFieldErrors(details: unknown): Values {
  const parsed = validationErrorDetailsSchema.safeParse(details);
  if (!parsed.success) return {};
  const errors: Values = {};
  for (const issue of parsed.data.issues) {
    const [field = ''] = issue.path.split('.');
    if (issue.location !== 'body' || !(FIELDS as readonly string[]).includes(field)) continue;
    errors[field] ??= fieldMessage(field, 'Check this field.');
  }
  return errors;
}

/** Maps a failed address call to a fixed message; nothing from the API is shown. */
function failureState(
  action: string,
  error: unknown,
  values: Values,
  fallback = 'The address could not be saved. Please try again.',
): FormState {
  if (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === 'invalid_response'
  ) {
    logFailure(action, error);
    return { status: 'error', message: UNAVAILABLE, values };
  }
  if (error.code === 'validation_failed') {
    const fieldErrors = apiFieldErrors(error.details);
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 'error', message: CHECK_FIELDS, fieldErrors, values };
    }
  }
  const message = ADDRESS_MESSAGES[error.code];
  if (message === undefined) logFailure(action, error);
  return { status: 'error', message: message ?? fallback, values };
}

/** Runs an authenticated call, keeping a thrown error as a value for mapping. */
async function attempt<T>(
  formData: FormData,
  call: SessionCall<T>,
): Promise<{ result: SessionAct<T> } | { error: unknown }> {
  return session.act(formData, call).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
}

function signInAgain(next: AddressReturnPath): never {
  redirect(`/login?next=${next}&session=expired`);
}

/** An address id from a hidden field, or undefined when it is not a uuid. */
function addressIdFrom(formData: FormData): string | undefined {
  const parsed = addressSchema.shape.id.safeParse(text(formData, 'addressId'));
  return parsed.success ? parsed.data : undefined;
}

/** Creates an address, or replaces one when the form carries its addressId. */
export async function saveAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values: Values = Object.fromEntries(FIELDS.map((field) => [field, text(formData, field)]));
  values.isDefault = text(formData, 'isDefault') === 'true' ? 'true' : '';
  const next = addressReturnPathFrom(text(formData, 'next'));

  const editing = text(formData, 'addressId') !== '';
  const addressId = addressIdFrom(formData);
  if (editing && addressId === undefined) {
    return { status: 'error', message: PAGE_EXPIRED, values };
  }

  // Only these fields are read; isDefault is only ever sent as true (see the contract).
  const parsed = addressInputSchema.safeParse({
    ...Object.fromEntries(FIELDS.map((field) => [field, values[field] ?? ''])),
    isDefault: values.isDefault === 'true' ? true : undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      values,
    };
  }
  const body: AddressInput = parsed.data;

  const outcome = await attempt(formData, (api, accessToken) =>
    addressId === undefined
      ? api.createAddress(accessToken, body)
      : api.updateAddress(accessToken, addressId, body),
  );
  if ('error' in outcome) return failureState('address save', outcome.error, values);

  const { result } = outcome;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') signInAgain(next);
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE, values };

  // Back at checkout, the saved address is the one selected for delivery.
  if (next === '/checkout') redirect(`/checkout?address=${result.value.address.id}`);
  redirect(`${ADDRESSES_PATH}?saved=1`);
}

export async function deleteAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const addressId = addressIdFrom(formData);
  if (addressId === undefined) return { status: 'error', message: PAGE_EXPIRED };

  const outcome = await attempt(formData, (api, accessToken) =>
    api.deleteAddress(accessToken, addressId),
  );
  if ('error' in outcome) {
    // Already gone (a repeated submit, another tab): the outcome the customer wanted.
    if (outcome.error instanceof ApiError && outcome.error.status === 404) {
      redirect(`${ADDRESSES_PATH}?deleted=1`);
    }
    return failureState(
      'address delete',
      outcome.error,
      {},
      'The address could not be deleted. Please try again.',
    );
  }

  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') signInAgain(ADDRESSES_PATH);
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };
  redirect(`${ADDRESSES_PATH}?deleted=1`);
}

/** Every saved field of an address, as the full replacement PUT expects. */
function replacementOf(address: Address): AddressInput {
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    division: address.division,
    district: address.district,
    area: address.area,
    addressLine: address.addressLine,
    postalCode: address.postalCode,
    landmark: address.landmark,
    isDefault: true,
  };
}

/**
 * Makes an address the default. The API replaces whole addresses, so the current
 * fields are read from the API (never from the form) and sent back with isDefault.
 */
export async function makeDefaultAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const addressId = addressIdFrom(formData);
  if (addressId === undefined) return { status: 'error', message: PAGE_EXPIRED };

  const outcome = await attempt(formData, async (api, accessToken) => {
    const { addresses } = await api.listAddresses(accessToken);
    const address = addresses.find((candidate) => candidate.id === addressId);
    if (!address) return null;
    if (address.isDefault) return address;
    return (await api.updateAddress(accessToken, addressId, replacementOf(address))).address;
  });
  if ('error' in outcome) {
    return failureState(
      'default address change',
      outcome.error,
      {},
      'The default address could not be changed. Please try again.',
    );
  }

  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') signInAgain(ADDRESSES_PATH);
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };
  if (result.value === null) return { status: 'error', message: NOT_FOUND };
  redirect(`${ADDRESSES_PATH}?default=1`);
}
