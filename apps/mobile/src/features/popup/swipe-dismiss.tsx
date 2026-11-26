import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/*
 * A card that can be swiped down to dismiss. It follows the finger, and past a short distance (or
 * a quick flick) it calls `onDismiss`; otherwise it eases back. A mostly-horizontal move first
 * fails the gesture, so the card's own buttons and links keep working.
 *
 * It is built on the gesture handler (like the photo viewer) because it lives inside a native
 * Modal: the handler needs a GestureHandlerRootView inside that Modal, which the popup provides.
 * React Native's own PanResponder never saw the swipe on a real Android phone in this position.
 * With "reduce motion" on the card still follows the finger, but returns at once.
 */

/** How far down the card must travel before letting go dismisses it (dp). */
export const DISMISS_DISTANCE = 90;
/** A flick this fast (dp per second) dismisses even a short drag. */
export const DISMISS_VELOCITY = 900;
const RETURN_MS = 180;

export function SwipeDismiss({
  onDismiss,
  style,
  testID,
  children,
}: {
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);

  const pan = usePanGesture({
    // Downward only: an upward or sideways move first fails the swipe.
    activeOffsetY: [-10_000, 10],
    failOffsetX: [-24, 24],
    onUpdate: (event) => {
      'worklet';
      offset.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      'worklet';
      const dismiss =
        !event.canceled &&
        (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY);
      if (dismiss) scheduleOnRN(onDismiss);
      offset.set(
        reduceMotion || dismiss
          ? 0
          : withTiming(0, { duration: RETURN_MS, easing: Easing.out(Easing.cubic) }),
      );
    },
  });

  const moving = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View accessibilityViewIsModal testID={testID} style={[style, moving]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
