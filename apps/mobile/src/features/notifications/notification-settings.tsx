import type { NotificationPreferences, NotificationPreferencesPatch } from '@nilzora/contracts';
import { SlidersHorizontal } from 'lucide-react-native';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '@/features/notifications/preference-hooks';
import { theme } from '@/theme';

/*
 * The account half of the notification settings.
 *
 * These choices live on the server, so they apply on every device and are enforced where a
 * notification is written - "in-app" decides whether the record is kept at all, the rest
 * decide whether that kind of news is worth telling you about. The device switches above the
 * card are a separate concern (a phone can stop showing notifications without changing what
 * the account keeps), which is why they are not mixed in here.
 */

const CATEGORIES: readonly {
  key: keyof Omit<NotificationPreferences, 'updatedAt'>;
  label: string;
  hint: string;
}[] = [
  { key: 'orderUpdates', label: 'Order updates', hint: 'Confirmed, shipped, delivered, cancelled' },
  { key: 'paymentUpdates', label: 'Payments', hint: 'Cash recorded as collected' },
  { key: 'returnUpdates', label: 'Returns', hint: 'A return request received or decided' },
  { key: 'refundUpdates', label: 'Refunds', hint: 'A refund approved, paid or declined' },
  { key: 'promotions', label: 'Offers and new products', hint: 'Campaigns and product launches' },
  {
    key: 'inApp',
    label: 'Keep a record in the app',
    hint: 'Your notifications page stops growing when off',
  },
];

export function NotificationSettings() {
  const preferences = useNotificationPreferences();
  const save = useSaveNotificationPreferences();

  const current = preferences.data;
  // A switch is disabled only while the account's choices are unknown; once they are on
  // screen a press changes them at once and the save follows.
  const ready = current !== undefined;

  const change = (key: keyof Omit<NotificationPreferences, 'updatedAt'>, value: boolean) => {
    const patch: NotificationPreferencesPatch = { [key]: value };
    save.mutate(patch);
  };

  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <SlidersHorizontal size={20} color={theme.colors.primary} accessible={false} />
          <Text accessibilityRole="header" style={styles.title}>
            What you are told
          </Text>
        </View>
        <Text style={styles.description}>
          These apply to your account on every device, and decide what is kept here too.
        </Text>

        {preferences.isPending ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading notification choices"
            style={styles.checking}
          >
            <ActivityIndicator color={theme.colors.link} />
          </View>
        ) : preferences.isError || current === undefined ? (
          <>
            <Notice tone="danger">Your choices could not be loaded.</Notice>
            <Pressable
              accessibilityRole="button"
              onPress={() => void preferences.refetch()}
              style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.linkText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.rows}>
            {CATEGORIES.map((entry) => (
              <View key={entry.key} style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchLabel}>{entry.label}</Text>
                  <Text style={styles.switchHint}>{entry.hint}</Text>
                </View>
                <Switch
                  accessibilityLabel={entry.label}
                  value={current[entry.key]}
                  disabled={!ready}
                  onValueChange={(next) => change(entry.key, next)}
                  trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primary }}
                  thumbColor={current[entry.key] ? '#FFFFFF' : theme.colors.borderStrong}
                  ios_backgroundColor={theme.colors.surfaceMuted}
                />
              </View>
            ))}
          </View>
        )}

        {save.isError ? (
          <Notice tone="danger">That change could not be saved. Try again.</Notice>
        ) : null}
        {save.isPending ? (
          <Text style={styles.saving} accessibilityRole="progressbar">
            Saving…
          </Text>
        ) : null}
      </Card>

      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openSettings()}
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.linkText}>Open notification settings on this phone</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing[4] },
  card: { padding: theme.spacing[5], gap: theme.spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  title: { color: theme.colors.foreground, fontSize: 17, fontWeight: theme.fontWeights.semibold },
  description: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  rows: { gap: theme.spacing[1] },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingVertical: theme.spacing[2],
  },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { color: theme.colors.foreground, fontSize: 15, fontWeight: '600' },
  switchHint: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  checking: { minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  link: { minHeight: theme.touchTarget, justifyContent: 'center' },
  linkText: { color: theme.colors.link, fontSize: 15, fontWeight: '600' },
  saving: { color: theme.colors.mutedForeground, fontSize: 12 },
});
