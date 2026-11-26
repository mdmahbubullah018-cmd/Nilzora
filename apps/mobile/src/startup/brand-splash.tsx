import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { theme } from '@/theme';
import {
  SPLASH_ANIMATION_FALLBACK_MS,
  SPLASH_VIDEO_FIRST_FRAME_LIMIT_MS,
  SPLASH_VIDEO_MS,
  SPLASH_VIDEO_SRC,
  SPLASH_VIDEO_START_SETTLE_MS,
} from './splash-timeline';
import { startupMark } from './startup-timing';

/*
 * The animated launch screen
 * --------------------------
 * The animation is the supplied file, untouched: `assets/splash-screen/nilzora_splash_transparent.webm`,
 * a transparent WebM (VP9 with an alpha layer) played by the System WebView — the only decoder on
 * Android that composites VP9 alpha. Android's platform decoders (MediaCodec, and therefore
 * ExoPlayer/expo-video) drop the alpha plane, which would draw the clip as an opaque rectangle.
 *
 * The page is a bare <video> on a transparent background, fitted with `object-fit: contain`, so
 * the artwork keeps its 1080x1920 proportions, is never cropped, and the splash's light colour
 * shows through its transparent parts exactly as it was designed. Nothing is drawn here: no
 * logo, no wordmark, no shapes, no extra background.
 *
 * Launch timing — everything here is ordered so the static native splash is on screen for as
 * short a time as possible:
 *  1. The WebView mounts on the splash's very first render. Nothing is awaited before it: the
 *     native splash is still covering the app, and creating the Android WebView process plus
 *     decoding the clip's first frame is the slowest part of the handover, so it starts first.
 *  2. The page reports `ready` on the video's first frame (`loadeddata`). Only then is the native
 *     splash released — never on mount or layout, which would show a blank frame.
 *  3. Once the native splash is gone, the app sends `play` and the clip's clock starts, inside a
 *     frame callback, so it never runs behind the native splash. It reports `ended` after its own
 *     3.9 s and the existing fade hands over to the homepage.
 *  4. With "reduce motion" on, the app sends `hold` instead: the page shows the finished lockup
 *     without the movement, and reports `ended`.
 */

type Report = 'ready' | 'ended' | 'blocked' | 'failed';

/**
 * The page the WebView renders. It holds nothing but the supplied file and the signals the
 * splash needs; the styling exists only so the video is contained and its background stays
 * transparent. Playback is commanded by the app, never started by the page on its own.
 */
function splashPage(): string {
  const lastFrameSeconds = (SPLASH_VIDEO_MS / 1000 - 0.05).toFixed(3);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}
  video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:transparent}
