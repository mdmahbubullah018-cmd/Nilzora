import { Bell, BellOff, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSignedInUserId } from '@/auth/session-context';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { useAuthorizedApi } from '@/query';
import { theme } from '@/theme';
import {
  readAnnouncementsChoice,
  subscribeAnnouncements,
  writeAnnouncementsChoice,
} from './announcements-preference';
import { getDeviceToken, getPermission, pushPlatform, requestPermission } from './push-service';
import { readRegisteredToken, writeRegisteredToken } from './registered-token';

/*
 * "New product announcements" — the promotional half of the notification settings, kept
 * visibly apart from "Order updates" above it: turning this off never affects an order
 * notification, and turning order updates off never stops an announcement.
 *
 * Nothing is asked until the customer taps the button: the system permission prompt appears
 * only then, and a refusal is respected (the card then points at the phone's own settings
 * instead of asking again).
 */

const MESSAGES = {
  denied:
    'Notifications are turned off for Nilzora. Turn them on in your phone settings to hear about new products.',
  unavailable: 'Notifications are not available in this build.',
  enableFailed: 'Product announcements could not be turned on.',
  disableFailed: 'Product announcements could not be turned off.',
  permissionRefused: 'Notifications were not allowed, so announcements cannot be sent.',
} as const;

type Phase = 'checking' | 'unsupported' | 'denied' | 'ready';

export function ProductAnnouncementsCard() {
  const userId = useSignedInUserId();
  const run = useAuthorizedApi();
  const [phase, setPhase] = useState<Phase>('checking');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readPermission = useCallback(async () => {
    try {
      const permission = await getPermission();
      setPhase(permission.state === 'denied' ? 'denied' : 'ready');
    } catch {
      // No push support in this build (or no permission API): say so plainly.
      setPhase('unsupported');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Deferred by one microtask so the first render is not written to during its own effect.
    queueMicrotask(() => {
      if (!cancelled) void readPermission();
    });
    if (userId !== null) {
      void readAnnouncementsChoice(userId).then((choice) => {
        if (!cancelled) setEnabled(choice);
      });
    }
    const stop = subscribeAnnouncements(() => {
      if (userId === null) return;
      void readAnnouncementsChoice(userId).then((choice) => {
        if (!cancelled) setEnabled(choice);
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [readPermission, userId]);

  async function enable() {
    if (userId === null) return;
    setBusy(true);
    setError(null);
    try {
      const current = await getPermission();
      const permission = current.state === 'undetermined' ? await requestPermission() : current;
      if (permission.state !== 'granted') {
        setPhase(permission.state === 'denied' ? 'denied' : 'ready');
        setError(MESSAGES.permissionRefused);
        return;
      }
      const token = await getDeviceToken();
      // The token has to belong to the server before the preference means anything.
      const platform = pushPlatform();
      if (platform === null) throw new Error('unsupported');
      await run((api, accessToken) => api.registerDevice(accessToken, { token, platform }));
      await run((api, accessToken) =>
        api.setDeviceAnnouncements(accessToken, { token, enabled: true }),
      );
      await writeRegisteredToken({ token, userId });
      await writeAnnouncementsChoice(userId, true);
      setPhase('ready');
    } catch {
      setError(MESSAGES.enableFailed);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (userId === null) return;
    setBusy(true);
    setError(null);
    try {
      const remembered = await readRegisteredToken();
      if (remembered !== null && remembered.userId === userId) {
        await run((api, accessToken) =>
          api.setDeviceAnnouncements(accessToken, { token: remembered.token, enabled: false }),
        );
      }
      await writeAnnouncementsChoice(userId, false);
    } catch {
      setError(MESSAGES.disableFailed);
    } finally {
      setBusy(false);
    }
  }

  let description: string;
  let action: ReactNode;

  if (phase === 'checking') {
    description = 'Checking notification settings.';
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
  } else if (phase === 'unsupported') {
    description = MESSAGES.unavailable;
    action = null;
  } else if (phase === 'denied') {
    description = MESSAGES.denied;
    action = null;
  } else if (enabled) {
    description = 'You are told when a new product is published. Order updates are separate.';
    action = (
      <Button
        label="Turn off product announcements"
        variant="secondary"
        loading={busy}
        onPress={() => void disable()}
      />
    );
  } else {
    description =
      'Hear about new products as soon as they are published. This is optional and never affects your orders.';
    action = (
      <Button label="Turn on product announcements" loading={busy} onPress={() => void enable()} />
    );
  }

  const Icon = phase === 'denied' || phase === 'unsupported' ? BellOff : enabled ? Sparkles : Bell;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Icon size={20} color={theme.colors.primary} accessible={false} />
        <Text accessibilityRole="header" style={styles.title}>
          New product announcements
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
    flexShrink: 1,
  },
  description: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  checking: { minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
