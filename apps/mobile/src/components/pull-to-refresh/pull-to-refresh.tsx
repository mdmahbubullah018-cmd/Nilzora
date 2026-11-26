import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type FlatListProps,
  type ScrollViewProps,
} from 'react-native';
import {
  GestureDetector,
  GestureStateManager,
  useNativeGesture,
  usePanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { RefreshOutcome } from '@/query/use-manual-refresh';
import { REFRESH_LABELS, RefreshIndicator, type RefreshPhase } from './refresh-indicator';

/*
 * Branded pull-to-refresh
 * -----------------------
 * Android's RefreshControl cannot be restyled and Android lists do not overscroll, so the pull
 * distance is read from a pan gesture that runs alongside the list's own native scrolling
 * (react-native-gesture-handler), and everything that follows the finger runs on the UI thread
 * (react-native-reanimated):
 *
 * - The pull can only start while the list is at its top and no refresh is running; anywhere
 *   else the gesture fails on touch-down, so ordinary and horizontal (carousel) scrolling are
 *   untouched. A mostly sideways drag fails it too.
 * - The pull has a rubber-band resistance; past PULL_THRESHOLD a release refreshes.
 * - While refreshing the content rests HOLD_GAP lower, then springs back once the outcome has
 *   been shown ("Updated just now", or a short failure note — the content stays as it was).
 * - Screen readers get a "Refresh" action on the list and spoken status updates.
 *
 * `onRefresh` is the screen's refresh (see useManualRefresh). The indicator also gives up on a
 * refresh that has not answered within SAFETY_MS, so it can never be stuck on screen.
 */

export const PULL_THRESHOLD = 112;
export const HOLD_GAP = 112;
/**
 * How much further the content can be dragged past the threshold. The short side gives the pull
 * a firm end without a hard stop; with the curve below the finger travels 112dp to reach 112dp,
 * so the threshold is felt at the distance the design asks for.
 */
const EXTRA_PULL = 56;
/** Past useManualRefresh's own 10 s cap: only a refresh that never answers reaches this. */
const SAFETY_MS = 11_000;
/** Time the success finish occupies before the content starts back (ring closes, mark leaves). */
const UPDATED_VISIBLE_MS = 350;
/** A failure collapses straight away: no success to show. */
const FAILED_VISIBLE_MS = 120;
/** The content's return after a success: ease-in-out, per the design. */
const RETURN_MS = 550;
/** A failed or cancelled refresh returns a little quicker, so it never feels stuck. */
const RETURN_FAILED_MS = 380;
const COLLAPSE_MS = 280;

/**
 * How far the content follows the finger.
 *
 * One to one up to the threshold — so 112dp of finger travel is 112dp of pull, and the ring's
 * fill is the same distance the customer has dragged — then a rubber band for the overpull. The
 * old curve compressed the whole gesture (112dp of travel showed ~74dp), which made a 112dp
 * threshold feel like a very long pull.
 */
function rubberBand(distance: number): number {
  'worklet';
  if (distance <= PULL_THRESHOLD) return distance;
  const over = distance - PULL_THRESHOLD;
  return PULL_THRESHOLD + EXTRA_PULL * (1 - Math.exp(-over / (EXTRA_PULL * 0.9)));
}

type OnRefresh = () => unknown;

function interpret(value: unknown): RefreshOutcome {
  return value === 'failed' || value === 'busy' || value === 'cancelled' ? value : 'updated';
}

/** Gesture, scroll tracking and state for one refreshable list. */
function usePullToRefresh(onRefresh: OnRefresh, enabled: boolean) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<RefreshPhase>('idle');
  const pull = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const anchor = useSharedValue(0);
  const armed = useSharedValue(false);
  const busy = useSharedValue(false);

  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      cancelAnimation(pull);
    };
  }, [pull]);

  const collapse = useCallback(
    (duration: number = COLLAPSE_MS) => {
      pull.set(
        withTiming(0, { duration, easing: Easing.inOut(Easing.cubic) }, () => {
          busy.set(false);
        }),
      );
      timer.current = setTimeout(() => {
        // Released even if the collapse animation was interrupted.
        busy.set(false);
        if (mounted.current) setPhase('idle');
      }, duration + 40);
    },
    [busy, pull],
  );

  const runRefresh = useCallback(async () => {
    setPhase('refreshing');
    AccessibilityInfo.announceForAccessibility(REFRESH_LABELS.refreshing);
    let safety: ReturnType<typeof setTimeout> | undefined;
    let outcome: RefreshOutcome;
    try {
      outcome = await Promise.race([
        Promise.resolve()
          .then(() => onRefreshRef.current())
          .then(interpret),
        new Promise<RefreshOutcome>((resolve) => {
          safety = setTimeout(() => resolve('failed'), SAFETY_MS);
        }),
      ]);
    } catch {
      outcome = 'failed';
    } finally {
      clearTimeout(safety);
    }
    if (!mounted.current || outcome === 'cancelled') return;
    if (outcome === 'busy') {
      // Another refresh of this screen is already on its way; nothing new to report.
      collapse();
      return;
    }
    const failed = outcome === 'failed';
    setPhase(failed ? 'failed' : 'updated');
    AccessibilityInfo.announceForAccessibility(
      failed ? REFRESH_LABELS.failed : REFRESH_LABELS.updated,
    );
    timer.current = setTimeout(
      () => collapse(failed ? RETURN_FAILED_MS : RETURN_MS),
      failed ? FAILED_VISIBLE_MS : UPDATED_VISIBLE_MS,
    );
  }, [collapse]);

  /** Starts a refresh without a pull (the screen reader's Refresh action). */
  const refreshNow = useCallback(() => {
    if (busy.get()) return;
    busy.set(true);
    pull.set(withTiming(HOLD_GAP, { duration: 220, easing: Easing.out(Easing.cubic) }));
    void runRefresh();
  }, [busy, pull, runRefresh]);

  const pan = usePanGesture({
    enabled,
    // Downward only; a sideways drag (a carousel) or an upward one fails it.
    activeOffsetY: [-10_000, 10],
    failOffsetY: [-10, 10_000],
    failOffsetX: [-18, 18],
    onTouchesDown: (event) => {
      'worklet';
      if (busy.get() || scrollY.get() > 1) GestureStateManager.fail(event.handlerTag);
    },
    onActivate: (event) => {
      'worklet';
      cancelAnimation(pull);
      anchor.set(event.translationY);
      armed.set(false);
      scheduleOnRN(setPhase, 'pulling');
    },
    onUpdate: (event) => {
      'worklet';
      if (busy.get()) return;
      if (scrollY.get() > 1) {
        // The list moved away from its top during the drag: start counting again from here.
        anchor.set(event.translationY);
        pull.set(0);
        return;
      }
      const next = rubberBand(Math.max(0, event.translationY - anchor.get()));
      pull.set(next);
      const nowArmed = next >= PULL_THRESHOLD;
      if (nowArmed !== armed.get()) {
        armed.set(nowArmed);
        scheduleOnRN(setPhase, nowArmed ? 'armed' : 'pulling');
      }
    },
    onDeactivate: (event) => {
      'worklet';
      if (busy.get()) return;
      if (armed.get() && !event.canceled) {
        busy.set(true);
        armed.set(false);
        pull.set(withSpring(HOLD_GAP, { damping: 20, stiffness: 220, overshootClamping: true }));
        scheduleOnRN(runRefresh);
        return;
      }
      armed.set(false);
      pull.set(withTiming(0, { duration: COLLAPSE_MS, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(setPhase, 'idle');
    },
  });

  const native = useNativeGesture({ disableReanimated: true, simultaneousWith: pan });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.get() }],
  }));

  const accessibilityProps = {
    accessibilityActions: enabled ? [{ name: 'refresh', label: 'Refresh' }] : [],
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (enabled && event.nativeEvent.actionName === 'refresh') refreshNow();
    },
  };

  return { pan, native, onScroll, contentStyle, pull, phase, reduceMotion, accessibilityProps };
}

