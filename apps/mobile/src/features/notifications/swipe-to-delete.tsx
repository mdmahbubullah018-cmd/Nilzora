import { Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { theme } from '@/theme';

/*
 * Swipe a notification to the left to delete it.
 *
 * The drag only starts after a deliberate move to the left (16 dp); a vertical move first fails
 * it, so scrolling the list always wins and an ordinary scroll can never delete anything. The card
 * follows the finger with a red trash panel behind it; letting go past a third of the width (or
 * with a quick flick) slides it away and deletes it, otherwise it eases back. Deleting is never
 * final here: the screen offers Undo for three seconds. A screen reader user (or anyone who does
 * not swipe) deletes from the button on the card, which this does not replace.
 */

/** How far (as a share of the card's width) the card must travel before letting go deletes it. */
export const DELETE_SHARE = 0.33;
/** A flick this fast (dp per second) deletes even a short drag. */
export const DELETE_VELOCITY = 900;
const RETURN_MS = 180;
const OUT_MS = 160;

export function SwipeToDelete({
  enabled,
  onDelete,
  children,
}: {
  enabled: boolean;
  onDelete: () => void;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const threshold = Math.round(width * DELETE_SHARE);

  const pan = usePanGesture({
    enabled,
    // Leftward only: a rightward or vertical move first fails the swipe and leaves the touch to
    // the list's scrolling and the card's own press.
    activeOffsetX: [-16, 10_000],
    failOffsetX: [-10_000, 12],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      offset.set(Math.min(0, event.translationX));
    },
    onDeactivate: (event) => {
      'worklet';
      const remove =
        !event.canceled && (-event.translationX > threshold || -event.velocityX > DELETE_VELOCITY);
      if (remove) {
        offset.set(
          reduceMotion
            ? -width
            : withTiming(-width, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
                'worklet';
                if (done) scheduleOnRN(onDelete);
              }),
        );
        if (reduceMotion) scheduleOnRN(onDelete);
        return;
      }
      offset.set(
        reduceMotion ? 0 : withTiming(0, { duration: RETURN_MS, easing: Easing.out(Easing.cubic) }),
      );
    },
  });

  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const hint = useAnimatedStyle(() => ({
    opacity: interpolate(offset.get(), [0, -24, -threshold], [0, 0.6, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.frame}>
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.behind, hint]}
      >
        <Trash2 size={22} color={theme.colors.surface} strokeWidth={2} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={moving}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 16, overflow: 'hidden' },
  behind: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: theme.spacing[5],
    backgroundColor: theme.colors.fieldError,
  },
});
