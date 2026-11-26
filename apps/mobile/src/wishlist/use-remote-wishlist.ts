import type { WishlistItem } from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/api/api-context';
import { useSignedInUserId } from '@/auth/session-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { useAuthorizedApi } from '@/query/use-authorized-api';
import { queryKeys } from '@/query/query-keys';

/*
 * The account's wishlist, and the bridge to the device's list
 * ----------------------------------------------------------
 * Signed in, the wishlist lives in the database: this hook reads it once, changes it through
 * the API, and hands back the slugs the screens already work with. A guest (or an unreachable
 * API) keeps using the device-local store, so the heart always works.
 *
 * The device's list is offered to the account once per sign-in. The merge is idempotent in the
 * database, so a repeated call adds nothing; the local copy is cleared only after the account
 * has accepted it.
 */

export interface RemoteWishlist {
  /** Every saved product as the API describes it (null `product` = no longer on sale). */
  items: readonly WishlistItem[];
  slugs: readonly string[];
  /** True while the account's list is arriving for the first time. */
  loading: boolean;
  /** The account's list could not be read (network or server). */
  failed: boolean;
  /** Saves or unsaves; returns whether it is now saved. */
  toggle: (target: { id: string; slug: string }) => Promise<boolean>;
  /** True while a change for this product is on its way. */
  busy: (productId: string) => boolean;
}

export function useRemoteWishlist(deviceSlugs: readonly string[]): RemoteWishlist | null {
  const userId = useSignedInUserId();
  const api = useApi();
  const run = useAuthorizedApi();
  const client = useQueryClient();
  const key = useMemo(() => queryKeys.wishlist(userId ?? 'guest'), [userId]);
  const [pending, setPending] = useState<readonly string[]>([]);
  const merged = useRef(false);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (api === null) throw new ApiNotConfiguredError();
      return run((client, accessToken) => client.myWishlist(accessToken));
    },
    enabled: userId !== null && api !== null,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  /** Offers the device's saved products to the account, once, then forgets them. */
  useEffect(() => {
    if (userId === null || merged.current) return;
    if (query.status !== 'success' || deviceSlugs.length === 0) return;
    merged.current = true;
    void run((client, accessToken) => client.mergeWishlist(accessToken, deviceSlugs))
      .then((answer) => client.setQueryData(key, answer))
      .catch(() => {
        // Keep the device list: it is offered again on the next sign-in.
        merged.current = false;
      });
  }, [client, deviceSlugs, key, query.status, run, userId]);

  const mutation = useMutation({
    mutationFn: async (input: { id: string; slug: string; remove: boolean }) => {
      return run((client, accessToken) =>
        input.remove
          ? client.removeFromWishlist(accessToken, input.id)
          : client.addToWishlist(accessToken, input.id),
      );
    },
    onSuccess: (answer) => {
      client.setQueryData(key, answer);
    },
  });

  const toggle = useCallback(
    async (target: { id: string; slug: string }): Promise<boolean> => {
      const saved = items.some((item) => item.productId === target.id);
      setPending((current) => [...current, target.id]);
      try {
        await mutation.mutateAsync({ ...target, remove: saved });
        return !saved;
      } catch {
        // The screen keeps the previous state; nothing optimistic was applied.
        return saved;
      } finally {
        setPending((current) => current.filter((id) => id !== target.id));
      }
    },
    [items, mutation],
  );

  if (userId === null || api === null) return null;

  return {
    items,
    slugs: items.map((item) => item.product?.slug ?? ''),
    loading: query.status === 'pending',
    failed: query.status === 'error',
    toggle,
    busy: (productId) => pending.includes(productId),
  };
}
