import { memo, useContext, useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/theme';

/*
 * The branded pull-to-refresh indicator: the official Nilzora mark inside a rounded-square sky
 * ring. No text, no pill, no decoration — the logo and the ring say everything.
 *
 * Everything that follows the finger runs on the UI thread: `pull` is a shared value written by
 * the gesture, and the position, scale, opacity, ring arc and comet are derived from it in
 * worklets. React re-renders only when the phase changes (a handful of times per refresh).
 *
 * The status line the old pill showed is gone from the screen; the same sentences are still
 * spoken — they come from `REFRESH_LABELS` through `AccessibilityInfo.announceForAccessibility`
 * in pull-to-refresh.tsx, which is why this view is hidden from assistive technology: the
 * announcement must not be read twice.
 */

const logo = require('../../../assets/splash-screen/nilzora-icon-light.png') as number;

export type RefreshPhase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'updated' | 'failed';

/** Spoken by the hook; never drawn. */
export const REFRESH_LABELS: Record<Exclude<RefreshPhase, 'idle'>, string> = {
  pulling: 'Pull to refresh',
  armed: 'Release to refresh',
  refreshing: 'Refreshing…',
  updated: 'Updated just now',
  failed: 'Couldn’t refresh. Check your connection.',
};

/** The official tile, at the size the design asks for. */
const LOGO_SIZE = 56;
/** How far the ring sits outside the tile. */
const RING_OFFSET = 7;
/** The ring's own box: the tile plus the offset on both sides. */
const RING_SIZE = LOGO_SIZE + RING_OFFSET * 2;
/** From the design: 0.28 × logo size + 7dp. */
const RING_RADIUS = 0.28 * LOGO_SIZE + 7;
const RING_STROKE = 3.5;
const TRACK_STROKE = 1.75;
const TRACK_OPACITY = 0.55;

/** The share of the ring the comet's head covers while it travels. */
const COMET_HEAD = 0.34;
/** The tail behind the head: two soft arcs, so the sky fades out instead of stopping. */
const COMET_TAIL = [
  { share: 0.16, opacity: 0.38, shift: 0.3 },
  { share: 0.1, opacity: 0.16, shift: 0.44 },
] as const;
/** One lap, with linear timing so the head keeps a constant speed round the path. */
const LAP_MS = 1050;
const COMET_FORM_MS = 450;
const RING_COMPLETE_MS = 400;
const RING_FADE_MS = 200;
const POP_MS = 350;
const SUCCESS_POP_MS = 200;
const LEAVE_MS = 260;

/**
 * A rounded square that starts at the top centre and runs clockwise, sized so the stroke sits
 * `RING_OFFSET` outside the logo tile.
 */
function roundedSquarePath(size: number, radius: number): string {
  const r = Math.min(radius, size / 2);
  const mid = size / 2;
  const far = size - r;
  return [
    `M ${String(mid)} 0`,
    `H ${String(far)}`,
    `A ${String(r)} ${String(r)} 0 0 1 ${String(size)} ${String(r)}`,
    `V ${String(far)}`,
    `A ${String(r)} ${String(r)} 0 0 1 ${String(far)} ${String(size)}`,
    `H ${String(r)}`,
    `A ${String(r)} ${String(r)} 0 0 1 0 ${String(far)}`,
    `V ${String(r)}`,
    `A ${String(r)} ${String(r)} 0 0 1 ${String(r)} 0`,
    `H ${String(mid)}`,
  ].join(' ');
}

const RING_PATH = roundedSquarePath(RING_SIZE, RING_RADIUS);
/** Length of that path: the four straights plus the four quarter arcs. */
const RING_LENGTH = 4 * (RING_SIZE - 2 * RING_RADIUS) + 2 * Math.PI * RING_RADIUS;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface RefreshIndicatorProps {
  /** How far the content has been pulled down (dp). */
  pull: SharedValue<number>;
  /** The pull distance that triggers a refresh (dp). */
  threshold: number;
  /** The gap held open while refreshing (dp). */
  hold: number;
  phase: RefreshPhase;
  reduceMotion: boolean;
}

function RefreshIndicatorView({
  pull,
  threshold,
  hold,
  phase,
  reduceMotion,
}: RefreshIndicatorProps) {
  // Read through the context rather than the hook: a list rendered outside a SafeAreaProvider
  // (a test, an isolated preview) has no insets, and that must not throw.
  const insets = useContext(SafeAreaInsetsContext);
  const topInset = insets?.top ?? 0;
  const pop = useSharedValue(1);
  const breathe = useSharedValue(1);
  const orbit = useSharedValue(0);
  /** 1 while the ring is a thin comet, 0 while it is a complete ring. */
  const comet = useSharedValue(1);
  const ringAlpha = useSharedValue(1);
  /** 1 while the mark is on screen, falling to 0 as the refresh finishes. */
  const presence = useSharedValue(1);

  const busy = phase === 'refreshing';
  const finishing = phase === 'updated' || phase === 'failed';

  // A single pop the moment the pull passes the threshold. The official tile is one flattened
  // image, so the whole mark pops — nothing is redrawn, cropped or reconstructed.
  useEffect(() => {
    if (phase !== 'armed' || reduceMotion) return;
    pop.set(
      withSequence(
        withTiming(1.07, { duration: POP_MS / 2, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: POP_MS / 2, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  }, [phase, pop, reduceMotion]);

  // While refreshing the comet travels the path at a constant speed and the mark breathes.
  useEffect(() => {
    if (!busy) {
      cancelAnimation(orbit);
      cancelAnimation(breathe);
      orbit.set(0);
      breathe.set(1);
      return;
    }
    comet.set(withTiming(1, { duration: COMET_FORM_MS, easing: Easing.inOut(Easing.quad) }));
    ringAlpha.set(withTiming(1, { duration: 120 }));
    orbit.set(0);
    orbit.set(withRepeat(withTiming(1, { duration: LAP_MS, easing: Easing.linear }), -1));
    breathe.set(
      withRepeat(
        withSequence(
          withTiming(reduceMotion ? 1 : 1.02, { duration: 620, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
    return () => {
      cancelAnimation(orbit);
      cancelAnimation(breathe);
    };
  }, [breathe, busy, comet, orbit, reduceMotion, ringAlpha]);

  // The finish: the comet closes into a ring and fades, then the mark pops once and leaves. A
  // failure takes the same exit without the pop, so it never looks like a success.
  useEffect(() => {
    if (!finishing) {
      if (phase === 'pulling' || phase === 'armed' || phase === 'refreshing') {
        cancelAnimation(presence);
        presence.set(withTiming(1, { duration: 120 }));
      }
      return;
    }
    const success = phase === 'updated';
    cancelAnimation(orbit);
    orbit.set(0);
    breathe.set(1);
    comet.set(
      withTiming(success ? 0 : 1, {
        duration: RING_COMPLETE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
    );
    ringAlpha.set(
      withDelay(
        success ? RING_COMPLETE_MS : 0,
        withTiming(0, { duration: RING_FADE_MS, easing: Easing.inOut(Easing.quad) }),
      ),
    );
    if (success && !reduceMotion) {
      pop.set(
        withSequence(
          withTiming(1.1, { duration: SUCCESS_POP_MS / 2, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: SUCCESS_POP_MS / 2, easing: Easing.inOut(Easing.quad) }),
        ),
      );
    }
    presence.set(
      withDelay(
        success ? SUCCESS_POP_MS + RING_FADE_MS : 0,
        withTiming(0, { duration: LEAVE_MS, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  }, [breathe, comet, finishing, orbit, phase, pop, presence, reduceMotion, ringAlpha]);

  // A finished refresh fades the ring out and takes the mark with it. The next pull has to draw
  // the ring again from the top centre, so its opacity is put back the moment the finish is over
  // — otherwise pulling would show the track alone until the refresh actually started spinning.
  useEffect(() => {
    if (finishing) return;
    cancelAnimation(ringAlpha);
    ringAlpha.set(1);
  }, [finishing, ringAlpha]);

  // Where the ring sits: centred in the gap the content has opened. On a stack screen the frame
  // has no top inset, so the ring is kept below the status bar instead of sliding under it.
  const layerStyle = useAnimatedStyle(() => {
    const p = pull.get();
    const centred = (p - RING_SIZE) / 2;
    const resting =
      p < hold ? interpolate(p, [0, hold], [-RING_SIZE, (hold - RING_SIZE) / 2]) : centred;
    const y = Math.max(resting, topInset);
    const progress = Math.min(p / threshold, 1);
    const enter = interpolate(progress, [0, 0.6], [0.45, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(progress, [0, 0.6], [0, 1], Extrapolation.CLAMP) * presence.get(),
      transform: [{ translateY: y }, { scale: reduceMotion ? 1 : enter }],
    };
  });

  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: pop.get() * breathe.get() * interpolate(presence.get(), [0, 1], [0.55, 1]) },
    ],
  }));

  // One worklet per stroke: the same path, a different length of dash. Pulling draws the ring
  // from the top centre; refreshing turns it into the comet that orbits.
  const headProps = useAnimatedProps(() => {
    const share =
      phase === 'refreshing'
        ? COMET_HEAD + (1 - COMET_HEAD) * (1 - comet.get())
        : phase === 'updated'
          ? 1 - (1 - COMET_HEAD) * comet.get()
          : Math.min(pull.get() / threshold, 1);
    const dash = RING_LENGTH * share;
    const offset = phase === 'refreshing' ? -(orbit.get() * RING_LENGTH) : 0;
    return {
      strokeDasharray: `${String(dash)} ${String(Math.max(RING_LENGTH - dash, 0))}`,
      strokeDashoffset: offset,
      strokeOpacity: ringAlpha.get(),
    };
  });

  return (
    <View
      pointerEvents="none"
      style={styles.layer}
      testID="refresh-indicator"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View style={[styles.stack, layerStyle]} testID="refresh-indicator-stack">
        <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ring}>
          <Path
            d={RING_PATH}
            stroke={theme.brand.muted}
            strokeWidth={TRACK_STROKE}
            strokeOpacity={TRACK_OPACITY}
            fill="none"
          />
          <AnimatedPath
            d={RING_PATH}
            stroke={theme.brand.sky}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            animatedProps={headProps}
          />
          {COMET_TAIL.map((tail) => (
            <CometTail
              key={tail.share}
              phase={phase}
              share={tail.share}
              opacity={tail.opacity}
              shift={tail.shift}
              orbit={orbit}
              comet={comet}
              ringAlpha={ringAlpha}
            />
          ))}
        </Svg>
        <Animated.View style={[styles.mark, markStyle]}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** One soft arc trailing the comet's head; invisible unless the comet is running. */
function CometTail({
  phase,
  share,
  opacity,
  shift,
  orbit,
  comet,
  ringAlpha,
}: {
  phase: RefreshPhase;
  share: number;
  opacity: number;
  shift: number;
  orbit: SharedValue<number>;
  comet: SharedValue<number>;
  ringAlpha: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => {
    if (phase !== 'refreshing') {
      return { strokeDasharray: '0 0', strokeDashoffset: 0, strokeOpacity: 0 };
    }
    return {
      strokeDasharray: `${String(RING_LENGTH * share)} ${String(RING_LENGTH * (1 - share))}`,
      strokeDashoffset: -(orbit.get() * RING_LENGTH) + RING_LENGTH * shift,
      strokeOpacity: opacity * comet.get() * ringAlpha.get(),
    };
  });
  return (
    <AnimatedPath
      d={RING_PATH}
      stroke={theme.brand.sky}
      strokeWidth={RING_STROKE}
      strokeLinecap="round"
      fill="none"
      animatedProps={props}
    />
  );
}

export const RefreshIndicator = memo(RefreshIndicatorView);

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  stack: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', top: 0, left: 0 },
  mark: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
});
