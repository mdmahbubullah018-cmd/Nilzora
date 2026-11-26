import type { ApiClient } from '@nilzora/api-client';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiProvider } from '@/api/api-context';
import { SessionProvider } from '@/auth/session-context';
import type { SessionManager } from '@/auth/session-manager';
import { CartProvider } from '@/cart/cart-context';
import { CartSyncBridge } from '@/cart/cart-sync-bridge';
import type { CartStore } from '@/cart/cart-store';
import { AppQueryProvider } from '@/query/app-query-provider';
import { WishlistProvider } from '@/wishlist/wishlist-context';
import type { WishlistStore } from '@/wishlist/wishlist-store';

export interface AppProvidersProps {
  children: ReactNode;
  /** Tests only: inject fakes. The app passes nothing. */
  session?: SessionManager | null;
  api?: ApiClient | null;
  queryClient?: QueryClient;
  cartStore?: CartStore;
  wishlistStore?: WishlistStore;
}

/**
 * Every app-wide provider, in dependency order. app/_layout.tsx and the test helper
 * (renderWithProviders) both use it, so tests exercise the real wiring.
 *
 * - Session first: it owns the tokens and the signed-in state everything else reacts to.
 * - Api next: the one API client (shared with the session manager).
 * - Query inside session: it clears one account's cached data when the account changes.
 * - Cart and wishlist innermost: both are device-local and depend on nothing above except
 *   the query client (the wishlist reads live products through it).
 */
export function AppProviders({
  children,
  session,
  api,
  queryClient,
  cartStore,
  wishlistStore,
}: AppProvidersProps) {
  return (
    <SessionProvider manager={session}>
      <ApiProvider api={api}>
        <AppQueryProvider client={queryClient}>
          <CartProvider store={cartStore}>
            <CartSyncBridge />
            <WishlistProvider store={wishlistStore}>{children}</WishlistProvider>
          </CartProvider>
        </AppQueryProvider>
      </ApiProvider>
    </SessionProvider>
  );
}