type Refreshable = ReturnType<typeof usePullToRefresh>;

/** The indicator, the gestures and the moving content around one list element. */
function Frame({ state, children }: { state: Refreshable; children: ReactElement }) {
  return (
    <View style={styles.frame}>
      <GestureDetector gesture={state.pan}>
        <Animated.View style={[styles.frame, state.contentStyle]}>
          <GestureDetector gesture={state.native}>{children}</GestureDetector>
        </Animated.View>
      </GestureDetector>
      <RefreshIndicator
        pull={state.pull}
        threshold={PULL_THRESHOLD}
        hold={HOLD_GAP}
        phase={state.phase}
        reduceMotion={state.reduceMotion}
      />
    </View>
  );
}

export interface RefreshableScrollViewProps extends Omit<ScrollViewProps, 'refreshControl'> {
  /** Enables the branded pull-to-refresh. Without it this is a plain ScrollView. */
  onRefresh?: OnRefresh;
  /**
   * Turns the pull off for a while without remounting the list (Search, while the customer is
   * typing). Defaults to true.
   */
  refreshEnabled?: boolean;
}

/** A ScrollView with the branded pull-to-refresh. */
export function RefreshableScrollView({
  onRefresh,
  refreshEnabled,
  ...props
}: RefreshableScrollViewProps) {
  if (onRefresh === undefined) return <ScrollView {...props} />;
  return <RefreshingScrollView onRefresh={onRefresh} refreshEnabled={refreshEnabled} {...props} />;
}

function RefreshingScrollView({
  onRefresh,
  refreshEnabled = true,
  ...props
}: RefreshableScrollViewProps & { onRefresh: OnRefresh }) {
  const state = usePullToRefresh(onRefresh, refreshEnabled);
  return (
    <Frame state={state}>
      <Animated.ScrollView
        {...props}
        {...state.accessibilityProps}
        onScroll={state.onScroll}
        scrollEventThrottle={16}
        overScrollMode="never"
      />
    </Frame>
  );
}

export type RefreshableFlatListProps<T> = Omit<
  FlatListProps<T>,
  // Reanimated's FlatList draws its own cell wrapper, so a custom one is not supported.
  'refreshControl' | 'refreshing' | 'onRefresh' | 'CellRendererComponent'
> & {
  /** Enables the branded pull-to-refresh. Without it this is a plain FlatList. */
  onRefresh?: OnRefresh;
  /** Turns the pull off for a while without remounting the list. Defaults to true. */
  refreshEnabled?: boolean;
};

/** A FlatList with the branded pull-to-refresh. */
export function RefreshableFlatList<T>({
  onRefresh,
  refreshEnabled,
  ...props
}: RefreshableFlatListProps<T>) {
  if (onRefresh === undefined) return <FlatList<T> {...props} />;
  return <RefreshingFlatList<T> onRefresh={onRefresh} refreshEnabled={refreshEnabled} {...props} />;
}

function RefreshingFlatList<T>({
  onRefresh,
  refreshEnabled = true,
  ...props
}: RefreshableFlatListProps<T> & { onRefresh: OnRefresh }) {
  const state = usePullToRefresh(onRefresh, refreshEnabled);
  return (
    <Frame state={state}>
      <Animated.FlatList<T>
        {...props}
        {...state.accessibilityProps}
        onScroll={state.onScroll}
        scrollEventThrottle={16}
        overScrollMode="never"
      />
    </Frame>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
});