</style>
</head>
<body>
<video id="v" src="${SPLASH_VIDEO_SRC}" muted playsinline preload="auto" disablepictureinpicture></video>
<script>
(function () {
  var v = document.getElementById('v');
  var sent = {};
  function tell(kind) {
    if (sent[kind]) return;
    sent[kind] = 1;
    if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(kind); }
  }
  var started = false;
  var auto = null;
  function begin(play) {
    if (started) return;
    started = true;
    if (auto !== null) { clearTimeout(auto); auto = null; }
    if (!play) {
      try { v.currentTime = ${lastFrameSeconds}; v.pause(); } catch (e) {}
      setTimeout(function () { tell('ended'); }, 700);
      return;
    }
    // Inside a frame callback the clip's clock only begins once the WebView is painting.
    requestAnimationFrame(function () {
      var playing = v.play();
      if (playing && playing.catch) { playing.catch(function () { tell('blocked'); }); }
    });
  }
  function onCommand(event) {
    var data = event && event.data;
    if (data === 'play') begin(true);
    else if (data === 'hold') begin(false);
  }
  document.addEventListener('message', onCommand);
  window.addEventListener('message', onCommand);
  v.addEventListener('ended', function () { tell('ended'); });
  v.addEventListener('error', function () { tell('failed'); });
  v.addEventListener('loadeddata', function () {
    tell('ready');
    // Never leave the splash sitting on its first frame if the command goes missing.
    auto = setTimeout(function () { begin(true); }, 1600);
  });
})();
</script>
</body>
</html>`;
}

export interface BrandSplashProps {
  /** The first frame is on screen: the native splash can go. */
  onFirstFrame: () => void | Promise<void>;
  /** Called once when the animation is done, has failed, or was given up on. */
  onAnimationDone: () => void;
}

export function BrandSplash({ onFirstFrame, onAnimationDone }: BrandSplashProps) {
  const [failed, setFailed] = useState(false);
  // The clip has its first frame, so its clock is (about to be) running.
  const [timing, setTiming] = useState(false);

  const player = useRef<ComponentRef<typeof WebView> | null>(null);
  const began = useRef(false);
  const reported = useRef(false);
  // Read once, off the render path: the splash must not wait for a bridge round-trip to mount.
  const motion = useRef<Promise<boolean> | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportDone = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onAnimationDone();
  }, [onAnimationDone]);

  /** Releases the native splash, then starts the clip once it is out of the way. */
  const begin = useCallback(() => {
    if (began.current) return;
    began.current = true;
    setTiming(true);
    const handOver = async () => {
      try {
        await onFirstFrame();
      } catch {
        // The native splash is released either way.
      }
      const reduceMotion = await (motion.current ?? Promise.resolve(false)).catch(() => false);
      startTimer.current = setTimeout(() => {
        player.current?.postMessage(reduceMotion ? 'hold' : 'play');
        startupMark(reduceMotion ? 'splash:video-hold' : 'splash:video-play');
      }, SPLASH_VIDEO_START_SETTLE_MS);
    };
    void handOver();
  }, [onFirstFrame]);

  const fail = useCallback(() => {
    // Nothing may trap the launch: a page that cannot play is reported as finished at once.
    setFailed(true);
    begin();
    reportDone();
  }, [begin, reportDone]);

  useEffect(() => {
    startupMark('splash:mount');
    motion.current = AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
  }, []);

  // The native splash waits for the first frame, but never longer than the limit.
  useEffect(() => {
    const limit = setTimeout(begin, SPLASH_VIDEO_FIRST_FRAME_LIMIT_MS);
    return () => {
      clearTimeout(limit);
    };
  }, [begin]);

  // A hard stop for the whole clip: the file's own length plus the fallback.
  useEffect(() => {
    if (!timing) return undefined;
    const stop = setTimeout(reportDone, SPLASH_VIDEO_MS + SPLASH_ANIMATION_FALLBACK_MS);
    return () => {
      clearTimeout(stop);
    };
  }, [timing, reportDone]);

  useEffect(
    () => () => {
      if (startTimer.current) clearTimeout(startTimer.current);
    },
    [],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const report = event.nativeEvent.data as Report;
      if (report === 'ready') {
        // The video's first frame — the moment the native splash can go.
        startupMark('splash:first-frame');
        begin();
        return;
      }
      if (report === 'ended') {
        reportDone();
        return;
      }
      if (report === 'blocked' || report === 'failed') fail();
    },
    [begin, fail, reportDone],
  );

  const page = useMemo(() => splashPage(), []);

  return (
    <View
      style={styles.stage}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Nilzora"
      testID="brand-splash"
    >
      {failed ? null : (
        <WebView
          ref={player}
          testID="brand-splash-video"
          // The supplied animation is packaged in the APK's assets by android/app/build.gradle;
          // the page below contains nothing else.
          source={{ html: page, baseUrl: 'file:///android_asset/' }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
          // The video's own alpha must composite over the splash colour, so the surface this
          // WebView paints on is transparent — not white, not black.
          style={styles.video}
          containerStyle={styles.videoContainer}
          onMessage={handleMessage}
          onError={fail}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.brand.splashBackground,
  },
  videoContainer: { flex: 1, backgroundColor: 'transparent' },
  video: { flex: 1, backgroundColor: 'transparent' },
});
