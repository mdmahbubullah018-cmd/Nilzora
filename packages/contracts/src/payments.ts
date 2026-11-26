import { z } from 'zod';

/*
 * The ways a customer can pay.
 *
 * Only cash on delivery works today. bKash and Nagad are shown as "coming soon" so a shopper
 * knows they are planned, but they are not choices: there is no gateway, no credentials and no
 * order path behind them. Keeping the list here means the website, the app and the admin all
 * describe the same three methods, and that adding a real integration later is a change to one
 * module rather than a hunt through three codebases.
 */

export const PAYMENT_METHOD_IDS = ['cod', 'bkash', 'nagad'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

/** `available` can be chosen and paid; `coming_soon` is visible but never selectable. */
export const PAYMENT_METHOD_STATUSES = ['available', 'coming_soon'] as const;
export type PaymentMethodStatus = (typeof PAYMENT_METHOD_STATUSES)[number];

export interface PaymentMethod {
  id: PaymentMethodId;
  /** The name as the brand writes it. */
  label: string;
  /** How it is paid, in one short line. */
  description: string;
  status: PaymentMethodStatus;
  /** The badge a coming-soon method wears. */
  badge?: string;
}

/**
 * The three methods, in the order the checkout lists them. The `status` here is the *product*
 * status (does an integration exist?), not the store's switch: cash on delivery's own
 * availability comes from `codAvailable` in the store profile.
 */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  {
    id: 'cod',
    label: 'Cash on Delivery',
    description: 'Pay the courier in cash when your parcel arrives.',
    status: 'available',
  },
  {
    id: 'bkash',
    label: 'bKash',
    description: 'Pay from your bKash wallet before dispatch.',
    status: 'coming_soon',
    badge: 'Coming soon',
  },
  {
    id: 'nagad',
    label: 'Nagad',
    description: 'Pay from your Nagad account before dispatch.',
    status: 'coming_soon',
    badge: 'Coming soon',
  },
];

/** The methods a customer can actually choose right now. */
export function selectablePaymentMethods(codAvailable: boolean): PaymentMethod[] {
  return PAYMENT_METHODS.filter(
    (method) => method.status === 'available' && (method.id !== 'cod' || codAvailable),
  );
}

/** True when no method can be chosen, so checkout has nothing to offer. */
export function checkoutUnavailable(codAvailable: boolean): boolean {
  return selectablePaymentMethods(codAvailable).length === 0;
}

/**
 * The payment step's state, as the API reports it. Today only cash on delivery can be on or
 * off; bKash and Nagad are fixed as `coming_soon` until they are really integrated.
 */
export const paymentAvailabilitySchema = z.object({ codAvailable: z.boolean() });
export type PaymentAvailability = z.infer<typeof paymentAvailabilitySchema>;
