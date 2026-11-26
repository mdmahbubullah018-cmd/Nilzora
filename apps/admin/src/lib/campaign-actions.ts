'use server';

import type {
  ApiErrorCode,
  CampaignCouponPolicy,
  CampaignDiscountKind,
  CampaignScope,
  CampaignStatus,
  CampaignStatusRequest,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import { adminAct, formText, invalid, takaToMinor, type ActionState } from '@/components/admin-kit/act';
import type { FormState } from '@nilzora/web-session';

/*
 * Campaign changes. The form is checked here so a typo is caught before it leaves the
 * browser; the API authorises the change and its database function validates every rule
 * again — including that an activation needs the activate permission, which this screen
 * never decides on its own.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const CAMPAIGN_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  campaign_not_found: 'This campaign no longer exists.',
  campaign_invalid: 'The campaign cannot be saved as given. Check the discount and the targets.',
  campaign_conflict:
    'Another administrator changed this campaign while you were editing. Reload it and try again.',
  not_found: 'This campaign no longer exists.',
  forbidden: 'Your account cannot change discount campaigns.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
  validation_failed: 'Some of the details were refused. Check them and try again.',
  bad_request: 'Some of the details were refused. Check them and try again.',
};

/** "2026-12-01T09:00" from a datetime field, read as Bangladesh time (UTC+6). */
function bdTime(text: string): string | null | undefined {
  if (text.trim() === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(text.trim());
  return match ? new Date(`${match[1]}T${match[2]}:00+06:00`).toISOString() : undefined;
}

function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function idsOf(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map(String)
    .filter((value) => uuidSchema.safeParse(value).success);
}

const SCOPES: readonly CampaignScope[] = ['products', 'categories', 'brands', 'storewide'];

/** Reads the form back into the shape the form component re-renders after a refusal. */
function valuesOf(formData: FormData): Record<string, string> {
  const names = [
    'name',
    'customerTitle',
    'internalNotes',
    'scope',
    'discountKind',
    'discountValue',
    'maxDiscountMinor',
    'startsAt',
    'endsAt',
    'priority',
    'couponPolicy',
    'bannerImageKey',
  ];
  const values: Record<string, string> = {};
  for (const name of names) values[name] = formText(formData, name);
  values['isVisible'] = formData.get('isVisible') === 'on' ? 'on' : '';
  values['categoryIds'] = idsOf(formData, 'categoryIds').join(',');
  values['brandIds'] = idsOf(formData, 'brandIds').join(',');
  values['productIds'] = idsOf(formData, 'productIds').join(',');
  return values;
}

export async function saveCampaignAction(
  _previous: FormState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'campaignId') !== '';
  const campaignId = idOf(formData, 'campaignId');
  if (editing && campaignId === undefined) return PAGE_EXPIRED;

  const scopeText = formText(formData, 'scope');
  const scope = SCOPES.find((candidate) => candidate === scopeText) ?? 'categories';
  const kindText = formText(formData, 'discountKind');
  const discountKind: CampaignDiscountKind = kindText === 'fixed' ? 'fixed' : 'percent';
  const couponText = formText(formData, 'couponPolicy');
  const couponPolicy: CampaignCouponPolicy = couponText === 'blocked' ? 'blocked' : 'stackable';

  const valueText = formText(formData, 'discountValue').trim();
  const capText = formText(formData, 'maxDiscountMinor').trim();
  const value = discountKind === 'percent' ? wholeNumber(valueText) : takaToMinor(valueText);
  const capMinor = capText === '' ? null : takaToMinor(capText);
  const startsAt = bdTime(formText(formData, 'startsAt'));
  const endsAt = bdTime(formText(formData, 'endsAt'));
  const priority = wholeNumber(formText(formData, 'priority'));
  const expectedVersion = wholeNumber(formText(formData, 'expectedVersion'));
  const categoryIds = idsOf(formData, 'categoryIds');
  const brandIds = idsOf(formData, 'brandIds');
  const productIds = idsOf(formData, 'productIds');
  const values = valuesOf(formData);

  const errors: Record<string, string> = {};
  if (formText(formData, 'name').trim() === '') errors.name = 'Give the campaign a name.';
  // The customer-facing title is optional: an empty one is saved as a title-less campaign.
  if (value === undefined || value <= 0) {
    errors.discountValue =
      discountKind === 'percent' ? 'Enter a percentage from 1 to 100.' : 'Enter an amount.';
  } else if (discountKind === 'percent' && value > 100) {
    errors.discountValue = 'A percentage cannot exceed 100.';
  }
  if (capMinor === undefined) errors.maxDiscountMinor = 'Enter an amount, or leave it empty.';
  if (startsAt === undefined) errors.startsAt = 'Choose a valid date and time.';
  if (endsAt === undefined) errors.endsAt = 'Choose a valid date and time.';
  if (priority === undefined || priority < -100 || priority > 100) {
    errors.priority = 'Use a whole number from −100 to 100.';
  }
  if (scope === 'categories' && categoryIds.length === 0) {
    errors.categoryIds = 'Choose at least one category.';
  }
  if (scope === 'brands' && brandIds.length === 0) {
    errors.brandIds = 'Choose at least one brand.';
  }
  if (scope === 'products' && productIds.length === 0) {
    errors.productIds = 'Choose at least one product.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid('Check the highlighted fields.', errors, values);
  }

  const body = {
    name: formText(formData, 'name').trim(),
    customerTitle: formText(formData, 'customerTitle').trim(),
    internalNotes: formText(formData, 'internalNotes').trim() === ''
      ? null
      : formText(formData, 'internalNotes').trim(),
    scope,
    discountKind,
    discountValue: value ?? 1,
    // A fixed discount has no cap; the API refuses one, so it is never sent.
    maxDiscountMinor: discountKind === 'percent' ? capMinor ?? null : null,
    startsAt: startsAt ?? null,
    endsAt: endsAt ?? null,
    priority: priority ?? 0,
    isVisible: formData.get('isVisible') === 'on',
    bannerImageKey: formText(formData, 'bannerImageKey').trim() === ''
      ? null
      : formText(formData, 'bannerImageKey').trim(),
    couponPolicy,
    categoryIds: scope === 'categories' ? categoryIds : [],
    brandIds: scope === 'brands' ? brandIds : [],
    productIds: scope === 'products' ? productIds : [],
    expectedVersion: expectedVersion ?? null,
  };

  const result = await adminAct(
    formData,
    (api, token) =>
      campaignId === undefined
        ? api.adminCreateCampaign(token, body)
        : api.adminUpdateCampaign(token, campaignId, body),
    {
      returnTo: (editing ? `/admin/discounts/${String(campaignId)}` : '/admin/discounts/new') as Route,
      label: 'campaign save',
      messages: CAMPAIGN_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };

  const savedId = result.value.campaign.id;
  revalidatePath('/admin/discounts');
  revalidatePath(`/admin/discounts/${savedId}`);
  return {
    status: 'success',
    message: editing ? 'Campaign saved.' : 'Campaign created as a draft.',
  };
}

/** The permission-independent part of a status change; the API decides the rest. */
export async function setCampaignStatusAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  const status = formText(formData, 'campaignStatus') as CampaignStatus;
  const expectedVersion = wholeNumber(formText(formData, 'expectedVersion'));
  if (campaignId === undefined || expectedVersion === undefined) return;

  const body: CampaignStatusRequest = { status, expectedVersion };
  await adminAct(formData, (api, token) => api.adminSetCampaignStatus(token, campaignId, body), {
    returnTo: `/admin/discounts/${campaignId}` as Route,
    label: 'campaign status',
    messages: CAMPAIGN_MESSAGES,
  });
  revalidatePath('/admin/discounts');
  revalidatePath(`/admin/discounts/${campaignId}`);
  revalidatePath(`/admin/discounts/${campaignId}/edit`);
}

export async function duplicateCampaignAction(formData: FormData): Promise<void> {
  const campaignId = idOf(formData, 'campaignId');
  if (campaignId === undefined) return;
  await adminAct(formData, (api, token) => api.adminDuplicateCampaign(token, campaignId), {
    returnTo: `/admin/discounts/${campaignId}` as Route,
    label: 'campaign duplicate',
    messages: CAMPAIGN_MESSAGES,
  });
  revalidatePath('/admin/discounts');
}
