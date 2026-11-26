import { useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useReduceMotion } from './use-reduce-motion';

const PRESSED_SCALE = 0.97;
const IN_MS = 90;
const OUT_MS = 180;

export interface PressableScaleProps {
  children: ReactNode;
  onPress: () => void;
  /** Required: a control is named by what it does, not by what it looks like. */
  accessibilityLabel: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  disabled?: boolean;
  /** Style for the pressable box itself (the scale is applied to an inner view). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A pressable that shrinks very slightly while held — the app's one tactile feedback for
 * cards, tiles and rows. It is the engine's own Animated value (no extra dependency) and it
 * stays perfectly still when the device asks for reduced motion (read once, then kept in step
 * with the system setting).
 */
export function PressableScale({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
  accessibilityState,
  disabled = false,
  style,
  testID,
}: PressableScaleProps) {
  const [progress] = useState(() => new Animated.Value(0));
  const reduceMotion = useReduceMotion();

  function settle(toValue: number, duration: number) {
    if (reduceMotion) return;
    Animated.timing(progress, { toValue, duration, useNativeDriver: true }).start();
  }

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, PRESSED_SCALE] });

  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        settle(1, IN_MS);
      }}
      onPressOut={() => {
        settle(0, OUT_MS);
      }}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
