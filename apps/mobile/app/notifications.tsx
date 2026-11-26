import type { CustomerNotification, CustomerNotificationKind } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import {
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  Banknote,
  Package,
  RotateCcw,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SignedInGate } from '@/auth/signed-in-gate';
import { EmptyState } from '@/components/empty-state';
import { ListScreen } from '@/components/list-screen';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { STACK_EDGES } from '@/components/screen';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
  useUnreadNotificationCount,
} from '@/features/notifications/notification-hooks';
import { SwipeToDelete } from '@/features/notifications/swipe-to-delete';
import { UndoBar } from '@/features/notifications/undo-bar';
import { useNotificationDeletion } from '@/features/notifications/use-notification-deletion';
import { notificationTarget } from '@/notifications/notification-links';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';

const TABS: readonly { id: CustomerNotificationKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'order_update', label: 'Orders' },
  { id: 'shipment_update', label: 'Shipping' },
  { id: 'payment_update', label: 'Payments' },
  { id: 'return_update', label: 'Returns' },
  { id: 'refund_update', label: 'Refunds' },
];

const KIND_ICON: Record<CustomerNotificationKind, LucideIcon> = {
  order_update: Package,
  payment_update: Wallet,
  return_update: RotateCcw,
  refund_update: Banknote,
  shipment_update: Truck,
};

const KIND_LABEL: Record<CustomerNotificationKind, string> = {
  order_update: 'Order',
  payment_update: 'Payment',
  return_update: 'Return',
  refund_update: 'Refund',
  shipment_update: 'Shipping',
};

/** A timestamp a person reads at a glance: time today, the date before that. */
function shownAt(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Notifications: this account's own history, the same rows the website shows. */
export default function NotificationsScreen() {
  return (
    <SignedInGate purpose="see your notifications" returnTo="/notifications" edges={STACK_EDGES}>
      <Notifications />
    </SignedInGate>
  );
}

function Notifications() {
  const router = useRouter();
  const [tab, setTab] = useState<CustomerNotificationKind | 'all'>('all');
  const kind = tab === 'all' ? null : tab;
  const query = useMyNotifications(kind);
  const unread = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const { onRefresh } = useManualRefresh(query.refetch);
  const deletion = useNotificationDeletion();

  const rows = useMemo(() => {
    // Pages are appended in order; the server's ordering is total, but a row that an
    // invalidation has already moved into an earlier page would otherwise show twice.
    const seen = new Set<string>();
    const list: CustomerNotification[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const row of page.notifications) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        if (deletion.isHidden(row)) continue;
        list.push(row);
      }
    }
    return list;
  }, [query.data, deletion]);

  const view = queryViewState(query, (data) => data.pages.length === 0);
  const unreadCount = unread.data ?? 0;

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
  } else if (rows.length === 0) {
    empty = (
      <EmptyState
        icon={BellOff}
        title={kind === null ? 'Nothing here yet' : `No ${KIND_LABEL[kind].toLowerCase()} updates`}
        description={
          kind === null
            ? 'Updates about your orders, deliveries, payments, returns and refunds will appear here.'
            : 'Try another category, or check back after your next order.'
        }
        action={{ label: 'View your orders', onPress: () => router.push('/orders') }}
      />
    );
  }

  const confirmClearAll = () => {
    Alert.alert(
      'Clear all notifications?',
      'This removes every notification from this list. Your orders and payments are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => deletion.clearAll(rows.length) },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ListScreen<CustomerNotification>
        testID="notifications"
        edges={STACK_EDGES}
        title="Notifications"
        listHeader={
          <View style={styles.header}>
            <Text style={styles.subtitle}>
              {unreadCount > 0
                ? `${unreadCount} unread · order, shipping, payment, return and refund updates`
                : 'Order, shipping, payment, return and refund updates for your account'}
            </Text>
            {unreadCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications read"
                disabled={markAll.isPending}
                onPress={() => markAll.mutate()}
                style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
              >
                {markAll.isPending ? (
                  <ActivityIndicator color={theme.colors.link} size="small" />
                ) : (
                  <>
                    <CheckCheck color={theme.colors.link} size={16} />
                    <Text style={styles.markAllText}>Mark all read</Text>
                  </>
                )}
              </Pressable>
            ) : null}
            {rows.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all notifications"
                onPress={confirmClearAll}
                style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
              >
                <Trash2 color={theme.colors.link} size={16} />
                <Text style={styles.markAllText}>Clear all</Text>
              </Pressable>
            ) : null}

            {/* Six categories do not fit a phone's width: the rail scrolls sideways. */}
            <ScrollView
              horizontal
              accessibilityRole="tablist"
              showsHorizontalScrollIndicator={false}
              style={styles.tabRail}
              contentContainerStyle={styles.tabs}
            >
              {TABS.map((item) => {
                const selected = tab === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setTab(item.id)}
                    style={[styles.tab, selected && styles.tabSelected]}
                  >
                    <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        data={view === 'ready' ? rows : []}
        keyExtractor={(row) => row.id}
        onRefresh={onRefresh}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListFooterComponent={
          query.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              {query.isFetchingNextPage ? (
                <ActivityIndicator color={theme.colors.link} size="small" />
              ) : (
                <Text style={styles.moreText}>Load older</Text>
              )}
            </Pressable>
          ) : undefined
        }
        renderItem={({ item }) => (
          <SwipeToDelete enabled onDelete={() => deletion.remove(item.id)}>
            <NotificationCard
              notification={item}
              pending={markRead.isPending && markRead.variables === item.id}
              onDelete={() => deletion.remove(item.id)}
              onOpen={() => {
                if (item.readAt === null) markRead.mutate(item.id);
                // The row's link is a website path; the app opens its own screen for it.
                const target = notificationTarget(item.actionPath);
                if (target !== null) router.push(target);
              }}
            />
          </SwipeToDelete>
        )}
      />
      {deletion.pending !== null ? (
        <UndoBar
          message={
            deletion.pending.kind === 'all' ? 'All notifications cleared' : 'Notification deleted'
          }
          actionLabel="Undo"
          onAction={deletion.undo}
        />
      ) : deletion.failure !== null ? (
        <UndoBar
          tone="error"
          message={deletion.failure}
          actionLabel="OK"
          onAction={deletion.dismissFailure}
        />
      ) : null}
    </View>
  );
}

