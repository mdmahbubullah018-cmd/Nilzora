import { act, fireEvent, screen } from '@testing-library/react-native';
import { SplashScreen } from 'expo-router';
import { AccessibilityInfo, Text } from 'react-native';
import { holdNativeSplash, StartupSplash } from '../startup/startup-splash';
import { beginSplash, resetSplashStateForTests, useSplashPhase } from '../startup/splash-state';
import {
  createSplashExit,
  SPLASH_ANIMATION_FALLBACK_MS,
  SPLASH_EXIT_FADE_MS,
  SPLASH_READY_LIMIT_MS,
  SPLASH_VIDEO_FIRST_FRAME_LIMIT_MS,
  SPLASH_VIDEO_MS,
  SPLASH_VIDEO_SRC,
  SPLASH_VIDEO_START_SETTLE_MS,
} from '../startup/splash-timeline';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { createControllableManager } from '../test-utils/session-fakes';

jest.mock('expo-router', () => {
  const actual = jest.requireActual<object>('@/test-utils/expo-router-mock');
  return {
    ...actual,
    SplashScreen: {
      preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
      hideAsync: jest.fn(() => Promise.resolve()),
    },
  };
});

const mockPostMessage = jest.fn();

/*
 * The splash renders the supplied animation in a WebView; the native module behind it does not
 * exist in this environment, so it stands in as a plain view that keeps its props and records
 * the playback command — which lets a test read the page it was handed, post the messages the
 * real page posts, and see when the clip is started.
 */
jest.mock('react-native-webview', () => {
  /* eslint-disable @typescript-eslint/consistent-type-imports -- a mock factory cannot close over imports */
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  /* eslint-enable @typescript-eslint/consistent-type-imports */
  const MockWebView = React.forwardRef<
    { postMessage: (data: string) => void },
    { testID?: string }
  >((props, ref) => {
    React.useImperativeHandle(ref, () => ({ postMessage: mockPostMessage }));
    return React.createElement(View, props);
  });
  MockWebView.displayName = 'MockWebView';
  return { WebView: MockWebView };
});

const hide = SplashScreen.hideAsync as jest.Mock;

function PhaseProbe() {
  return <Text>{useSplashPhase()}</Text>;
}

/** Lets the motion setting (a promise) settle, so the player is mounted. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Moves the clock in small steps, so the effects that one timer's state change schedules are
 * committed (and their own timers started) before the clock moves on, as on a device.
 */
async function advance(ms: number): Promise<void> {
  const step = 50;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    });
  }
}

/** What the supplied animation's page reports back to the splash. */
async function report(kind: 'ready' | 'ended' | 'blocked' | 'failed'): Promise<void> {
  await fireEvent(screen.getByTestId('brand-splash-video'), 'message', {
    nativeEvent: { data: kind },
  });
}

function page(): string {
  return (screen.getByTestId('brand-splash-video').props as { source: { html: string } }).source
    .html;
}

