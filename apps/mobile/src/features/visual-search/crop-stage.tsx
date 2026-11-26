import { ArrowLeft, Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnUI, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';

/*
 * Crop
 * ----
 * The search is only as good as what is sent to it: a photograph of a room confuses a model
 * that was trained on products. So the customer frames the object exactly as it will be sent —
 * the square IS the crop — and the maths that turns the gesture into pixels lives in
 * image-crop.ts, where it is unit tested.
 */

export interface CropStageProps {
  photo: { uri: string; width: number; height: number };
  onBack: () => void;
  onConfirm: (
    gesture: { scale: number; translateX: number; translateY: number },
    frameSize: number,
  ) => Promise<void>;
}

export function CropStage({ photo, onBack, onConfirm }: CropStageProps) {
  const [frameSize, setFrameSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, startScale.value * event.scale));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);
  const transform = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // The picture covers the frame at 1x: image-crop.ts computes the crop from this same rule.
  const base = useMemo(
    () => (frameSize === 0 ? 0 : Math.max(frameSize / photo.width, frameSize / photo.height)),
    [frameSize, photo.height, photo.width],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the camera"
            onPress={onBack}
            hitSlop={8}
            style={styles.round}
          >
            <ArrowLeft size={22} color={theme.brand.onSolid} />
          </Pressable>
          <Text style={styles.headerTitle}>Crop</Text>
          <View style={styles.round} />
        </View>
      </SafeAreaView>

      <View
        style={styles.stage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setFrameSize(Math.min(width - theme.spacing[4] * 2, height - theme.spacing[4] * 2, 460));
        }}
      >
        {frameSize > 0 ? (
          <GestureDetector gesture={gesture}>
            <View style={[styles.frame, { width: frameSize, height: frameSize }]}>
              <Animated.Image
                source={{ uri: photo.uri }}
                style={[
                  {
                    width: photo.width * base,
                    height: photo.height * base,
                    left: (frameSize - photo.width * base) / 2,
                    top: (frameSize - photo.height * base) / 2,
                  },
                  transform,
                ]}
                resizeMode="cover"
                accessibilityLabel="The photo you are searching with"
              />
              <View pointerEvents="none" style={styles.grid}>
                <View style={[styles.gridLine, styles.gridLineV1]} />
                <View style={[styles.gridLine, styles.gridLineV2]} />
                <View style={[styles.gridLine, styles.gridLineH1]} />
                <View style={[styles.gridLine, styles.gridLineH2]} />
              </View>
            </View>
          </GestureDetector>
        ) : null}
      </View>

      <Text style={styles.hint}>Pinch to zoom, drag to move the object inside the frame.</Text>

      <SafeAreaView edges={['bottom']} style={styles.footerWrap}>
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              runOnUI(() => {
                'worklet';
                scale.value = 1;
                translateX.value = 0;
                translateY.value = 0;
              })();
            }}
            hitSlop={8}
            style={styles.reset}
          >
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search with this photo"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => {
              void (async () => {
                setBusy(true);
                try {
                  await onConfirm(
                    {
                      scale: scale.value,
                      translateX: translateX.value,
                      translateY: translateY.value,
                    },
                    frameSize,
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
            style={({ pressed }) => [styles.search, pressed ? styles.searchPressed : null]}
          >
            {busy ? (
              <ActivityIndicator color={theme.brand.onSolid} />
            ) : (
              <>
                <Check size={18} color={theme.brand.onSolid} accessible={false} />
                <Text style={styles.searchText}>Search</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.navy },
  headerWrap: { backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerTitle: {
    color: theme.brand.onSolid,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  round: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: theme.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    overflow: 'hidden',
    borderRadius: theme.radii.hero,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  grid: { ...StyleSheet.absoluteFill },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.22)' },
  gridLineV1: { left: '33.33%', top: 0, bottom: 0, width: 1 },
  gridLineV2: { left: '66.66%', top: 0, bottom: 0, width: 1 },
  gridLineH1: { top: '33.33%', left: 0, right: 0, height: 1 },
  gridLineH2: { top: '66.66%', left: 0, right: 0, height: 1 },
  hint: {
    color: theme.brand.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
  },
  footerWrap: { backgroundColor: 'transparent' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
  },
  reset: { paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[2] },
  resetText: { color: theme.brand.onSolid, fontSize: 15, fontWeight: theme.fontWeights.medium },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    minHeight: 52,
    borderRadius: theme.radii.full,
    backgroundColor: theme.brand.primary,
  },
  searchPressed: { backgroundColor: theme.brand.primaryPressed },
  searchText: { color: theme.brand.onSolid, fontSize: 16, fontWeight: theme.fontWeights.semibold },
});
