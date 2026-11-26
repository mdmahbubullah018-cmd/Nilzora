import type { Href } from 'expo-router';

/**
 * The account's own screens. They are stack screens above the tabs, so the Account tab keeps
 * its selected state while one of them is open, and each one has a way back.
 */
export const PROFILE_HREF = '/profile' as Href;
export const PAYMENT_HREF = '/payment' as Href;
export const SETTINGS_HREF = '/settings' as Href;
export const ORDERS_HREF = '/orders' as Href;
