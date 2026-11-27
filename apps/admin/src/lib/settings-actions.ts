'use server';

import {
  deliveryChargeRequestSchema,
  DELIVERY_ZONES,
  salesTargetRequestSchema,
} from '@nilzora/contracts';
import { revalidatePath } from 'next/cache';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';
import { oneOf } from '@/components/admin-kit/href';
import { poishaToTaka } from '@/components/catalog/form-values';
import { adminRead } from '@/components/admin-kit/read';
import { DELIVERY_ZONE_LABEL } from '@/components/orders/order-query';
import {
  checkStoreRules,
  STORE_RULE_FIELDS,
  type StoreRuleField,
} from '@/components/settings/store-rules';
import { formatMoney } from './format';

/** Sets one zone's delivery charge (settings.manage; the store owner by default). */
export async function setDeliveryChargeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zone = oneOf(formText(formData, 'zone'), DELIVERY_ZONES);
  if (!zone) {
    return { status: 'error', message: 'This zone could not be identified. Reload the page.' };
  }
  const amount = formText(formData, 'amount');
  const amountMinor = takaToMinor(amount);
  const parsed = deliveryChargeRequestSchema.safeParse({ amountMinor });
  if (amountMinor === undefined || !parsed.success) {
    const message = 'Enter an amount from 0 to 100,000 taka, with at most two decimals.';
    return invalid(message, { amount: message }, { amount });
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetDeliveryCharge(token, zone, parsed.data),
    {
      returnTo: '/admin/settings',
      label: 'delivery charge change',
      messages: {
        forbidden: 'Changing delivery charges needs the “Manage store settings” permission.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { amount } };

  revalidatePath('/admin/settings');
  const saved = result.value.charge.amountMinor;
  return {
    status: 'success',
    message: `${DELIVERY_ZONE_LABEL[zone]} delivery is now ${saved === null ? 'not set' : formatMoney(saved)}.`,
    values: { amount: saved === null ? '' : String(saved / 100) },
  };
}

/**
 * Sets the monthly revenue target the dashboard measures this month against, or clears
 * it when the field is left empty (settings.manage).
 */
export async function setSalesTargetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const amount = formText(formData, 'target');
  const targetMinor = amount === '' ? null : takaToMinor(amount);
  const parsed = salesTargetRequestSchema.safeParse({ targetMinor });
  if (targetMinor === undefined || !parsed.success) {
    const message = 'Enter a target from 0 to 1,000,000,000 taka, or leave it empty to clear it.';
    return invalid(message, { target: message }, { target: amount });
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetSalesTarget(token, parsed.data),
    {
      returnTo: '/admin/settings',
      label: 'sales target change',
      messages: {
        forbidden: 'Changing the sales target needs the “Manage store settings” permission.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { target: amount } };

  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  const saved = result.value.target.targetMinor;
  return {
    status: 'success',
    message:
      saved === null
        ? 'The monthly sales target is cleared.'
        : `The monthly sales target is now ${formatMoney(saved)}.`,
    values: { target: saved === null ? '' : String(saved / 100) },
  };
}

/**
 * Saves the store rules (settings.manage): the return window, cart inactivity and the
 * customer-insight thresholds, together or not at all. The values are checked with the
 * contract schema the form uses; the API checks them again and audits the change. A
 * threshold left empty keeps its current value.
 */
export async function saveStoreRulesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const typed = Object.fromEntries(
    STORE_RULE_FIELDS.map((field) => [field, formText(formData, field)]),
  ) as Record<StoreRuleField, string>;

  const checked = checkStoreRules(typed);
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, typed);

  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveStoreSettings(token, checked.value),
    {
      returnTo: '/admin/settings',
      label: 'store rules change',
      messages: {
        forbidden: 'Changing the store rules needs the “Manage store settings” permission.',
        bad_request: 'Some of the values were refused. Check them and try again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: typed };

  revalidatePath('/admin/settings');
  const saved = result.value.settings;
  return {
    status: 'success',
    message: 'Store rules saved.',
    values: {
      returnWindowDays: String(saved.returnWindowDays),
      cartInactivityMinutes: String(saved.cartInactivityMinutes),
      repeatOrderThreshold: String(saved.repeatOrderThreshold),
      highSpend: poishaToTaka(saved.highSpendThresholdMinor),
      inactiveDays: String(saved.inactiveDays),
    },
  };
}

/**
 * Turns cash on delivery on or off (settings.manage).
 *
 * The rest of the store rules are sent as they are saved, because the API replaces the whole
 * settings row in one call; reading them first means the switch cannot quietly reset anything.
 * The order function reads the same flag, so a disabled COD refuses every cash order at once.
 */
export async function saveCodAvailabilityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const wanted = formText(formData, 'codEnabled') === 'on';
  const current = await adminRead((api, token) => api.adminGetStoreSettings(token));
  if (current.kind !== 'ok') {
    return {
      status: 'error',
      message: 'The current settings could not be read. Reload and try again.',
    };
  }
  const settings = current.value.settings;

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSaveStoreSettings(token, {
        returnWindowDays: settings.returnWindowDays,
        cartInactivityMinutes: settings.cartInactivityMinutes,
        repeatOrderThreshold: settings.repeatOrderThreshold,
        highSpendThresholdMinor: settings.highSpendThresholdMinor,
        inactiveDays: settings.inactiveDays,
        codEnabled: wanted,
      }),
    {
      returnTo: '/admin/settings',
      label: 'payment method change',
      messages: {
        forbidden:
          'Changing payment methods needs the \u201cManage store settings\u201d permission.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath('/admin/settings');
  revalidatePath('/checkout');
  return {
    status: 'success',
    message: result.value.settings.codEnabled
      ? 'Cash on delivery is on. Customers can place cash orders again.'
      : 'Cash on delivery is off. Checkout will tell customers it is unavailable.',
  };
}
