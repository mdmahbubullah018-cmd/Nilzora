import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useCart } from '@/cart';
import { Button } from '@/components/button';
import { CartGlyph } from '@/components/cart-glyph';
import { queryViewState, QueryStateView } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { ListSkeleton } from '@/components/skeleton';
import { useAddresses } from '@/features/addresses/use-addresses';
import { useStoreProfile } from '@/features/store/store-hooks';
import { CheckoutBody } from './checkout-body';
import type { SavedKind } from './use-place-order';

/**
 * The checkout route's content. Render it inside <SignedInGate returnTo="/checkout">.
 * It handles everything before the order can be reviewed: the saved cart still loading, an
 * empty cart, the address list loading or failing, and no address yet. Placing the order
 * empties the cart and opens the new order (`placed=1`); until the screen is replaced it
 * shows a short "order placed" state so the emptied cart is never shown as "Your cart is
 * empty".
 */
export function CheckoutScreen() {
  const router = useRouter();
  const cart = useCart();
  const addresses = useAddresses();
  // The store's own switch: when cash on delivery is off, checkout says so instead of
  // offering a button the database would refuse.
  const profile = useStoreProfile();
  const codAvailable = profile.data?.profile.codAvailable ?? true;
  // Set by the body once the order is saved. The body empties the cart itself and stays
  // on screen, showing that the order was placed, until the order page replaces it.
  const [saved, setSaved] = useState<SavedKind | null>(null);

  if (saved === null && !cart.hydrated) {
    return (
      <Screen edges={STACK_EDGES}>
        <ListSkeleton rows={2} label="Loading your cart" />
      </Screen>
    );
  }

  if (saved === null && cart.items.length === 0) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="empty"
          empty={{
            icon: CartGlyph,
            title: 'Your cart is empty',
            description: 'Add products to your cart, then come back here to place your order.',
            action: (
              <Button
                label="Go to your cart"
                onPress={() => {
                  router.navigate('/cart');
                }}
              />
            ),
          }}
        />
      </Screen>
    );
  }

  if (saved === null && cart.items.length > 0 && cart.selectedItems.length === 0) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="empty"
          empty={{
            icon: CartGlyph,
            title: 'No items selected',
            description: 'Choose the items you want to order in your cart, then come back.',
            action: (
              <Button
                label="Go to your cart"
                onPress={() => {
                  router.navigate('/cart');
                }}
              />
            ),
          }}
        />
      </Screen>
    );
  }

  const view = queryViewState(addresses, (list) => list.length === 0);
  if (view === 'loading') {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView state="loading" loadingLabel="Loading your addresses" />
      </Screen>
    );
  }
  if (view === 'error') {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="error"
          error={addresses.error}
          onRetry={() => void addresses.refetch()}
          retrying={addresses.isRefetching}
        />
      </Screen>
    );
  }

  if (view === 'empty' || addresses.data === undefined) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="empty"
          empty={{
            icon: MapPin,
            title: 'Add a delivery address',
            description:
              'Tell us where to deliver your order. We bring it to your door and you pay in cash.',
            action: (
              <Button
                label="Add a delivery address"
                onPress={() => {
                  router.push({ pathname: '/addresses/new', params: { returnTo: '/checkout' } });
                }}
              />
            ),
          }}
        />
      </Screen>
    );
  }

  return (
    <CheckoutBody
      addresses={addresses.data}
      saved={saved}
      onSaved={setSaved}
      codAvailable={codAvailable}
    />
  );
}
