import {
  CART_INACTIVITY_MINUTES,
  HIGH_SPEND_THRESHOLD_MINOR,
  INACTIVE_DAYS,
  REPEAT_ORDER_THRESHOLD,
  RETURN_WINDOW_DAYS,
  saveStoreSettingsRequestSchema,
  type SaveStoreSettingsRequest,
  type StoreSettings,
} from '@nilzora/contracts';
import { poishaToTaka, takaToPoisha } from '@/components/catalog/form-values';

/*
 * The "Store rules" form's rules: the return window, how long a cart may sit before it no
 * longer counts as an open checkout, and the customer-insight thresholds. Shared by the form
 * (which checks while staff type) and the Server Action (which checks again before calling
 * the API, which checks a third time) through the contract's own request schema. Free of
 * server and Next.js imports.
 */

export const STORE_RULE_FIELDS = [
  'returnWindowDays',
  'cartInactivityMinutes',
  'repeatOrderThreshold',
  'highSpend',
  'inactiveDays',
] as const;
export type StoreRuleField = (typeof STORE_RULE_FIELDS)[number];
export type StoreRuleTexts = Record<StoreRuleField, string>;
export type StoreRuleErrors = Partial<Record<StoreRuleField, string>>;
export type StoreRulesChecked =
  { ok: true; value: SaveStoreSettingsRequest } | { ok: false; errors: StoreRuleErrors };

export const STORE_RULE_LIMITS = {
  returnWindowDays: RETURN_WINDOW_DAYS,
  cartInactivityMinutes: CART_INACTIVITY_MINUTES,
  repeatOrderThreshold: REPEAT_ORDER_THRESHOLD,
  inactiveDays: INACTIVE_DAYS,
  /** In taka, as typed. */
  highSpend: {
    min: HIGH_SPEND_THRESHOLD_MINOR.min / 100,
    max: HIGH_SPEND_THRESHOLD_MINOR.max / 100,
  },
} as const;

const KEEP = ' Leave it empty to keep the current one.';

export const STORE_RULE_MESSAGES: Record<StoreRuleField, string> = {
  returnWindowDays: `Use a whole number of days from ${String(RETURN_WINDOW_DAYS.min)} to ${String(RETURN_WINDOW_DAYS.max)}.`,
  cartInactivityMinutes: `Use a whole number of minutes from ${String(CART_INACTIVITY_MINUTES.min)} to ${CART_INACTIVITY_MINUTES.max.toLocaleString('en-US')} (seven days).`,
  repeatOrderThreshold: `Use a whole number of orders from ${String(REPEAT_ORDER_THRESHOLD.min)} to ${String(REPEAT_ORDER_THRESHOLD.max)}.${KEEP}`,
  highSpend: `Use an amount from ${String(STORE_RULE_LIMITS.highSpend.min)} to ${STORE_RULE_LIMITS.highSpend.max.toLocaleString('en-US')} taka, with at most two decimals.${KEEP}`,
  inactiveDays: `Use a whole number of days from ${String(INACTIVE_DAYS.min)} to ${String(INACTIVE_DAYS.max)}.${KEEP}`,
};

/** The saved settings as the form's text fields (the high-spend amount in taka). */
export function storeRuleTexts(settings: StoreSettings): StoreRuleTexts {
  return {
    returnWindowDays: String(settings.returnWindowDays),
    cartInactivityMinutes: String(settings.cartInactivityMinutes),
    repeatOrderThreshold: String(settings.repeatOrderThreshold),
    highSpend: poishaToTaka(settings.highSpendThresholdMinor),
    inactiveDays: String(settings.inactiveDays),
  };
}

/** A whole number as typed; NaN (which the schema refuses) when it is not one. */
function whole(text: string): number {
  return /^\d{1,6}$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * Checks the typed values with the contract's request schema. The return window and cart
 * inactivity are required; a threshold left empty is left out of the request, which keeps
 * its current value. Messages are fixed text naming the allowed range.
 */
export function checkStoreRules(
  values: Partial<Record<StoreRuleField, string>>,
): StoreRulesChecked {
  const text = (field: StoreRuleField) => (values[field] ?? '').trim();
  const optional = (field: StoreRuleField, parse: (value: string) => number) =>
    text(field) === '' ? undefined : parse(text(field));

  const candidate = {
    returnWindowDays: whole(text('returnWindowDays')),
    cartInactivityMinutes: whole(text('cartInactivityMinutes')),
    repeatOrderThreshold: optional('repeatOrderThreshold', whole),
    highSpendThresholdMinor: optional('highSpend', (value) => takaToPoisha(value) ?? Number.NaN),
    inactiveDays: optional('inactiveDays', whole),
  };
  // Optional fields that were left empty are omitted, not sent as undefined keys.
  const body = Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  );

  const parsed = saveStoreSettingsRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };

  const errors: StoreRuleErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    const field: StoreRuleField | undefined =
      key === 'highSpendThresholdMinor'
        ? 'highSpend'
        : (STORE_RULE_FIELDS as readonly PropertyKey[]).includes(key as PropertyKey)
          ? (key as StoreRuleField)
          : undefined;
    if (field) errors[field] ??= STORE_RULE_MESSAGES[field];
  }
  return { ok: false, errors };
}
