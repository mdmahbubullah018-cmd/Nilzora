import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme } from '@/theme';

/*
 * Loading placeholders. A <SkeletonGroup> is ONE accessible element ("Loading…", a progress
 * bar, busy) and hides its blocks from screen readers, so a list of grey boxes is not read
 * out box by box. The group owns a single pulse animation shared by its blocks (React
 * Native's own Animated, no extra dependency), which stops when it unmounts and is skipped
 * when the device asks to reduce motion.
 */

const PulseContext = createContext<Animated.Value | null>(null);

const PULSE_LOW = 0.45;
const PULSE_MS = 800;

export interface SkeletonGroupProps {
  /** What is loading, for screen readers. */
  label?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonGroup({ label = 'Loading', children, style }: SkeletonGroupProps) {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    void (async () => {
      let reduceMotion = false;
      try {
        reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        // Unknown: animate.
      }
      if (cancelled || reduceMotion) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: PULSE_LOW,
            duration: PULSE_MS,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        ]),
      );
      loop.start();
    })();
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <PulseContext.Provider value={opacity}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        importantForAccessibility="yes"
        style={style}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.blocks}
        >
          {children}
        </View>
      </View>
    </PulseContext.Provider>
  );
}

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A grey block standing in for text or an image. Pulses when inside a <SkeletonGroup>. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = theme.radii.sm,
  style,
  testID,
}: SkeletonProps) {
  const opacity = useContext(PulseContext);
  const block = [styles.block, { width, height, borderRadius: radius }, style];
  if (opacity === null) return <View testID={testID} style={block} />;
  return <Animated.View testID={testID} style={[block, { opacity }]} />;
}

/** A list row: picture on the left, two text lines and a price on the right. */
export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={72} height={72} radius={theme.radii.md} />
      <View style={styles.rowText}>
        <Skeleton width="80%" height={14} />
        <Skeleton width="50%" height={12} />
        <Skeleton width="30%" height={16} />
      </View>
    </View>
  );
}

/** The default placeholder for a screen that loads a list. */
export function ListSkeleton({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <SkeletonGroup label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <RowSkeleton key={index} />
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: theme.spacing[3] },
  block: {
    // Slate 200 with a touch more blue: one step deeper than the old `borderStrong`, which
    // vanished into the white cards and the pale page well. Still light enough to read as a
    // placeholder rather than as a disabled control, and the hairline keeps its edge on white.
    backgroundColor: '#D7E0EC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  rowText: { flex: 1, justifyContent: 'center', gap: theme.spacing[2] },
});
