import { Reply } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
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
 * Swipe a message to the right to answer it
 * -----------------------------------------
 * The same reply the message menu offers, as the gesture people know from messaging apps. The
 * drag only starts after a deliberate move to the right (16 dp); a vertical move first fails it,
 * so scrolling the thread always wins. The bubble follows the finger with growing resistance up
 * to a short distance, a reply arrow fades in behind it, and letting go past the threshold opens
 * the reply. Nothing else happens on a swipe: it never sends, deletes or reacts.
 *
 * With "reduce motion" on, the bubble still follows the finger (that is the feedback the gesture
 * needs) but returns at once instead of easing back. A screen reader user replies from the
 * message's actions, which this does not replace.
 */

/** How far the bubble must travel before letting go replies. */
export const REPLY_THRESHOLD = 56;
/** The furthest the bubble moves, whatever the finger does. */
const MAX_TRAVEL = 76;
const RETURN_MS = 180;

/** Finger travel → bubble travel: one to one at first, then increasingly resistant. */
function resisted(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  if (dx <= REPLY_THRESHOLD) return dx;
  return Math.min(MAX_TRAVEL, REPLY_THRESHOLD + (dx - REPLY_THRESHOLD) * 0.35);
}

export function SwipeToReply({
  enabled,
  onReply,
  children,
}: {
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);

  const pan = usePanGesture({
    enabled,
    // Rightward only: a leftward or vertical move first fails the swipe and leaves the touch
    // to the list's scrolling and the bubble's own press handlers.
    activeOffsetX: [-10_000, 16],
    failOffsetX: [-12, 10_000],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      armed.set(false);
    },
    onUpdate: (event) => {
      'worklet';
      const next = resisted(event.translationX);
      offset.set(next);
      armed.set(next >= REPLY_THRESHOLD);
    },
    onDeactivate: (event) => {
      'worklet';
      const reply = armed.get() && !event.canceled;
      armed.set(false);
      offset.set(
        reduceMotion ? 0 : withTiming(0, { duration: RETURN_MS, easing: Easing.out(Easing.cubic) }),
      );
      if (reply) scheduleOnRN(onReply);
    },
  });

  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const hint = useAnimatedStyle(() => {
    const progress = interpolate(offset.get(), [8, REPLY_THRESHOLD], [0, 1], Extrapolation.CLAMP);
    return { opacity: progress, transform: [{ scale: 0.7 + 0.3 * progress }] };
  });

  return (
    <View>
      <Animated.View style={[styles.hint, hint]} pointerEvents="none" accessible={false}>
        <View style={styles.hintCircle}>
          <Reply size={16} color={theme.colors.foreground} />
        </View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={moving}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute',
    left: theme.spacing[1],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  hintCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
});