function NotificationCard({
  notification,
  pending,
  onOpen,
  onDelete,
}: {
  notification: CustomerNotification;
  pending: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICON[notification.kind];
  const unread = notification.readAt === null;
  return (
    <View style={[styles.card, unread && styles.cardUnread]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${KIND_LABEL[notification.kind]}: ${notification.title}${
          unread ? ', unread' : ''
        }`}
        onPress={onOpen}
        style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
      >
        <View style={[styles.icon, unread ? styles.iconUnread : styles.iconRead]}>
          <Icon color={unread ? theme.colors.link : theme.colors.mutedForeground} size={18} />
        </View>
        <View style={styles.body}>
          <View style={styles.kindRow}>
            <Text style={styles.kind}>{KIND_LABEL[notification.kind]}</Text>
            {unread ? <View style={styles.dot} /> : null}
            <Text style={styles.when}>{shownAt(notification.createdAt)}</Text>
          </View>
          <Text style={[styles.title, unread && styles.titleUnread]}>{notification.title}</Text>
          {notification.body === null ? null : (
            <Text style={styles.description}>{notification.body}</Text>
          )}
        </View>
        {pending ? (
          <ActivityIndicator color={theme.colors.link} size="small" />
        ) : (
          <Check size={0} />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete notification: ${notification.title}`}
        onPress={onDelete}
        hitSlop={4}
        style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
      >
        <Trash2 size={18} color={theme.colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[3] },
  deleteButton: {
    width: 44,
    height: 44,
    marginTop: -theme.spacing[2],
    marginRight: -theme.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  header: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  subtitle: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  markAll: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  markAllText: { color: theme.colors.link, fontSize: 13, fontWeight: '600' },
  tabRail: { flexGrow: 0, borderRadius: 999, backgroundColor: theme.colors.surfaceMuted },
  tabs: { flexDirection: 'row', gap: 4, padding: 4 },
  tab: {
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  tabSelected: { backgroundColor: theme.colors.surface, ...theme.shadow.card },
  tabText: { color: theme.colors.mutedForeground, fontSize: 13, fontWeight: '600' },
  tabTextSelected: { color: theme.colors.foreground },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cardUnread: { borderColor: theme.colors.infoSurface, backgroundColor: theme.colors.infoSurface },
  pressed: { opacity: 0.85 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconUnread: { backgroundColor: theme.colors.surface },
  iconRead: { backgroundColor: theme.colors.surfaceMuted },
  body: { flex: 1, gap: 2 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kind: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.link },
  when: { marginLeft: 'auto', color: theme.colors.mutedForeground, fontSize: 11 },
  title: { color: theme.colors.foreground, fontSize: 15, lineHeight: 20 },
  titleUnread: { fontWeight: '600' },
  description: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  gap: { height: theme.spacing[3] },
  more: {
    marginTop: theme.spacing[4],
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  moreText: { color: theme.colors.link, fontSize: 14, fontWeight: '600' },
});
