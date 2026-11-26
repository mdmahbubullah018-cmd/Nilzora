import { SplashScreen } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSession } from '@/auth/session-context';
import { BrandSplash } from './brand-splash';
import { beginSplash, finishSplash, jsStartedAt } from './splash-state';
import {
  createSplashExit,
  SPLASH_EXIT_FADE_MS,
  SPLASH_READY_LIMIT_MS,
  type SplashExit,
} from './splash-timeline';
import { startupMark } from './startup-timing';

/*
 * The launch sequence
 * -------------------
 * 1. The native splash (expo-splash-screen: the launch colour, no image — see app.json) covers
 *    the app while the bundle starts. It is held past the first frame (holdNativeSplash).
 * 2. The animated splash mounts on the app's first render and its WebView starts loading the clip
 *    straight away. Only when that clip reports its first frame is the native splash released, so
 *    the hand-over is colour to colour: no logo to wait for, no blank frame between them.
 * 3. Everything else starts in parallel with the animation: the providers read the saved session
 *    from local storage, Home's queries (and the cached catalog) load behind the splash. None of
 *    it is awaited.
 * 4. The splash leaves once — when the animation has played and the saved session has been read,
 *    or at SPLASH_READY_LIMIT_MS after JavaScript started. That limit is shorter than the clip, so
 *    neither a slow network nor a slow keychain can extend the splash past the animation. Nothing
 *    on the network is waited for: Home shows cached data or skeletons, and account screens keep
 *    waiting for the session themselves. A timeout never signs anyone in.
 */

let held = false;

/** Keeps the native splash up past the first frame. Safe to call more than once. */
export function holdNativeSplash(): void {
  if (held) return;
  held = true;
  beginSplash();
  startupMark('splash:native-held');
  SplashScreen.preventAutoHideAsync().catch(() => {
    // No splash module in this build, or it is already hidden: nothing to hold.
  });
}

function hideNativeSplash(): Promise<void> {
  return SplashScreen.hideAsync()
    .catch(() => {
      // Already hidden, or no splash module: the app is visible either way.
    })
    .then(() => {
      startupMark('splash:native-hidden');
    });
}

type Phase = 'visible' | 'leaving' | 'gone';

/** The animated launch screen over the app, and the one place the launch ends. */
export function StartupSplash() {
  const { state } = useSession();
  const restoring = state.status === 'restoring';
  const [phase, setPhase] = useState<Phase>('visible');
  const [opacity] = useState(() => new Animated.Value(1));

  // One controller for the whole life of the splash: it leaves exactly once.
  const [exit] = useState<SplashExit>(() =>
    createSplashExit(() => {
      finishSplash();
      setPhase('leaving');
    }),
  );

  // The first screen is the customer's once the animation has played and the saved session has
  // been read. The check itself is local first (`restoring` ends when the stored tokens have been
  // read; its one background validation may still be running), and SPLASH_READY_LIMIT_MS is
  // shorter than the clip, so neither a slow network nor a slow keychain can hold the splash past
  // the animation.
  const settled = useRef(false);
  useEffect(() => {
    if (restoring) return;
    if (!settled.current) {
      settled.current = true;
      startupMark(`session:${state.status}`);
    }
    exit.ready();
  }, [exit, restoring, state.status]);

  useEffect(() => {
    // The readiness cap counts from JavaScript's start, not from this mount.
    const remaining = Math.max(0, SPLASH_READY_LIMIT_MS - (Date.now() - jsStartedAt()));
    const timer = setTimeout(exit.ready, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [exit]);

  useEffect(() => {
    if (phase !== 'gone') return;
    startupMark('splash:gone');
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: SPLASH_EXIT_FADE_MS,
      useNativeDriver: true,
    });
    fade.start(() => {
      setPhase('gone');
    });
    // The fade's callback is the normal way out; this makes sure an interrupted fade cannot
    // leave an invisible layer over the app.
    const timer = setTimeout(() => {
      setPhase('gone');
    }, SPLASH_EXIT_FADE_MS + 400);
    return () => {
      fade.stop();
      clearTimeout(timer);
    };
  }, [opacity, phase]);

  // However the splash goes away (normally, or unmounted early), the native one goes too and
  // the work waiting for the launch is released.
  useEffect(
    () => () => {
      exit.cancel();
      void hideNativeSplash();
      finishSplash();
    },
    [exit],
  );

  const handleFirstFrame = useCallback(() => hideNativeSplash(), []);

  if (phase === 'gone') return null;

  return (
    <Animated.View
      style={[styles.overlay, { opacity }]}
      pointerEvents={phase === 'leaving' ? 'none' : 'auto'}
      accessibilityViewIsModal
      testID="startup-splash"
    >
      <BrandSplash onFirstFrame={handleFirstFrame} onAnimationDone={exit.animationDone} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    // Above the introduction and campaign overlays (zIndex 10, elevation 50) and the tab bar.
    zIndex: 100,
    elevation: 100,
  },
});
