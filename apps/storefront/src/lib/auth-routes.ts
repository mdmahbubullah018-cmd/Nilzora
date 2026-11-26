import { safeRedirectPath } from '@nilzora/web-session';
import type { Route } from 'next';
/** The storefront's signed-in home, and the default place a sign-in returns to. */
export const ACCOUNT_PATH = '/account';

/** Checkout needs a session, so signing in may return there too. */
export const CHECKOUT_PATH = '/checkout';

/** The address book, inside the account area. */
export const ADDRESSES_PATH = '/account/addresses';

/** A product page: signing in to review a product returns the customer to it. */
export const PRODUCTS_PATH = '/products';

const RETURN_PREFIXES = [ACCOUNT_PATH, CHECKOUT_PATH, PRODUCTS_PATH] as const;

/**
 * Where to go after signing in. `next` comes from the URL or a form field, so it is
 * reduced to a same-origin path inside the account area, checkout or a product page;
 * anything else (another site, `//host`, backslash tricks, other sections) falls back to
 * the account page.
 */
export function returnPathFrom(value: unknown): Route {
  // safeRedirectPath only returns an allowed prefix or a path below one, which are routes.
  return safeRedirectPath(value, RETURN_PREFIXES, ACCOUNT_PATH) as Route;
}

const ADDRESS_RETURNS = [CHECKOUT_PATH, ADDRESSES_PATH] as const;

/** Where an address form goes back to once it is saved or abandoned. */
export type AddressReturnPath = (typeof ADDRESS_RETURNS)[number];

/**
 * The page an address form returns to: exactly checkout or the address book. Only
 * these two values are recognised (no prefixes, queries or other pages), so a crafted
 * link cannot use the form to send anyone elsewhere.
 */
export function addressReturnPathFrom(value: unknown): AddressReturnPath {
  return ADDRESS_RETURNS.find((path) => path === value) ?? ADDRESSES_PATH;
}
