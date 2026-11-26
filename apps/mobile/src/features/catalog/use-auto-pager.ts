import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useReduceMotion } from '@/components/use-reduce-motion';
import { useScreenReaderEnabled } from '@/components/use-screen-reader';
import { getAutoplayPaused, setAutoplayPaused } from './autoplay-choice';

/** How long a hero banner stays before the carousel moves on by itself. */
export const HERO_AUTO_ADVANCE_MS = 4000;
/** The quick fade out and back in that replaces a long sweep from the last page to the first. */
export const WRAP_FADE_OUT_MS = 120;
export const WRAP_FADE_IN_MS = 200;

export interface AutoPagerOptions {
  /** How many pages there are. Fewer than two never moves on its own. */
  count: number;
  /** Distance in dp between the start of one page and the start of the next. */
  step: number;
  /** How long a page stays before the next one is shown. */
  intervalMs?: number;
  /**
   * Names this carousel for the session, so a pause or play the shopper chose is still in force
   * when they come back to the screen. Without it the choice lasts only while the screen is open.
   */
  choiceKey?: string;
}

/**
 * The paging behaviour shared by the Home carousels: which page is showing, and an
 * auto-advance clock that behaves itself.
 *
 * The clock runs only when all of these hold, and is cleared the moment any stops holding:
 *  - there are at least two pages;
 *  - the screen is focused (it stops when the customer navigates away);
 *  - the app is in the foreground ("inactive" and "background" both stop it);
 *  - the device does not ask for reduced motion (then nothing moves by itself, ever);
 *  - the shopper has not paused it (WCAG 2.2.2). With a screen reader running it starts paused,
 *    and a shopper who presses Play is believed;
 *  - a finger is not on the carousel.
 *
 * A manual swipe pauses the clock from the first pixel of the drag and restarts a full wait
 * when the finger lifts, so the page never jumps away from under a thumb. Every move the clock
 * makes is one animated scroll, the same thing a swipe produces - except the move from the last
 * page back to the first, which would sweep visibly across every page: that one fades the
 * carousel out, jumps while it is invisible, and fades it back in (`fade` is the opacity).
 */
export function useAutoPager({
  count,
  step,
  intervalMs = HERO_AUTO_ADVANCE_MS,
  choiceKey,
}: AutoPagerOptions) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const reduceMotion = useReduceMotion();
  const screenReader = useScreenReaderEnabled();
  const [choice, setChoice] = useState<boolean | undefined>(() =>
    choiceKey === undefined ? undefined : getAutoplayPaused(choiceKey),
  );
  // The shopper's own choice wins; without one a screen reader means "paused".
  const paused = choice ?? screenReader;
  const [fade] = useState(() => new Animated.Value(1));
  // The timer reads the page from a ref: re-creating it on every page change would restart the
  // clock each time and could leave two timers alive for a frame.
  const pageRef = useRef(0);
  const blocked = reduceMotion || paused;
  const blockedRef = useRef(blocked);
  const draggingRef = useRef(false);
  // Start/stop of the live clock; a no-op while the screen is unfocused or there is one page.
  const clock = useRef<{ start: () => void; stop: () => void }>({
    start: () => undefined,
    stop: () => undefined,
  });
  const maxIndex = Math.max(count - 1, 0);
  // A page was removed while the carousel sat on it: show the first page again. The dots read
  // this; the scroll itself is moved back to the start by the effect below.
  const shownPage = page > maxIndex ? 0 : page;

  useEffect(() => {
    if (page <= maxIndex) return;
    pageRef.current = 0;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [maxIndex, page]);

  // The page width changed (the phone was rotated): stay on the same page.
  const stepRef = useRef(step);
  useEffect(() => {
    if (stepRef.current === step) return;
    stepRef.current = step;
    scrollRef.current?.scrollTo({ x: pageRef.current * step, animated: false });
  }, [step]);

  // Declared before the focus effect so the ref is current when that effect first starts the
  // clock, and again when the setting, a pause or a screen reader changes while the screen is open.
  useEffect(() => {
    blockedRef.current = blocked;
    if (blocked) clock.current.stop();
    else clock.current.start();
  }, [blocked]);

  useFocusEffect(
    useCallback(() => {
      if (count < 2) return undefined;
      let timer: ReturnType<typeof setInterval> | null = null;
      const stop = () => {
        if (timer !== null) clearInterval(timer);
        timer = null;
        // A fade caught half-way must not leave the carousel dim.
        fade.stopAnimation();
        fade.setValue(1);
      };
      const wrapToFirst = () => {
        Animated.timing(fade, {
          toValue: 0,
          duration: WRAP_FADE_OUT_MS,
          useNativeDriver: true,
        }).start(({ finished }) => {
          // Interrupted (a finger came down, the clock stopped): the page stays where it is.
          if (!finished) return;
          pageRef.current = 0;
          setPage(0);
          scrollRef.current?.scrollTo({ x: 0, animated: false });
          Animated.timing(fade, {
            toValue: 1,
            duration: WRAP_FADE_IN_MS,
            useNativeDriver: true,
          }).start();
        });
      };
      const start = () => {
        stop();
        // Only a state that says the app is away stops the start: a runtime that does not report
        // one (a test renderer) is treated as foreground, as the "change" events still stop it.
        const appState: string | null | undefined = AppState.currentState;
        const away = appState === 'background' || appState === 'inactive';
        if (blockedRef.current || draggingRef.current || away) return;
        timer = setInterval(() => {
          const next = (pageRef.current + 1) % count;
          if (next === 0) {
            wrapToFirst();
            return;
          }
          pageRef.current = next;
          setPage(next);
          scrollRef.current?.scrollTo({ x: next * step, animated: true });
        }, intervalMs);
      };
      clock.current = { start, stop };
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') start();
        else stop();
      });
      start();
      return () => {
        stop();
        clock.current = { start: () => undefined, stop: () => undefined };
        subscription.remove();
      };
    }, [count, step, intervalMs, fade]),
  );

  const onScrollBeginDrag = useCallback(() => {
    draggingRef.current = true;
    clock.current.stop();
  }, []);

  const onScrollEndDrag = useCallback(() => {
    draggingRef.current = false;
    // A fresh full wait: the customer has just chosen where to be.
    clock.current.start();
  }, []);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / step);
      pageRef.current = next;
      setPage(next);
    },
    [step],
  );

  /** Pause when playing, play when paused; remembered for the session when the carousel has a key. */
  const togglePaused = useCallback(() => {
    const next = !paused;
    setChoice(next);
    if (choiceKey !== undefined) setAutoplayPaused(choiceKey, next);
  }, [paused, choiceKey]);

  return {
    scrollRef,
    /** The page the dots should show. */
    page: shownPage,
    scrollHandlers: { onScrollBeginDrag, onScrollEndDrag, onMomentumScrollEnd },
    /** Opacity for the scroller, dipped briefly when the clock wraps from the last page to the first. */
    fade,
    /** True while the shopper (or a running screen reader) has the slideshow paused. */
    paused,
    togglePaused,
    /**
     * Whether a Pause / Play control makes sense: there is something to advance, and the device
     * does not already forbid it (under reduced motion nothing ever moves, so there is nothing
     * to pause).
     */
    canPause: count >= 2 && !reduceMotion,
  };
}
