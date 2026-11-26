import type { OrderSummary } from '@nilzora/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Package } from 'lucide-react-native';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSignedInUserId } from '@/auth/session-context';
import { Button } from '@/components/button';
import { ListScreen } from '@/components/list-screen';
import { Notice } from '@/components/notice';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { ListSkeleton } from '@/components/skeleton';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { describeApiError } from '@/lib/errors';
import { queryKeys, useAuthorizedApi, useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { OrderRow } from './order-row';

/** Orders fetched per page (the storefront's page size). */
export const ORDERS_PAGE_SIZE = 10;

const FEED_QUERY = { pageSize: ORDERS_PAGE_SIZE } as const;

/** The signed-in customer's orders, newest first, loaded a page at a time. */
function useOrdersFeed() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.orders.feed(userId, FEED_QUERY),
    queryFn: ({ pageParam, signal }) =>
      run((api, accessToken) =>
        api.listOrders(accessToken, { page: pageParam, pageSize: ORDERS_PAGE_SIZE }, { signal }),
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: userId !== null,
  });
}

/**
 * The account's pages, flattened. Paging is by offset, so an order placed while the list
 * is open can shift the next page by one row: an order seen twice is shown once.
 */
function flattenOrders(pages: readonly { orders: OrderSummary[] }[] | undefined): OrderSummary[] {
  const seen = new Set<string>();
  const orders: OrderSummary[] = [];
  for (const page of pages ?? []) {
    for (const order of page.orders) {
      if (seen.has(order.orderNumber)) continue;
      seen.add(order.orderNumber);
      orders.push(order);
    }
  }
  return orders;
}

const keyOf = (order: OrderSummary) => order.orderNumber;

export interface OrdersListProps {
  /** Header content above the title (a tab header, for example). */
  header?: ReactNode;
  /** Space kept clear under the list. Defaults to the floating tab bar's height. */
  bottomSpace?: number;
}

/**
 * The order history (render it inside <SignedInGate>): the endless list with
 * pull-to-refresh, loading, empty and error states. Each row opens /order/<orderNumber>.
 * The API does not filter orders by status, so there are no filter chips.
 */
export function OrdersList({ header, bottomSpace = TAB_BAR_SPACE }: OrdersListProps) {
  const router = useRouter();
  const query = useOrdersFeed();
  const { onRefresh } = useManualRefresh(query.refetch);
  const orders = useMemo(() => flattenOrders(query.data?.pages), [query.data]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = query;
  const loadMore = useCallback(() => {
    // After a failed page the customer retries by hand; scrolling must not loop on the error.
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);

  const openOrder = useCallback(
    (orderNumber: string) => {
      router.push({ pathname: '/order/[orderNumber]', params: { orderNumber } });
    },
    [router],
  );

  const view = queryViewState(
    { status: query.status, data: query.data === undefined ? undefined : orders },
    (rows) => rows.length === 0,
  );

  let emptyView: ReactElement | undefined;
  if (view === 'loading') {
    emptyView = (
      <QueryStateView
        state="loading"
        skeleton={<ListSkeleton label="Loading your orders" rows={3} />}
      />
    );
  } else if (view === 'error') {
    emptyView = (
      <QueryStateView
        state="error"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  } else if (view === 'empty') {
    emptyView = (
      <QueryStateView
        state="empty"
        empty={{
          icon: Package,
          title: 'No orders yet',
          description: 'When you place an order, you can follow it here.',
          action: <Button label="Start shopping" onPress={() => router.push('/shop')} />,
        }}
      />
    );
  }

  // A refresh that failed while orders are on screen keeps them and says so.
  const staleError =
    query.isError && !isFetchNextPageError && query.data !== undefined
      ? describeApiError(query.error)
      : null;
  const listHeader = staleError ? (
    <View style={styles.notice}>
      <Notice tone="warning" title="Could not refresh">
        Showing what was loaded earlier. {staleError.message}
      </Notice>
      {staleError.retryable ? (
        <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
      ) : null}
    </View>
  ) : null;

  let footer: ReactElement | undefined;
  if (isFetchingNextPage) {
    footer = (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading more orders"
        style={styles.footer}
      >
        <ActivityIndicator color={theme.colors.link} />
      </View>
    );
  } else if (isFetchNextPageError) {
    footer = (
      <View style={styles.notice}>
        <Notice tone="warning" title="Could not load more orders">
          {describeApiError(query.error).message}
        </Notice>
        <Button label="Try again" variant="secondary" onPress={() => void fetchNextPage()} />
      </View>
    );
  }

  return (
    <ListScreen<OrderSummary>
      testID="orders-list"
      header={header}
      bottomSpace={bottomSpace}
      data={orders}
      keyExtractor={keyOf}
      renderItem={({ item }) => <OrderRow order={item} onPress={openOrder} />}
      listHeader={listHeader}
      ListEmptyComponent={emptyView}
      ListFooterComponent={footer}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      onRefresh={onRefresh}
    />
  );
}

const styles = StyleSheet.create({
  notice: { gap: theme.spacing[3] },
  footer: { minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