beforeEach(() => {
  hide.mockClear();
  mockPostMessage.mockClear();
  resetSplashStateForTests();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createSplashExit', () => {
  it('fires once, only when the animation is done and the app is ready, in either order', () => {
    const onExit = jest.fn();
    const exit = createSplashExit(onExit);
    exit.ready();
    exit.ready();
    expect(onExit).not.toHaveBeenCalled();
    exit.animationDone();
    exit.animationDone();
    exit.ready();
    expect(onExit).toHaveBeenCalledTimes(1);

    const other = jest.fn();
    const reversed = createSplashExit(other);
    reversed.animationDone();
    expect(other).not.toHaveBeenCalled();
    reversed.ready();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('never fires after it was cancelled', () => {
    const onExit = jest.fn();
    const exit = createSplashExit(onExit);
    exit.cancel();
    exit.animationDone();
    exit.ready();
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('the supplied animation', () => {
  it('is the file packaged in the APK, played for its own length', () => {
    expect(SPLASH_VIDEO_SRC).toBe('file:///android_asset/nilzora_splash_transparent.webm');
    expect(SPLASH_VIDEO_MS).toBe(3900);
  });

  it('is the only thing on the page: no drawn logo, no added branding', async () => {
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();

    const html = page();
    expect(html).toContain(`<video id="v" src="${SPLASH_VIDEO_SRC}"`);
    expect(html).toContain('object-fit:contain');
    // The clip is started on the app's command, not by the page on its own.
    expect(html).not.toContain('autoplay');
    // The page carries the video and nothing else pictured.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('nilzora-logo');
    expect(html).not.toContain('nilzora-mark');
  });

  it('mounts the player before the motion setting is known, and commands playback after hand-over', async () => {
    // A bridge round-trip before the WebView exists would put the Android WebView's start-up
    // behind it; the video must begin loading on the splash's first render.
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise(() => undefined));
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(<StartupSplash />, { session: manager });
    expect(screen.getByTestId('brand-splash-video')).toBeOnTheScreen();
    expect(hide).not.toHaveBeenCalled();
    // Playback is the app's decision, not the page's: no autoplay attribute anywhere.
    expect(page()).not.toContain('autoplay');
    expect(page()).toContain("data === 'play'");
    expect(page()).toContain("data === 'hold'");
  });

  it('asks for playback when motion is allowed, and for the last frame when it is reduced', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const manager = createControllableManager({ status: 'signed_out' });
    const view = await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();
    await report('ready');
    await advance(SPLASH_VIDEO_START_SETTLE_MS + 100);
    expect(mockPostMessage).toHaveBeenCalledWith('play');
    await view.unmount();

    mockPostMessage.mockClear();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();
    await report('ready');
    expect(hide).toHaveBeenCalled();
    await advance(SPLASH_VIDEO_START_SETTLE_MS + 100);
    expect(mockPostMessage).toHaveBeenCalledWith('hold');
    expect(mockPostMessage).not.toHaveBeenCalledWith('play');
  });

  it('starts the clip only once the native splash has been released', async () => {
    // Without this, the clip's clock would run behind the native splash and the launch would
    // open part-way through the animation.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(false);
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();
    await report('ready');
    expect(hide).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).not.toHaveBeenCalled();
    await advance(SPLASH_VIDEO_START_SETTLE_MS + 100);
    expect(mockPostMessage).toHaveBeenCalledWith('play');
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it('holds the last frame instead of playing when motion is reduced', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();
    await report('ready');
    expect(hide).toHaveBeenCalledTimes(1);
    await advance(SPLASH_VIDEO_START_SETTLE_MS + 700);
    expect(mockPostMessage).toHaveBeenCalledWith('hold');
    expect(mockPostMessage).not.toHaveBeenCalledWith('play');
  });
});

describe('StartupSplash', () => {
  it('holds the native splash once, however often it is asked', () => {
    holdNativeSplash();
    holdNativeSplash();
    expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
  });

  it('releases the native splash on the animation’s first frame, not before', async () => {
    const manager = createControllableManager({ status: 'restoring' });
    const api = createFakeApiClient();
    // The campaign lookup never answers: the splash must not care.
    api.publicOnboarding.mockImplementation(() => new Promise(() => undefined));
    await renderWithProviders(<StartupSplash />, { api, session: manager });
    await flush();
    expect(hide).not.toHaveBeenCalled();
    await report('ready');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('releases the native splash anyway if the animation never reports a frame', async () => {
    const manager = createControllableManager({ status: 'restoring' });
    await renderWithProviders(<StartupSplash />, { session: manager });
    await flush();
    expect(hide).not.toHaveBeenCalled();
    await advance(SPLASH_VIDEO_FIRST_FRAME_LIMIT_MS + 100);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('leaves exactly once, after the animation, when the session is known', async () => {
    beginSplash();
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(
      <>
        <StartupSplash />
        <PhaseProbe />
      </>,
      { session: manager },
    );
    await flush();
    await report('ready');
    expect(screen.getByText('showing', { includeHiddenElements: true })).toBeOnTheScreen();
    // Still playing: the session being known early does not cut the animation short.
    await advance(SPLASH_VIDEO_MS / 2);
    expect(screen.getByTestId('startup-splash')).toBeOnTheScreen();
    await report('ended');
    await advance(SPLASH_EXIT_FADE_MS + 500);
    expect(screen.getByText('finished', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('startup-splash')).toBeNull();
  });

  it('stops waiting for a slow session check at the limit, without signing anyone in', async () => {
    const manager = createControllableManager({ status: 'restoring' });
    await renderWithProviders(
      <>
        <StartupSplash />
        <PhaseProbe />
      </>,
      { session: manager },
    );
    await flush();
    await report('ready');
    await report('ended');
    await advance(SPLASH_READY_LIMIT_MS - 1000);
    expect(screen.getByTestId('startup-splash')).toBeOnTheScreen();
    await advance(1500 + SPLASH_EXIT_FADE_MS + 500);
    expect(screen.queryByTestId('startup-splash')).toBeNull();
    // The splash left; the account did not change: screens keep waiting for the real answer.
    expect(manager.getState()).toEqual({ status: 'restoring' });
  });

  it('gives up on an animation that never ends, without holding the shop closed', async () => {
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(
      <>
        <StartupSplash />
        <PhaseProbe />
      </>,
      { session: manager },
    );
    await flush();
    await report('ready');
    await advance(SPLASH_VIDEO_MS + SPLASH_ANIMATION_FALLBACK_MS + SPLASH_EXIT_FADE_MS + 500);
    expect(screen.getByText('finished', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('startup-splash')).toBeNull();
  });

  it('leaves at once when the animation cannot play, and still hides the native splash', async () => {
    const manager = createControllableManager({ status: 'signed_out' });
    await renderWithProviders(
      <>
        <StartupSplash />
        <PhaseProbe />
      </>,
      { session: manager },
    );
    await flush();
    await report('failed');
    expect(hide).toHaveBeenCalledTimes(1);
    await advance(SPLASH_EXIT_FADE_MS + 500);
    expect(screen.queryByTestId('startup-splash')).toBeNull();
  });

  it('releases the native splash and the launch if it is unmounted early', async () => {
    beginSplash();
    const manager = createControllableManager({ status: 'restoring' });
    const view = await renderWithProviders(<StartupSplash />, { session: manager });
    expect(hide).not.toHaveBeenCalled();
    await view.unmount();
    expect(hide).toHaveBeenCalled();
    await renderWithProviders(<PhaseProbe />, { session: manager });
    expect(screen.getByText('finished', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});
