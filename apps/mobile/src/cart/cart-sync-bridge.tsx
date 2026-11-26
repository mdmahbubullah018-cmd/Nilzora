import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef } from 'react';
import { useApi } from '@/api/api-context';
import { useSession } from '@/auth/session-context';
import { useCart } from './cart-context';
import { createCartSync, type CartSync } from './cart-sync';

/**
 * The server-cart sync for this device, or null when the app has no usable session manager
 * (an unconfigured build). Building it twice is harmless: both share the same storage keys,
 * and every call is idempotent for its line or attempt.
 */
export function useCartSync(injected?: CartSync): CartSync | null {
  const api = useApi();
  const { state, manager } = useSession();
  const signedIn = state.status === 'signed_in';
  return useMemo<CartSync | null>(() => {
    if (injected !== undefined) return injected;
    if (manager === null) return null;
    return createCartSync({
      storage: AsyncStorage,
      api,
      authorized: (call) => manager.authorized(call),
      signedIn: () => signedIn,
    });
  }, [api, injected, manager, signedIn]);
}

/**
 * Keeps the server's copy of the cart in step with this device. Rendered inside the cart and
 * session providers and draws nothing.
 *
 * It mirrors the lines that changed, so adding, changing, removing or emptying a line is
 * recorded without any screen having to call the API. A cart filled before signing in is
 * folded into the account once the session becomes signed in. Nothing here is fatal: a
 * failed mirror leaves the device cart exactly as it was.
 */
export function CartSyncBridge({ sync: injected }: { sync?: CartSync }) {
  const sync = useCartSync(injected);
  const { state } = useSession();
  const { items, hydrated } = useCart();
  const accountId = state.status === 'signed_in' ? state.user.id : null;

  const previous = useRef<typeof items>(items);

  useEffect(() => {
    if (sync === null || !hydrated) return;
    const before = previous.current;
    previous.current = items;
    void sync.syncLines(before, items);
  }, [items, hydrated, sync]);

  // A different account, or the same one after signing in again, takes the guest cart over.
  useEffect(() => {
    if (sync === null || accountId === null) return;
    void sync.mergeGuestCart();
  }, [accountId, sync]);

  return null;
}
