import { CircleAlert, CloudOff, WifiOff } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeApiError, isTransientError } from '@/lib/errors';
import { retryConnection } from '@/network/connectivity';
import { theme } from '@/theme';
import { Button } from './button';
import { Card } from './card';
import { EmptyState, type EmptyStateIcon } from './empty-state';
import { Notice } from './notice';
import { ListSkeleton } from './skeleton';

/*
 * Loading / error / empty / ready, in one place, so every data screen handles all four
 * the same way.
 *
 *   <QueryState query={ordersQuery} isEmpty={(d) => d.orders.length === 0} empty={{...}}>
 *     {(data) => <OrderList orders={data.orders} />}
 *   </QueryState>
 *
 * Inside a <ListScreen> (a FlatList), render the state in `ListEmptyComponent` with
 * <QueryStateView> and `queryViewState()` instead, and feed the rows to `data`.
 * A disabled query (for example while signed out) stays "loading": gate the screen first
 * (<SignedInGate>) or check the condition that disables it before rendering QueryState.
 */

export interface EmptyConfig {
  icon: EmptyStateIcon;
  title: string;
  description?: string;
  /** A button or link under the message, e.g. "Start shopping". */
  action?: ReactNode;
}

/** The part of a React Query result this component reads (UseQueryResult satisfies it). */
export interface QueryStateSource<T> {
  status: 'pending' | 'error' | 'success';
  data: T | undefined;
  error: unknown;
  refetch: () => unknown;
  /** True while a retry started from the error view is running. */
  isRefetching?: boolean;
  /** `paused` with nothing cached means the app is offline and the request is waiting. */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
}

export type QueryViewState = 'loading' | 'offline' | 'error' | 'empty' | 'ready';

/** Which of the four views a query is in. Data that failed to refresh is still "ready". */
export function queryViewState<T>(
  query: Pick<QueryStateSource<T>, 'status' | 'data' | 'fetchStatus'>,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): QueryViewState {
  if (query.data !== undefined) return isEmpty(query.data) ? 'empty' : 'ready';
  if (query.status === 'error') return 'error';
  // Offline with nothing saved: say so, instead of a skeleton that never finishes.
  if (query.fetchStatus === 'paused') return 'offline';
  return 'loading';
}

function defaultIsEmpty(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

export type QueryStateViewProps =
  | { state: 'loading'; skeleton?: ReactNode; loadingLabel?: string }
  | { state: 'offline'; onRetry?: () => void }
  | { state: 'error'; error: unknown; onRetry?: () => void; retrying?: boolean }
  | { state: 'empty'; empty: EmptyConfig }
  | { state: 'ready'; children: ReactNode };

/** One of the four views, chosen explicitly. <QueryState> picks it from a query result. */
export function QueryStateView(props: QueryStateViewProps) {
  switch (props.state) {
    case 'loading':
      return <>{props.skeleton ?? <ListSkeleton label={props.loadingLabel} />}</>;
    case 'offline':
      return <OfflineView onRetry={props.onRetry} />;
    case 'error':
      return <ErrorView error={props.error} onRetry={props.onRetry} retrying={props.retrying} />;
    case 'empty':
      return (
        <Card>
          <EmptyState
            icon={props.empty.icon}
            title={props.empty.title}
            description={props.empty.description}
          />
          {props.empty.action ? <View style={styles.action}>{props.empty.action}</View> : null}
        </Card>
      );
    case 'ready':
      return <>{props.children}</>;
  }
}

/** Nothing saved for this screen and no connection: a calm message with a way to look again. */
function OfflineView({ onRetry }: { onRetry?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <View accessibilityLiveRegion="polite">
        <EmptyState
          icon={WifiOff}
          title="You are offline"
          description="This screen has nothing saved on your phone yet. It will load when you are back online."
        />
      </View>
      <View style={styles.action}>
        <Button
          label="Try again"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void retryConnection().finally(() => {
              setBusy(false);
              onRetry?.();
            });
          }}
        />
      </View>
    </Card>
  );
}

function ErrorView({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { title, message, retryable } = describeApiError(error);
  return (
    <Card>
      <View accessibilityLiveRegion="polite">
        <EmptyState
          icon={isTransientError(error) ? CloudOff : CircleAlert}
          title={title}
          description={message}
        />
      </View>
      {retryable && onRetry ? (
        <View style={styles.action}>
          <Button label="Try again" loading={retrying} onPress={onRetry} />
        </View>
      ) : null}
    </Card>
  );
}

export interface QueryStateProps<T> {
  query: QueryStateSource<T>;
  /** Renders the loaded data. */
  children: (data: T) => ReactNode;
  /** Whether loaded data counts as empty. Default: an empty array. */
  isEmpty?: (data: T) => boolean;
  /** Shown instead of `children` when the data is empty. Without it, empty data is rendered as ready. */
  empty?: EmptyConfig;
  /** Replaces the default list placeholder while loading. */
  skeleton?: ReactNode;
  /** Spoken name of the default placeholder, e.g. "Loading your orders". */
  loadingLabel?: string;
}

/**
 * Renders a query: skeleton while loading, an error with "Try again" when it failed (fixed,
 * customer-friendly wording; see describeApiError), the empty state, or the data. If a
 * refresh fails while data is already on screen, the data stays and a warning with a retry
 * appears above it instead of replacing the screen.
 */
export function QueryState<T>({
  query,
  children,
  isEmpty,
  empty,
  skeleton,
  loadingLabel,
}: QueryStateProps<T>) {
  const retry = () => void query.refetch();
  const view = queryViewState(query, isEmpty);

  if (view === 'loading') {
    return <QueryStateView state="loading" skeleton={skeleton} loadingLabel={loadingLabel} />;
  }
  if (view === 'offline') return <QueryStateView state="offline" onRetry={retry} />;
  if (view === 'error') {
    return (
      <QueryStateView
        state="error"
        error={query.error}
        onRetry={retry}
        retrying={query.isRefetching}
      />
    );
  }
  const data = query.data as T;
  if (view === 'empty' && empty) return <QueryStateView state="empty" empty={empty} />;

  return (
    <View style={styles.ready}>
      {query.status === 'error' ? (
        <View style={styles.stale}>
          <Notice tone="warning" title="Could not refresh">
            Showing what was loaded earlier. {describeApiError(query.error).message}
          </Notice>
          {describeApiError(query.error).retryable ? (
            <Button label="Try again" variant="secondary" onPress={retry} />
          ) : null}
        </View>
      ) : null}
      {children(data)}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
  ready: { gap: theme.spacing[4] },
  stale: { gap: theme.spacing[3] },
});
