import type { Href } from 'expo-router';
import type { IconName } from '@/components/icon';
import type { TabBarItem } from '@/components/tab-bar';
import { SUPPORT_HREF } from '@/features/support/routes';

/*
 * The bottom navigation, as data.
 *
 * Home, Categories, Wishlist, Chat and Account — the five places a shopper goes most. Four are
 * tab routes. Chat is the app's existing support screen, opened above the tabs, so the bar
 * points at that one href instead of inventing a second chat route or screen.
 *
 * The account's own screens (profile details, orders, addresses, payment, settings) are stack
 * screens above these, so none of them needs a second tab. Keeping the table here lets the
 * layout stay a wiring file, and lets the tests check the bar's destinations without a
 * navigation container.
 */

export interface TabDefinition {
  label: string;
  icon: IconName;
  /** Drawn instead of `icon` while this tab is the current one. */
  activeIcon?: IconName;
}

/** The tab routes the navigator declares. */
export const TAB_DEFINITIONS = {
  index: { label: 'Home', icon: 'home' },
  categories: { label: 'Categories', icon: 'categories' },
  wishlist: { label: 'Wishlist', icon: 'wishlist', activeIcon: 'wishlistFilled' },
  account: { label: 'Account', icon: 'account' },
} as const satisfies Record<string, TabDefinition>;

/** Route name → its href. Expo Router checks these against the real route tree. */
export const TAB_HREFS = {
  index: '/',
  categories: '/categories',
  wishlist: '/wishlist',
  account: '/account',
} as const satisfies Record<string, Href>;

/** One button in the bar: either a tab route, or an existing screen opened above the tabs. */
export interface BarDestination extends TabDefinition {
  key: string;
  /** Set when the destination is a screen above the tabs rather than a tab route. */
  href?: Href;
}

/** The five destinations, in order. */
export const TAB_BAR: readonly BarDestination[] = [
  { key: 'index', ...TAB_DEFINITIONS.index },
  { key: 'categories', ...TAB_DEFINITIONS.categories },
  { key: 'wishlist', ...TAB_DEFINITIONS.wishlist },
  // The same Message Circle outline the website's "Chat with us" launcher uses, opening the
  // existing support inbox behind its own signed-in gate. The cart lives in the Home header.
  { key: 'chat', label: 'Chat', icon: 'message', href: SUPPORT_HREF },
  { key: 'account', ...TAB_DEFINITIONS.account },
];

export function hrefFor(name: string): (typeof TAB_HREFS)[keyof typeof TAB_HREFS] {
  return TAB_HREFS[name as keyof typeof TAB_HREFS] ?? '/';
}

export function definitionFor(name: string): TabDefinition {
  return TAB_DEFINITIONS[name as keyof typeof TAB_DEFINITIONS] ?? TAB_DEFINITIONS.index;
}

/**
 * The count a tab shows and how it is spoken. The wishlist count is device-local (or the
 * account's), so it is real and needs no request; a tab without one gets neither.
 */
export function badgeFor(
  name: string,
  wishlistCount: number,
): Pick<TabBarItem, 'badgeCount' | 'badgeLabel'> {
  if (name === 'wishlist') {
    return { badgeCount: wishlistCount, badgeLabel: `Wishlist, ${wishlistCount} saved` };
  }
  return {};
}
