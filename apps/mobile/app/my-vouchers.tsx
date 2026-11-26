import type { Voucher } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SignedInGate } from '@/auth/signed-in-gate';
import { EmptyState } from '@/components/empty-state';
import { ListScreen } from '@/components/list-screen';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { STACK_EDGES } from '@/components/screen';
import { VoucherAction } from '@/features/vouchers/voucher-actions';
import { VoucherTicket } from '@/features/vouchers/voucher-card';
import { useMyVouchers } from '@/features/vouchers/voucher-hooks';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';

const TABS = [
  { id: 'available', label: 'Available' },
  { id: 'used', label: 'Used' },
  { id: 'expired', label: 'Expired' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function tabOf(voucher: Voucher): TabId {
  if (voucher.state === 'used') return 'used';
  if (voucher.state === 'expired') return 'expired';
  return 'available';
}

/** My Vouchers: what this account collected, the same list the website shows. */
export default function MyVouchersScreen() {
  return (
    <SignedInGate purpose="see your vouchers" returnTo="/my-vouchers" edges={STACK_EDGES}>
      <MyVouchers />
    </SignedInGate>
  );
}

function MyVouchers() {
  const router = useRouter();
  const query = useMyVouchers();
  const { onRefresh } = useManualRefresh(query.refetch);
  const [tab, setTab] = useState<TabId>('available');
  const view = queryViewState(query, (list) => list.length === 0);
  const list = useMemo(() => query.data ?? [], [query.data]);
  const shown = useMemo(() => list.filter((voucher) => tabOf(voucher) === tab), [list, tab]);

  let empty;
  if (view === 'loading') empty = <QueryStateView state="loading" />;
  else if (view === 'error') {
    empty = (
      <QueryStateView
        state="error"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  } else if (shown.length === 0) {
    empty = (
      <EmptyState
        icon={Ticket}
        title={
          tab === 'available'
            ? 'No vouchers ready to use'
            : tab === 'used'
              ? 'No used vouchers'
              : 'No expired vouchers'
        }
        description="Collect vouchers in the Voucher Center, then choose one at checkout."
        action={{ label: 'Open the Voucher Center', onPress: () => router.push('/vouchers') }}
      />
    );
  }

  return (
    <ListScreen<Voucher>
      testID="my-vouchers"
      edges={STACK_EDGES}
      listHeader={
        <View accessibilityRole="tablist" style={styles.tabs}>
          {TABS.map((item) => {
            const selected = tab === item.id;
            const count = list.filter((voucher) => tabOf(voucher) === item.id).length;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(item.id)}
                style={[styles.tab, selected && styles.tabSelected]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                  {item.label} {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      }
      data={view === 'ready' ? shown : []}
      keyExtractor={(voucher) => voucher.id}
      onRefresh={onRefresh}
      ListEmptyComponent={empty}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      renderItem={({ item }) => (
        <VoucherTicket
          voucher={item}
          action={<VoucherAction voucher={item} returnTo="/my-vouchers" />}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    marginBottom: theme.spacing[4],
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceMuted,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  tabSelected: { backgroundColor: theme.colors.surface, ...theme.shadow.card },
  tabText: { color: theme.colors.mutedForeground, fontSize: 14, fontWeight: '600' },
  tabTextSelected: { color: theme.colors.foreground },
  gap: { height: theme.spacing[3] },
});
