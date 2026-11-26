import { z } from 'zod';
import { appRoleSchema, permissionSchema } from './auth';
import { moneyMinorSchema } from './catalog';

/*
 * Roles and store settings
 * ------------------------
 * The roles matrix shows what each role holds by default; an account's own grants and denials
 * (see the staff screens) change what it holds in the end. The owner (super_admin) is reported
 * with EVERY permission in the catalogue, because that is what the owner holds: it is not read
 * from the stored role defaults, so a permission added later is the owner's immediately.
 */

/** One role and the permissions it holds by default, sorted by name. */
export const adminRoleSchema = z.object({
  role: appRoleSchema,
  permissions: z.array(permissionSchema),
});

/** GET /admin/roles — super_admin, admin, staff, moderator, customer, in that order. */
export const adminRolesResponseSchema = z.object({ roles: z.array(adminRoleSchema) });

/*
 * Store settings: the small values operations may change without a deploy.
 */

export const RETURN_WINDOW_DAYS = { min: 1, max: 90 } as const;
export const CART_INACTIVITY_MINUTES = { min: 15, max: 10_080 } as const;
export const REPEAT_ORDER_THRESHOLD = { min: 2, max: 20 } as const;
export const HIGH_SPEND_THRESHOLD_MINOR = { min: 1, max: 1_000_000_000 } as const;
export const INACTIVE_DAYS = { min: 7, max: 730 } as const;

export const storeSettingsSchema = z.object({
  /** How long after delivery a customer may ask to return items. */
  returnWindowDays: z.number().int().min(RETURN_WINDOW_DAYS.min).max(RETURN_WINDOW_DAYS.max),
  /** Inactivity after which a cart no longer counts as an open checkout. */
  cartInactivityMinutes: z
    .number()
    .int()
    .min(CART_INACTIVITY_MINUTES.min)
    .max(CART_INACTIVITY_MINUTES.max),
  /** Orders that make a customer a repeat customer. */
  repeatOrderThreshold: z
    .number()
    .int()
    .min(REPEAT_ORDER_THRESHOLD.min)
    .max(REPEAT_ORDER_THRESHOLD.max),
  /** Spend, in poisha, from which a customer counts as a high spender. */
  highSpendThresholdMinor: moneyMinorSchema
    .min(HIGH_SPEND_THRESHOLD_MINOR.min)
    .max(HIGH_SPEND_THRESHOLD_MINOR.max),
  /** Days without an order after which a customer counts as inactive. */
  inactiveDays: z.number().int().min(INACTIVE_DAYS.min).max(INACTIVE_DAYS.max),
  /**
   * Whether customers may place a cash-on-delivery order right now. The order function reads
   * the same flag, so turning it off closes checkout for every client at once.
   */
  codEnabled: z.boolean().default(true),
  /** The monthly sales target (set with PUT /admin/settings/sales-target); null when unset. */
  monthlySalesTargetMinor: moneyMinorSchema.nullable(),
  updatedAt: z.iso.datetime(),
});

export const storeSettingsResponseSchema = z.object({ settings: storeSettingsSchema });

/**
 * PUT /admin/settings/store. The two settings are always saved; a threshold left out keeps its
 * current value. Everything is saved together or not at all. The sales target is not part of
 * this request.
 */
export const saveStoreSettingsRequestSchema = z.strictObject({
  returnWindowDays: z.number().int().min(RETURN_WINDOW_DAYS.min).max(RETURN_WINDOW_DAYS.max),
  cartInactivityMinutes: z
    .number()
    .int()
    .min(CART_INACTIVITY_MINUTES.min)
    .max(CART_INACTIVITY_MINUTES.max),
  repeatOrderThreshold: z
    .number()
    .int()
    .min(REPEAT_ORDER_THRESHOLD.min)
    .max(REPEAT_ORDER_THRESHOLD.max)
    .optional(),
  highSpendThresholdMinor: z
    .number()
    .int()
    .min(HIGH_SPEND_THRESHOLD_MINOR.min)
    .max(HIGH_SPEND_THRESHOLD_MINOR.max)
    .optional(),
  inactiveDays: z.number().int().min(INACTIVE_DAYS.min).max(INACTIVE_DAYS.max).optional(),
  /** Turning cash on delivery off closes checkout; leaving it out keeps the current setting. */
  codEnabled: z.boolean().optional(),
});

export type AdminRole = z.infer<typeof adminRoleSchema>;
export type AdminRolesResponse = z.infer<typeof adminRolesResponseSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export type StoreSettingsResponse = z.infer<typeof storeSettingsResponseSchema>;
export type SaveStoreSettingsRequest = z.input<typeof saveStoreSettingsRequestSchema>;
