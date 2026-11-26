import type { ReturnSummary } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { Undo2 } from 'lucide-react-native';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SignedInGate } from '@/auth/signed-in-gate';
import { Button } from '@/components/button';
import { ListScreen } from '@/components/list-screen';
import { Notice } from '@/components/notice';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { ListSkeleton } from '@/components/skeleton';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { describeApiError } from '@/lib/errors';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { useReturns } from './use-returns';

/** What each stage means to the customer, in words rather than a status word. */
const STATUS_LABELS: Record<string, string> = {
  requested: 'Waiting for Nilzora to review it',
  approved: 'Approved — send the items back',
  rejected: 'Not accepted',
  received: 'Nilzora has your items',
  completed: 'Done',
  cancelled: 'Cancelled',
};

export function returnStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function summaryLine(request: ReturnSummary): string {
  const items = request.itemCount === 1 ? '1 item' : `${request.itemCount} items`;
  return `${items} · asked ${new Date(request.requestedAt).toLocaleDateString()}`;
}

function ReturnRow({
  request,
  onPress,
}: {
  request: ReturnSummary;
  onPress: (id: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Return for order {request.orderNumber}</Text>
      <Text style={styles.status}>{returnStatusLabel(request.status)}</Text>
      <Text style={styles.meta}>{summaryLine(request)}</Text>
      <Text style={styles.reason} numberOfLines={2}>
        {request.reason}
      </Text>
      <Button
        label="Open this return"
        variant="secondary"
        onPress={() => {
          onPress(request.id);
        }}
      />
    </View>
  );
}

function ReturnsBody() {
  const router = useRouter();
  const query = useReturns();
  const { onRefresh } = useManualRefresh(query.refetch);
  const requests = query.data?.returns ?? [];
  const open = useCallback(
    (returnId: string) => {
      router.push({ pathname: '/returns/[returnId]', params: { returnId } });
    },
    [router],
  );

  const view = queryViewState(
    { status: query.status, data: query.data === undefined ? undefined : requests },
    (rows) => rows.length === 0,
  );

  return (
    <ListScreen
      title="Your returns"
      data={requests}
      keyExtractor={(request) => request.id}
      renderItem={({ item }) => <ReturnRow request={item} onPress={open} />}
      onRefresh={onRefresh}
      bottomSpace={TAB_BAR_SPACE}
      listHeader={
        query.isError && query.data !== undefined ? (
          <Notice tone="warning" title="Could not refresh">
            {`Showing what was loaded earlier. ${describeApiError(query.error).message}`}
          </Notice>
        ) : null
      }
      ListEmptyComponent={
        view === 'loading' ? (
          <QueryStateView
            state="loading"
            skeleton={<ListSkeleton label="Loading your returns" rows={3} />}
          />
        ) : view === 'error' ? (
          <QueryStateView
            state="error"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isRefetching}
          />
        ) : (
          <QueryStateView
            state="empty"
            empty={{
              icon: Undo2,
              title: 'No returns yet',
              description: 'Open a delivered order to ask to send an item back.',
              action: <Button label="Go to your orders" onPress={() => router.push('/orders')} />,
            }}
          />
        )
      }
    />
  );
}

/** The Returns screen: the account's own requests, opened from the account tab. */
export function ReturnsScreen() {
  return (
    <SignedInGate title="Returns" purpose="see the items you are sending back" returnTo="/returns">
      <ReturnsBody />
    </SignedInGate>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
  },
  status: { color: theme.colors.foreground, fontSize: theme.text.body.fontSize },
  meta: { color: theme.colors.mutedForeground, fontSize: theme.text.body.fontSize },
  reason: {
    color: theme.colors.mutedForeground,
    fontSize: theme.text.body.fontSize,
    fontStyle: 'italic',
  },
});
