import type { InfoLinkKey } from '@nilzora/contracts';
import type { Href } from 'expo-router';

/**
 * Where an information page sends the reader next, on this platform.
 *
 * The shared content names the destinations (shop, FAQ, privacy, terms, about, support) and
 * each platform maps them to its own routes, so the wording stays identical while the website
 * and the app keep their own addresses.
 */
export const INFO_HREFS: Readonly<Record<InfoLinkKey, Href>> = {
  shop: '/shop',
  faq: '/faq',
  privacy: '/privacy',
  terms: '/terms',
  about: '/about',
  support: '/support',
  returns: '/returns-policy',
  shipping: '/delivery-policy',
};

/** The Contact Nilzora screen: the store's published phone number, email address and address. */
export const CONTACT_HREF: Href = '/store';
