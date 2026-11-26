import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { formatBytes } from '@/uploads/progress';
import type { UploadState } from '@/uploads/use-upload';
import { theme } from '@/theme';

export interface UploadProgressProps {
  state: UploadState;
  /** Offered only after a failure that cannot have saved anything. */
  onRetry?: () => void;
  /** Offered only while bytes are still being sent. */
  onCancel?: () => void;
}

/**
 * What one upload is doing right now. The bar fills only with bytes the phone has really sent;
 * once they are all out, the bar is replaced by "checking and saving" until the server answers,
 * and "saved" appears only when it has. Nothing here is a timer or an estimate.
 */
export function UploadProgress({ state, onRetry, onCancel }: UploadProgressProps) {
  if (state.phase === 'idle') return null;

  if (state.phase === 'transferring') {
    const label =
      state.total > 0
        ? `Sending ${state.fileName}: ${String(state.percent)}%, ${formatBytes(state.sent)} of ${formatBytes(state.total)}`
        : `Starting to send ${state.fileName}`;
    return (
      <View style={styles.block}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 100, now: state.percent }}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${String(state.percent)}%` }]} />
        </View>
        <Text style={styles.caption} accessibilityLiveRegion="polite">
          {state.total > 0
            ? `${String(state.percent)}% · ${formatBytes(state.sent)} of ${formatBytes(state.total)}`
            : 'Starting…'}
        </Text>
        {onCancel ? <Button label="Cancel upload" variant="secondary" onPress={onCancel} /> : null}
      </View>
    );
  }

  if (state.phase === 'processing') {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Checking and saving your picture"
        accessibilityLiveRegion="polite"
        style={styles.processing}
      >
        <ActivityIndicator color={theme.colors.link} />
        <Text style={styles.caption}>Sent. Checking and saving your picture…</Text>
      </View>
    );
  }

  if (state.phase === 'success') {
    return <Notice tone="success">Picture saved.</Notice>;
  }

  if (state.phase === 'cancelled') {
    return <Notice tone="info">Upload cancelled. Nothing was saved.</Notice>;
  }

  return (
    <View style={styles.block}>
      <Notice tone="danger">{state.message}</Notice>
      {state.canRetry && onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing[2] },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  caption: { color: theme.colors.mutedForeground, ...theme.text.caption },
  processing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
});
