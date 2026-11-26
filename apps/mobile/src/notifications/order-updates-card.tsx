import { Bell, BellOff, BellRing } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { theme } from '@/theme';
import { PUSH_MESSAGES, usePushRegistration } from './push-registration';

/**
 * The "Order updates" card of the Account tab. Notifications are opt-in: nothing is asked
 * until the customer taps "Turn on order updates". The card is honest about builds where
 * notifications cannot work and about a system-level "off" that only the phone's settings
 * can change.
 */
export function OrderUpdatesCard() {
  const push = usePushRegistration();
  const { status, busy, error } = push;

  let icon = Bell;
  let description = 'Get a notification when your order is confirmed, on its way or delivered.';
  let action = null;

  if (status === 'checking') {
    action = (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Checking notification settings"
        style={styles.checking}
      >
        <ActivityIndicator color={theme.colors.link} />
      </View>
    );
  } else if (status === 'unsupported') {
    icon = BellOff;
    description = PUSH_MESSAGES.unavailable;
  } else if (status === 'denied') {
    icon = BellOff;
    description = PUSH_MESSAGES.denied;
    action = <Button label="Open phone settings" variant="secondary" onPress={push.openSettings} />;
  } else if (status === 'on') {
    icon = BellRing;
    description = 'Order updates are on for this device.';
    action = (
      <Button
        label="Turn off order updates"
        variant="secondary"
        loading={busy}
        onPress={() => void push.disable()}
      />
    );
  } else {
    action = (
      <Button label="Turn on order updates" loading={busy} onPress={() => void push.enable()} />
    );
  }

  const Icon = icon;
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Icon size={20} color={theme.colors.primary} accessible={false} />
        <Text accessibilityRole="header" style={styles.title}>
          Order updates
        </Text>
      </View>
      <Text style={styles.description}>{description}</Text>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {action}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[5], gap: theme.spacing[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  title: {
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  description: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  checking: { minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
