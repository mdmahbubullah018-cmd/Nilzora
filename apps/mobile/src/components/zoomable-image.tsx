import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/*
 * A picture that can be pinched, panned and double-tapped, filling the space it is given.
 *
 * Pinch scales between 1x (the picture fits the frame) and MAX_SCALE around where the fingers
 * are; once zoomed, one finger pans, kept inside the picture's own edges so it never drifts out of
 * view; a double tap toggles between fit and DOUBLE_TAP_SCALE; letting go below 1x eases back to
 * fit. At 1x the pan does nothing, so a surrounding screen's own controls keep working.
 *
 * The picture is drawn `contain`, so the frame's size is the zoom bound. This must sit inside a
 * GestureHandlerRootView (a Modal needs its own on Android).
 */

export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
const EASE_MS = 180;

export function ZoomableImage({
  uri,
  accessibilityLabel,
  testID,
}: {
  uri: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    width.set(w);
    height.set(h);
  };

  const pinch = usePinchGesture({
    onUpdate: (event) => {
      'worklet';
      scale.set(Math.min(MAX_SCALE, Math.max(0.6, savedScale.get() * event.scale)));
    },
    onDeactivate: () => {
      'worklet';
      if (scale.get() < 1) {
        scale.set(withTiming(1, { duration: EASE_MS }));
        x.set(withTiming(0, { duration: EASE_MS }));
        y.set(withTiming(0, { duration: EASE_MS }));
        savedScale.set(1);
        savedX.set(0);
        savedY.set(0);
        return;
      }
      savedScale.set(scale.get());
    },
  });

  const pan = usePanGesture({
    minPointers: 1,
    maxPointers: 2,
    onUpdate: (event) => {
      'worklet';
      if (scale.get() <= 1) return;
      const limitX = ((scale.get() - 1) * width.get()) / 2;
      const limitY = ((scale.get() - 1) * height.get()) / 2;
      x.set(Math.min(limitX, Math.max(-limitX, savedX.get() + event.translationX)));
      y.set(Math.min(limitY, Math.max(-limitY, savedY.get() + event.translationY)));
    },
    onDeactivate: () => {
      'worklet';
      savedX.set(x.get());
      savedY.set(y.get());
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: (event) => {
      'worklet';
      if (event.canceled) return;
      const zoomedIn = scale.get() > 1.01;
      const next = zoomedIn ? 1 : DOUBLE_TAP_SCALE;
      scale.set(withTiming(next, { duration: EASE_MS }));
      x.set(withTiming(0, { duration: EASE_MS }));
      y.set(withTiming(0, { duration: EASE_MS }));
      savedScale.set(next);
      savedX.set(0);
      savedY.set(0);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const moving = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <View style={styles.frame} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.fill, moving]}>
          <Image
            testID={testID}
            source={{ uri }}
            resizeMode="contain"
            accessibilityLabel={accessibilityLabel}
            style={styles.fill}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
});
