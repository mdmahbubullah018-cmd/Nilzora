import { createElement, useEffect, type ReactNode } from 'react';
import { Pressable } from 'react-native';

/*
 * Replacement for 'expo-router' in screen tests. Not imported by the app, so never bundled.
 *
 *   import { resetRouterMock, router, searchParams } from '@/test-utils/expo-router-mock';
 *   jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
 *   beforeEach(resetRouterMock);
 *
 * Then set `searchParams.returnTo = '/orders'` before rendering a screen that reads route
 * parameters, and assert on `router.push`, `router.replace`, `router.dismissTo`,
 * `router.back`, `router.navigate`. The hooks below are the ones the app's screens use;
 * add more here when a screen needs them.
 */

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** What useLocalSearchParams() and useGlobalSearchParams() return. */
export const searchParams: Record<string, string | string[] | undefined> = {};

/** The options a screen last handed to <Stack.Screen>, so tests can assert the bar title. */
export const stackScreenOptions: Record<string, unknown> = {};

let currentPathname = '/';

export function setPathname(next: string): void {
  currentPathname = next;
}

/** Clears call history, restores canGoBack, and empties the params and the pathname. */
export function resetRouterMock(): void {
  for (const fn of Object.values(router)) fn.mockClear();
  router.canGoBack.mockReturnValue(true);
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  for (const key of Object.keys(stackScreenOptions)) delete stackScreenOptions[key];
  currentPathname = '/';
}

export const useRouter = () => router;
export const useLocalSearchParams = () => searchParams;
export const useGlobalSearchParams = () => searchParams;
export const usePathname = () => currentPathname;

/** Runs the effect once on mount, like a screen that has just been focused. */
export function useFocusEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

/** A pressable that pushes its href: enough to assert navigation in tests. */
export function Link({ href, children, ...rest }: { href: unknown; children?: ReactNode }) {
  return createElement(
    Pressable,
    {
      accessibilityRole: 'link',
      onPress: () => {
        router.push(href);
      },
      ...rest,
    },
    children,
  );
}

/** Screens configure their header with <Stack.Screen options={...} />; nothing renders, but the
 * options are recorded so tests can assert the native bar title. */
function StackScreen({ options }: { options?: unknown }) {
  for (const key of Object.keys(stackScreenOptions)) delete stackScreenOptions[key];
  if (options !== null && typeof options === 'object') {
    Object.assign(stackScreenOptions, options);
  }
  return null;
}

export const Stack = { Screen: StackScreen };

/** Records the redirect like a navigation would, and renders nothing. */
export function Redirect({ href }: { href: unknown }) {
  useEffect(() => {
    router.replace(href);
  }, [href]);
  return null;
}
