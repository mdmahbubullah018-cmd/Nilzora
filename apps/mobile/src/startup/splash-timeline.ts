/*
 * The launch sequence's numbers and its one asset, in one place.
 *
 * The animation is the supplied file, played as it is:
 *   apps/mobile/assets/splash-screen/nilzora_splash_transparent.webm
 *   WebM / VP9 profile 0, yuva420p (alpha in BlockAdditions), 1080 x 1920, 30 fps, 3.900 s, 139 KB.
 *
 * Android's own decoders (MediaCodec, and therefore ExoPlayer/expo-video) surface only the YUV
 * plane, so the alpha layer is dropped and the clip would draw as an opaque rectangle. The
 * System WebView does composite it, which is why the splash renders the file in a transparent
 * WebView and nothing else.
 */

/**
 * The animation, read straight out of the APK. `android/app/build.gradle` adds
 * `assets/splash-screen` as an assets source directory, so the supplied file is packaged
 * verbatim under this name — it is never copied, converted or re-encoded.
 */
export const SPLASH_VIDEO_SRC = 'file:///android_asset/nilzora_splash_transparent.webm';

/** The supplied animation's exact length: the file reports 3.900 s. */
export const SPLASH_VIDEO_MS = 3900;

/**
 * The native splash is released as soon as the WebView has the first frame (`loadeddata`), and
 * never later than this — a WebView that never reports must not hold the app closed.
 */
export const SPLASH_VIDEO_FIRST_FRAME_LIMIT_MS = 2000;

/** The fade from the splash into the first screen. */
export const SPLASH_EXIT_FADE_MS = 300;

/**
 * The animation is started only once the native splash has been released, and this long after
 * that, so its clock does not run behind the native splash: the WebView paints and plays as soon
 * as it is told to, and the first frame the user sees is the first frame of the clip.
 */
export const SPLASH_VIDEO_START_SETTLE_MS = 350;

/**
 * The longest the splash waits for the app to be ready, counted from the moment JavaScript
 * started. Readiness (the saved session read from local storage, and its one background check)
 * normally arrives during the animation; this only stops a slow keychain or network from holding
 * the shop closed. It is deliberately shorter than the animation, so readiness can never extend
 * the splash past the clip — the clip always outlasts it. It never signs anyone in: screens that
 * need an account keep waiting for the session themselves.
 */
export const SPLASH_READY_LIMIT_MS = 3000;

/**
 * If the animation never reports that it finished (a WebView that died mid-clip), it is treated
 * as finished this long after it should have ended.
 */
export const SPLASH_ANIMATION_FALLBACK_MS = 1000;

export interface SplashExit {
  /** The animation has finished (or was given up on). */
  animationDone: () => void;
  /** The app can show its first screen. */
  ready: () => void;
  /** Stops the exit from ever firing (the splash went away some other way). */
  cancel: () => void;
}

/**
 * Leaves the splash exactly once: when the animation is done and the app is ready. Each
 * signal may arrive any number of times and in any order.
 */
export function createSplashExit(onExit: () => void): SplashExit {
  let animated = false;
  let readied = false;
  let settled = false;
  const check = () => {
    if (settled || !animated || !readied) return;
    settled = true;
    onExit();
  };
  return {
    animationDone() {
      animated = true;
      check();
    },
    ready() {
      readied = true;
      check();
    },
    cancel() {
      settled = true;
    },
  };
}
