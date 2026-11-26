/**
 * Text shared by the place-order action and the form that shows its result. It lives
 * outside the action module because a 'use server' file may only export async functions.
 */

/**
 * The order may still exist: its answer can be lost after it is saved. Trying again from
 * this page reuses the same key, so it can never create a second order.
 */
export const ORDER_NOT_CONFIRMED =
  'We could not confirm your order. It may already be placed: check Your orders first. Trying again from this page will not create a second order.';
