import type { Voucher } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { BadgePercent, Ticket } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSignedInUserId } from '@/auth/session-context';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { ListScreen } from '@/components/list-screen';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { STACK_EDGES } from '@/components/screen';
import { VoucherAction } from '@/features/vouchers/voucher-actions';
import { VoucherTicket } from '@/features/vouchers/voucher-card';
import { useVoucherCenter } from '@/features/vouchers/voucher-hooks';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'storewide', label: 'Storewide' },
  { id: 'categories', label: 'Categories' },
  { id: 'products', label: 'Products' },
  { id: 'collected', label: 'Collected' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function applies(voucher: Voucher, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'collected') return voucher.state === 'collected';
  return voucher.scope === filter;
}

/**
 * The Voucher Center: the store's vouchers with Collect and Use. The same list as the
 * website, read from the same API; a voucher collected here shows there and vice versa.
 */
export default function VoucherCenterScreen() {
  const router = useRouter();
  const userId = useSignedInUserId();
  const query = useVoucherCenter();
  const { onRefresh } = useManualRefresh(query.refetch);
  const [filter, setFilter] = useState<FilterId>('all');
  const view = queryViewState(query, (list) => list.length === 0);
  const shown = useMemo(
    () => (query.data ?? []).filter((v) => applies(v, filter)),
    [query.data, filter],
  );
  const ready = (query.data ?? []).filter((v) => v.state === 'available').length;

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
        title={filter === 'collected' ? 'Nothing collected here yet' : 'No vouchers right now'}
        description="New vouchers appear here when the store launches them."
        action={
          filter === 'all'
            ? { label: 'Browse products', onPress: () => router.navigate('/shop') }
            : { label: 'Show all vouchers', onPress: () => setFilter('all') }
        }
      />
    );
  }

  return (
    <ListScreen<Voucher>
      testID="voucher-center"
      edges={STACK_EDGES}
      listHeader={
        <View style={styles.header}>
          <View style={styles.hero}>
            <View style={styles.heroBadge}>
              <BadgePercent size={14} color={theme.colors.primary} />
              <Text style={styles.heroBadgeText}>VOUCHER CENTER</Text>
            </View>
            <Text style={styles.heroTitle}>Collect vouchers, save at checkout</Text>
            <Text style={styles.heroBody}>
              One voucher or one coupon code per order.
              {userId === null ? ' Sign in to collect.' : ''}
            </Text>
            <Text style={styles.heroCount}>{ready} ready to collect</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {FILTERS.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={filter === item.id}
                onPress={() => setFilter(item.id)}
              />
            ))}
          </ScrollView>
        </View>
      }
      data={view === 'ready' || view === 'empty' ? shown : []}
      keyExtractor={(voucher) => voucher.id}
      onRefresh={onRefresh}
      ListEmptyComponent={empty}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      renderItem={({ item }) => (
        <VoucherTicket
          voucher={item}
          action={<VoucherAction voucher={item} returnTo="/vouchers" />}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[4], marginBottom: theme.spacing[4] },
  hero: {
    gap: theme.spacing[2],
    padding: theme.spacing[5],
    borderRadius: theme.radii.hero,
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(2, 132, 199, 0.22)',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
  },
  heroBadgeText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  heroTitle: { color: theme.colors.foreground, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  heroBody: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  heroCount: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  filters: { gap: theme.spacing[2], paddingRight: theme.spacing[4] },
  gap: { height: theme.spacing[3] },
});
