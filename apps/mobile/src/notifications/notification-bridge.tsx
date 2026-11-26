import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { useAuthorizedApi } from '@/query';
import { useSplashFinished } from '@/startup/splash-state';
import {
  categorySlugFromData,
  orderNumberFromData,
  productSlugFromData,
  screenFromData,
} from './notification-links';
import {
  currentUserId,
  pinToUser,
  refreshRegistration,
  resumeRegistration,
} from './push-registration';
import {
  addTapListener,
  addTokenListener,
  showForegroundNotifications,
  takeLaunchTap,
} from './push-service';

/**
 * App-wide notification wiring. Renders nothing; mount it once, inside the app's
 * providers, next to the navigator (see app/_layout.tsx):
 *
 *   <AppProviders>
 *     <Stack ... />
 *     <NotificationBridge />
 *   </AppProviders>
 *
 * It does four things, none of which ever shows a permission prompt:
 *  1. Shows notifications that arrive while the app is open.
 *  2. Opens /order/<orderNumber> when the customer taps an order notification and
 *     /product/<slug> when they tap a new-product announcement (including the tap that
 *     started the app) - only for a well-formed identifier.
 *  3. After sign-in, silently registers this device again for an account that already
 *     turned order updates on and still has permission.
 *  4. While signed in, registers a token the platform rotated, only when it changed.
 * Failures in 3 and 4 are ignored: push is never a prerequisite for anything else.
 */
export function NotificationBridge(): null {
  const router = useRouter();
  const authorized = useAuthorizedApi();
  const { manager } = useSession();
  const userId = useSignedInUserId();
  // Navigating before the navigator exists would be lost (or throw) on a cold start.
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const launchFinished = useSplashFinished();

  useEffect(() => showForegroundNotifications(), []);

  useEffect(() => {
    if (!navigationReady) return;
    const open = (data: unknown) => {
      const orderNumber = orderNumberFromData(data);
      if (orderNumber !== null) {
        router.push({ pathname: '/order/[orderNumber]', params: { orderNumber } });
        return;
      }
      // A product announcement opens the product itself; a product that has since been
      // taken off sale answers with the app's own "not found" screen.
      const productSlug = productSlugFromData(data);
      if (productSlug !== null) {
        router.push({ pathname: '/product/[slug]', params: { slug: productSlug } });
        return;
      }
      // A broadcast may open a category or one of a few fixed screens instead.
      const categorySlug = categorySlugFromData(data);
      if (categorySlug !== null) {
        router.push({ pathname: '/category/[slug]', params: { slug: categorySlug } });
        return;
      }
      const screen = screenFromData(data);
      if (screen !== null) router.push(screen);
    };
    const launch = takeLaunchTap();
    if (launch !== null) open(launch.data);
    return addTapListener(open);
  }, [navigationReady, router]);

  useEffect(() => {
    // Registration talks to the platform and the API; it waits until the launch is over so it
    // never competes with the first screen. Taps (above) are not deferred.
    if (userId === null || !launchFinished) return;
    let active = true;
    // Also false the moment another account is signed in, before this effect is cleaned up.
    const isActive = () => active && currentUserId(manager) === userId;
    // Whatever this account's work does when it finally runs, it can only act as this account.
    const run = pinToUser(authorized, manager, userId);
    // One registration at a time: a rotated token must not race the sign-in registration.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (task: () => Promise<void>) => {
      queue = queue.then(task).catch(() => undefined);
    };

    enqueue(() => resumeRegistration({ run, userId, isActive }));
    const stopListening = addTokenListener((token) => {
      enqueue(() => refreshRegistration({ run, userId, isActive, token }));
    });
    return () => {
      active = false;
      stopListening();
    };
  }, [authorized, launchFinished, manager, userId]);

  return null;
}
