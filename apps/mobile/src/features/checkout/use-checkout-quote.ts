import { useQuery } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { useCart } from '@/cart';
import { queryKeys, useAuthorizedApi } from '@/query';

/**
 * The server's price for the cart delivered to one of the customer's addresses
 * (POST /checkout/quote): lines with their problems, subtotal, the delivery charge of the
 * address's zone and the total. Nothing is computed on the device.
 *
 * It is asked again whenever the cart, the address or the coupon changes, and always when checkout
 * opens: a total the customer is about to confirm must be current. While a changed cart or
 * address is being priced the previous quote stays in `data` with `isPlaceholderData` set;
 * it is for display only and must not be confirmed. The query waits (stays disabled) until
 * an address is chosen.
 */
export function useCheckoutQuote(addressId: string | null, couponCode: string | undefined) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  // Only the lines the customer selected are priced: the order is those items, nothing else.
  const { selectedItems: items, hydrated } = useCart();
  return useQuery({
    queryKey: [...queryKeys.checkout.quote(userId, items, addressId ?? ''), couponCode ?? ''],
    queryFn: ({ signal }) =>
      run(async (api, accessToken) => {
        if (addressId === null) throw new Error('A delivery address is needed to price checkout');
        const { quote } = await api.quoteCheckout(
          accessToken,
          {
            // The variant travels with the product: it is what the server prices and names.
            items: items.map(({ productId, variantId, quantity }) =>
              variantId ? { productId, variantId, quantity } : { productId, quantity },
            ),
            addressId,
            // The code only; the database decides the discount and says why a code fails.
            ...(couponCode === undefined ? {} : { couponCode }),
          },
          { signal },
        );
        return quote;
      }),
    enabled: userId !== null && hydrated && items.length > 0 && addressId !== null,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}
