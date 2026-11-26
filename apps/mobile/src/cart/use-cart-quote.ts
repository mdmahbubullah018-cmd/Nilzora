import type { CartQuote } from '@nilzora/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';
import { useCart } from './cart-context';

/**
 * The server's price for the cart (POST /cart/quote): per-line prices, `problem` codes
 * (`unavailable`, `quantity_limit`, `insufficient_stock`), `availableQuantity`, the
 * subtotal, `itemCount` and `purchasable`. Nothing is computed on the device. A line's
 * variant is sent with it, because that is what the server prices.
 *
 * The query is disabled while the cart is empty or still loading from storage, so an empty
 * cart never calls the API. Check `useCart().count === 0` first and show the empty cart
 * yourself; `data` is undefined then. While a changed cart is being re-priced the previous
 * quote stays in `data` (`isPlaceholderData` is true), so the list does not flicker.
 *
 * The result is a React Query result, so it works with <QueryState query={...}>.
 */
export function useCartQuote(): UseQueryResult<CartQuote> {
  const api = useApi();
  const { items, hydrated } = useCart();
  return useQuery({
    queryKey: queryKeys.cart.quote(items),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      const { quote } = await api.quoteCart(
        items.map(({ productId, variantId, quantity }) =>
          variantId ? { productId, variantId, quantity } : { productId, quantity },
        ),
        { signal },
      );
      return quote;
    },
    enabled: api !== null && hydrated && items.length > 0,
    // Keep showing the last quote while a changed cart is re-priced, but never the quote of
    // a cart that has just been emptied.
    placeholderData: (previous) => (items.length > 0 ? previous : undefined),
  });
}
