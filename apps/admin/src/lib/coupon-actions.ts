'use server';

import {
  couponTargetingInputSchema,
  customerListQuerySchema,
  type ApiErrorCode,
  type CouponRecipient,
  type CouponKind,
  type CouponSaveRequest,
  type CouponTargetingInput,
} from '@nilzora/contracts';
import { redirect } from 'next/navigation';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';
import type { Route } from 'next';
import { session } from './session';

/*
 * Coupon changes. The form is checked here so a typo is caught before it leaves the
 * browser; the API authorises the change and its database function validates every
 * rule again, so nothing here is a security boundary.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const CREATE_FORBIDDEN =
  'Creating a coupon needs the “Create coupons” permission. Ask the store owner or an admin if you need it.';

const COUPON_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  name_taken: 'Another coupon already uses this code.',
  not_found: 'This coupon no longer exists.',
  in_use:
    'This coupon was already used in orders, so its code and discount can no longer change. Create a new coupon for different terms.',
  bad_request:
    'The coupon was refused as given. Check the fields, and that every chosen customer still has a customer account.',
  forbidden: 'Your account cannot manage coupons.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

/** "2026-11-01T09:00" from a datetime field, read as Bangladesh time (UTC+6). */
function bdTime(text: string): string | null | undefined {
  if (text.trim() === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(text.trim());
  return match ? new Date(`${match[1]}T${match[2]}:00+06:00`).toISOString() : undefined;
}

/** A positive whole number from a text field, or undefined when it is not one. */
function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

/** Whether the signed-in account holds coupons.create (read from the verified session). */
async function mayCreateCoupons(): Promise<boolean> {
  const state = await session.getSession();
  return state.status === 'signed_in' && state.user.permissions.includes('coupons.create');
}

export async function saveCouponAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'couponId') !== '';
  const couponId = idOf(formData, 'couponId');
  if (editing && couponId === undefined) return PAGE_EXPIRED;
  // Creating needs coupons.create on top of coupons.update (editing needs only the latter).
  if (!editing && !(await mayCreateCoupons()))
    return { status: 'error', message: CREATE_FORBIDDEN };

  const kindText = formText(formData, 'kind');
  const kind: CouponKind =
    kindText === 'fixed' ? 'fixed' : kindText === 'free_delivery' ? 'free_delivery' : 'percent';
  const valueText = formText(formData, 'value');
  const minOrderText = formText(formData, 'minOrderMinor').trim();
  const capText = formText(formData, 'maxDiscountMinor').trim();
  // Empty means "no minimum" and "no cap"; only a filled-in value has to parse.
  const minOrderMinor = minOrderText === '' ? 0 : takaToMinor(minOrderText);
  const capMinor = capText === '' ? null : takaToMinor(capText);
  const startsAt = bdTime(formText(formData, 'startsAt'));
  const endsAt = bdTime(formText(formData, 'endsAt'));
  const totalLimit = wholeNumber(formText(formData, 'totalLimit'));
  const perCustomerLimit = wholeNumber(formText(formData, 'perCustomerLimit'));

  const errors: Record<string, string> = {};
  // Free delivery has no amount of its own: it waives whatever the delivery charge is.
  const value =
    kind === 'free_delivery'
      ? 1
      : kind === 'percent'
        ? wholeNumber(valueText)
        : takaToMinor(valueText);
  if (value === undefined || value <= 0) {
    errors.value = kind === 'percent' ? 'Enter a percentage from 1 to 100.' : 'Enter an amount.';
  } else if (kind === 'percent' && value > 100) {
    errors.value = 'A percentage cannot exceed 100.';
  }
  if (minOrderMinor === undefined) errors.minOrderMinor = 'Enter an amount, or leave it empty.';
  if (capMinor === undefined) errors.maxDiscountMinor = 'Enter an amount, or leave it empty.';
  if (startsAt === undefined) errors.startsAt = 'Choose a valid date and time.';
  if (endsAt === undefined) errors.endsAt = 'Choose a valid date and time.';
  if (totalLimit === undefined && formText(formData, 'totalLimit').trim() !== '') {
    errors.totalLimit = 'Use a whole number, or leave it empty for unlimited.';
  }
  if (perCustomerLimit === undefined) {
    errors.perCustomerLimit = 'Use a whole number of at least 1.';
  }

  const values = {
    code: formText(formData, 'code'),
    description: formText(formData, 'description'),
    kind,
    value: valueText,
    minOrderMinor: formText(formData, 'minOrderMinor'),
    maxDiscountMinor: formText(formData, 'maxDiscountMinor'),
    startsAt: formText(formData, 'startsAt'),
    endsAt: formText(formData, 'endsAt'),
    totalLimit: formText(formData, 'totalLimit'),
    perCustomerLimit: formText(formData, 'perCustomerLimit'),
  };

  // Voucher and eligibility settings, only when the form showed them (the catalogue loaded).
  let targeting: CouponTargetingInput | undefined;
  if (formText(formData, 'targetingLoaded') === '1') {
    const collectText = formText(formData, 'collectLimit').trim();
    const collectLimit = collectText === '' ? null : wholeNumber(collectText);
    if (collectLimit === undefined || collectLimit === 0) {
      errors.collectLimit = 'Use a whole number of at least 1, or leave it empty.';
    }
    const ids = (name: string) =>
      formData
        .getAll(name)
        .filter(
          (value): value is string =>
            typeof value === 'string' && uuidSchema.safeParse(value).success,
        );
    const parsed = couponTargetingInputSchema.safeParse({
      isVoucher: formData.get('isVoucher') === 'on',
      title: formText(formData, 'title').trim() === '' ? null : formText(formData, 'title').trim(),
      scope: formText(formData, 'scope') || 'storewide',
      categoryIds: formText(formData, 'scope') === 'categories' ? ids('categoryIds') : [],
      productIds: formText(formData, 'scope') === 'products' ? ids('productIds') : [],
      audience: formText(formData, 'audience') || 'all',
      collectLimit: collectLimit ?? null,
      customerIds:
        formText(formData, 'audience') === 'selected_customers'
          ? [...new Set(ids('customerIds'))]
          : [],
    });
    if (parsed.success) targeting = parsed.data;
    else {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'scope');
        errors[field] ??= issue.message;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return invalid('Check the highlighted fields.', errors, values);
  }

  const body: CouponSaveRequest = {
    code: formText(formData, 'code'),
    kind,
    value: value ?? 0,
    minOrderMinor: minOrderMinor ?? 0,
    // A fixed discount has no cap; the API refuses one, so it is never sent.
    maxDiscountMinor: kind === 'percent' ? (capMinor ?? null) : null,
    startsAt: startsAt ?? null,
    endsAt: endsAt ?? null,
    totalLimit: totalLimit ?? null,
    perCustomerLimit: perCustomerLimit ?? 1,
    isActive: formData.get('isActive') === 'on',
    description:
      formText(formData, 'description').trim() === '' ? null : formText(formData, 'description'),
    ...(targeting ? { targeting } : {}),
  };

  const result = await adminAct(
    formData,
    (api, token) =>
      couponId === undefined
        ? api.adminCreateCoupon(token, body)
        : api.adminUpdateCoupon(token, couponId, body),
    {
      returnTo: (editing ? `/admin/coupons/${String(couponId)}` : '/admin/coupons') as Route,
      label: 'coupon save',
      messages: COUPON_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath('/admin/coupons');
  if (couponId !== undefined) revalidatePath(`/admin/coupons/${couponId}`);
  return {
    status: 'success',
    message: editing ? 'Coupon saved.' : 'Coupon created.',
  };
}

export type CustomerSearchResult =
  | { ok: true; customers: CouponRecipient[] }
  /** A fixed message: the API's own text never reaches the browser. */
  | { ok: false; message: string };

/** How many matches the customer picker lists for one search. */
const PICKER_PAGE_SIZE = 10;

/**
 * The coupon form's customer picker: active customer accounts whose name, email or phone
 * contains the text. It is a Server Action so the browser needs no API token, and it is
 * refused like any form without this app's Origin and CSRF token. The API requires
 * customers.read; the coupon itself is checked again when it is saved.
 */
export async function searchCouponCustomersAction(formData: FormData): Promise<CustomerSearchResult> {
  const query = formText(formData, 'q').trim();
  if (query.length < 2) return { ok: true, customers: [] };
  const parsed = customerListQuerySchema.safeParse({
    q: query,
    status: 'active',
    page: 1,
    pageSize: PICKER_PAGE_SIZE,
  });
  if (!parsed.success) return { ok: false, message: 'That search text is too long.' };
  const result = await adminAct(formData, (api, token) => api.adminListCustomers(token, parsed.data), {
    returnTo: '/admin/coupons',
    label: 'coupon customer search',
    messages: {
      forbidden: 'Choosing customers needs the “View customers” permission.',
      rate_limited: 'Too many searches in a short time. Wait a moment, then try again.',
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.state.message ?? 'Customers could not be searched.' };
  }
  return {
    ok: true,
    customers: result.value.customers.map((customer) => ({
      id: customer.id,
      name: customer.fullName,
      email: customer.email,
      phone: customer.phone,
    })),
  };
}

/** Turns a coupon on or off. A coupon is never deleted, so redemptions stay auditable. */
export async function setCouponActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const couponId = idOf(formData, 'couponId');
  const wanted = formText(formData, 'isActive');
  if (couponId === undefined || (wanted !== 'true' && wanted !== 'false')) return PAGE_EXPIRED;
  const isActive = wanted === 'true';

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCouponActive(token, couponId, isActive),
    {
      returnTo: `/admin/coupons/${couponId}` as Route,
      label: 'coupon activation',
      messages: COUPON_MESSAGES,
    },
  );
  if (!result.ok) return result.state;

  revalidatePath('/admin/coupons');
  revalidatePath(`/admin/coupons/${couponId}`);
  return {
    status: 'success',
    message: isActive
      ? 'Coupon activated. Checkout accepts it again.'
      : 'Coupon deactivated. Checkout no longer accepts it.',
  };
}

/**
 * Deletes a coupon or voucher nobody redeemed, then returns to the list. One that was used
 * in an order is refused by the database; switch it off instead.
 */
export async function deleteCouponAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const couponId = idOf(formData, 'couponId');
  if (couponId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteCoupon(token, couponId), {
    returnTo: `/admin/coupons/${couponId}` as Route,
    label: 'coupon delete',
    messages: {
      ...COUPON_MESSAGES,
      in_use: 'This coupon was used in orders, so it cannot be deleted. Deactivate it instead.',
    },
  });
  if (!result.ok) return result.state;
  revalidatePath('/admin/coupons');
  redirect('/admin/coupons');
}
