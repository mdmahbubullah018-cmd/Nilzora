import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { theme } from '@/theme';
import { WAVEFORM_BARS } from './voice-waveforms';

/*
 * The bars of a voice message, with its playback position
 * --------------------------------------------------------
 * Each bar is the loudest moment of its slice of the recording (see voice-waveforms.ts). Bars
 * already played are drawn in the strong ink, the rest in the soft one, so the position reads at
 * a glance without a separate progress line. Tapping anywhere on the bars seeks there.
 *
 * Without recorded levels the bars are all the same low height: an honest "audio" mark, never a
 * shape that pretends to be the recording.
 */

const MIN_BAR = 3;
const MAX_BAR = 22;
const RESTING = 0.18;

export function VoiceWaveform({
  peaks,
  progress,
  disabled,
  onSeek,
  onLongPress,
  delayLongPress,
  label,
}: {
  peaks: readonly number[] | null;
  /** 0–1: how much has been played. */
  progress: number;
  disabled?: boolean;
  /** Called with the tapped position, 0–1. */
  onSeek: (fraction: number) => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  label: string;
}) {
  const [width, setWidth] = useState(0);
  const bars =
    peaks !== null && peaks.length > 0 ? peaks : Array<number>(WAVEFORM_BARS).fill(RESTING);
  const played = Math.round(Math.min(1, Math.max(0, progress)) * bars.length);

  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      accessibilityHint="Tap a point on the waveform to play from there"
      accessibilityActions={[
        { name: 'increment', label: 'Forward' },
        { name: 'decrement', label: 'Back' },
      ]}
      onAccessibilityAction={(event) => {
        const step = event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
        onSeek(Math.min(1, Math.max(0, progress + step)));
      }}
      disabled={disabled}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => {
        if (width <= 0) return;
        onSeek(Math.min(1, Math.max(0, event.nativeEvent.locationX / width)));
      }}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={styles.hit}
      testID="voice-waveform"
    >
      <View style={styles.bars} pointerEvents="none">
        {bars.map((peak, index) => (
          <View
            // The bars never reorder: their index is their identity.
            key={index}
            style={[
              styles.bar,
              { height: MIN_BAR + (MAX_BAR - MIN_BAR) * Math.min(1, Math.max(0, peak)) },
              index < played ? styles.barPlayed : null,
            ]}
          />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A full 44 dp touch row with the bars drawn inside it.
  hit: { flex: 1, minWidth: 96, minHeight: 44, justifyContent: 'center' },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: MAX_BAR,
  },
  bar: { width: 3, borderRadius: 1.5, backgroundColor: theme.colors.border },
  barPlayed: { backgroundColor: theme.colors.foreground },
});
