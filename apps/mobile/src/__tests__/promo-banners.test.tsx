import type { Banner } from '@nilzora/contracts';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import {
  bannerLabel,
  HERO_AUTO_ADVANCE_MS,
  PromoCarousel,
  PromoRow,
} from '../features/catalog/promo-carousel';
import { WRAP_FADE_OUT_MS } from '../features/catalog/use-auto-pager';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * Banner words are optional: a picture-only banner is just the picture, named for screen readers
 * by the admin's picture description; a banner with words draws them on the artwork in a ~96%
 * transparent container (a 4% wash), so nothing opaque is ever laid over the picture.
 *
 * Two or more banners move on by themselves every four seconds and wrap; one banner sits still.
 * The dots are the only thing a test can see of that (the scroll itself is native), which is
 * also what a shopper sees.
 *
 * The suite runs with "reduce motion" on (see jest-setup.ts), so every test that needs the
 * clock turns it off first with allowMotion().
 */

const PREFIX = '0b000000-0000-4000-8000-00000000000';

function make(overrides: Partial<Banner>): Banner {
  return {
    id: `${PREFIX}1`,
    placement: 'home_hero',
    title: '',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: { url: 'https://media.test/b/full.webp', thumbUrl: 'https://media.test/b/thumb.webp' },
    categorySlug: null,
    ...overrides,
  };
}

/** Turns the suite's default "reduce motion" off for every reader of the setting. */
function allowMotion(): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
}

afterEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

const two = () => [make({ title: 'First' }), make({ id: `${PREFIX}2`, title: 'Second' })];
const dot = (index: number) => screen.getByTestId(`banner-dot-${String(index)}`);

/** Advances the fake clock and lets React flush what the timer scheduled. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/*
 * RN's own jest mocks for AppState and AccessibilityInfo are jest.fn()s with an implementation;
 * a spy's mockRestore would wipe it, so the tests read the mocks' calls and only clear them.
 */
const appStateMock = () =>
  (AppState as unknown as { addEventListener: jest.Mock }).addEventListener;
const motionMock = () =>
  (AccessibilityInfo as unknown as { addEventListener: jest.Mock }).addEventListener;

/** The handler the carousel registered for app-state changes. */
function appStateChange(): (state: string) => void {
  const call = appStateMock().mock.calls.find(([type]) => type === 'change') as
    [string, (state: string) => void] | undefined;
  if (call === undefined) throw new Error('The carousel never listened for app-state changes.');
  return call[1];
}

/** Counts the carousel's interval timers (the only setInterval in these renders). */
function watchClock() {
  const set = jest.spyOn(globalThis, 'setInterval');
  const clear = jest.spyOn(globalThis, 'clearInterval');
  return {
    started: () => set.mock.calls.filter(([, ms]) => ms === HERO_AUTO_ADVANCE_MS).length,
    cleared: () => clear.mock.calls.length,
    stop: () => {
      set.mockRestore();
      clear.mockRestore();
    },
  };
}

describe('bannerLabel', () => {
  it('speaks the words when there are any, else the picture description', () => {
    expect(
      bannerLabel(make({ title: 'Eid edit', subtitle: 'Fresh arrivals', ctaLabel: 'Shop' })),
    ).toBe('Eid edit. Fresh arrivals. Shop');
    expect(bannerLabel(make({ imageAlt: 'Two cotton sarees' }))).toBe('Two cotton sarees');
    expect(bannerLabel(make({}))).toBe('Promotion');
  });
});

describe('PromoCarousel and PromoRow', () => {
  it('shows a picture-only banner with no caption, named by its picture description', async () => {
    await renderWithProviders(
      <PromoCarousel banners={[make({ imageAlt: 'Two cotton sarees' })]} onOpen={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Two cotton sarees' })).toBeOnTheScreen();
    expect(screen.queryByText('Shop now')).toBeNull();
  });

  it('shows heading, text and button in a caption when they are set', async () => {
    await renderWithProviders(
      <PromoCarousel
        banners={[
          make({
            title: 'Winter sale',
            subtitle: 'Up to 30% off',
            ctaLabel: 'Shop now',
            ctaHref: '/products',
          }),
        ]}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByText('Winter sale')).toBeOnTheScreen();
    expect(screen.getByText('Up to 30% off')).toBeOnTheScreen();
    expect(screen.getByText('Shop now')).toBeOnTheScreen();
  });

  it('draws only the parts that exist in the compact campaign row', async () => {
    await renderWithProviders(
      <PromoRow banners={[make({ title: 'Eid edit' })]} onOpen={jest.fn()} />,
    );
    expect(screen.getByText('Eid edit')).toBeOnTheScreen();
    expect(screen.queryByText('Shop now')).toBeNull();
  });

  it('renders nothing for no banners', async () => {
    await renderWithProviders(<PromoCarousel banners={[]} onOpen={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the banner that was tapped', async () => {
    const onOpen = jest.fn();
    const banners = two();
    const { user } = await renderWithProviders(<PromoCarousel banners={banners} onOpen={onOpen} />);

    await user.press(screen.getByRole('button', { name: 'Second. Promotion 2 of 2' }));
    expect(onOpen).toHaveBeenCalledWith(banners[1]);
  });

  it("draws a banner's words on the artwork in a ~96% transparent overlay, with no shadow", async () => {
    await renderWithProviders(
      <PromoCarousel
        banners={[make({ title: 'Winter sale', subtitle: 'Up to 30% off' })]}
        onOpen={jest.fn()}
      />,
    );

    const caption = screen.getByTestId('banner-caption');
    expect(caption).toHaveStyle({
      position: 'absolute',
      backgroundColor: 'rgba(255,255,255,0.04)',
    });
    // White type over a navy fade, never a shadow and never a solid panel over the picture.
    const title = screen.getByText('Winter sale');
    expect(title).toHaveStyle({ color: '#FFFFFF' });
    expect((title.props.style as { textShadowColor?: unknown }).textShadowColor).toBeUndefined();
  });

  it('uses a wide frame and leaves a picture-only banner without an overlay', async () => {
    await renderWithProviders(
      <PromoCarousel banners={[make({ imageAlt: 'Two cotton sarees' })]} onOpen={jest.fn()} />,
    );

    expect(screen.queryByTestId('banner-caption')).toBeNull();
    // 12:5: a wide, horizontal strip rather than the 16:9 poster it used to be.
    expect(JSON.stringify(screen.toJSON())).toContain('"aspectRatio":2.4');
  });
});

describe('PromoCarousel auto-advance', () => {
  it('moves to the next banner every four seconds and wraps back to the first', async () => {
    jest.useFakeTimers();
    allowMotion();
    try {
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);

      expect(dot(0)).toHaveStyle({ width: 18 });

      await tick(HERO_AUTO_ADVANCE_MS);
      expect(dot(1)).toHaveStyle({ width: 18 });
      expect(dot(0)).toHaveStyle({ width: 4 });

      await tick(HERO_AUTO_ADVANCE_MS);
      expect(dot(1)).toHaveStyle({ width: 18 });
      await tick(WRAP_FADE_OUT_MS);
      expect(dot(0)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not animate a single banner', async () => {
    jest.useFakeTimers();
    allowMotion();
    const clock = watchClock();
    try {
      await renderWithProviders(
        <PromoCarousel banners={[make({ title: 'Only' })]} onOpen={jest.fn()} />,
      );

      await tick(HERO_AUTO_ADVANCE_MS * 3);
      // One banner has nowhere to go: no dots, and no clock was ever started.
      expect(screen.queryByTestId('banner-dot-0')).toBeNull();
      expect(clock.started()).toBe(0);
    } finally {
      clock.stop();
      jest.useRealTimers();
    }
  });

  it('does not advance by itself when the device asks for reduced motion', async () => {
    jest.useFakeTimers();
    const clock = watchClock();
    try {
      // The suite default: reduced motion is on.
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);

      await tick(HERO_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });
      expect(clock.started()).toBe(0);
    } finally {
      clock.stop();
      jest.useRealTimers();
    }
  });

  it('stops while the app is in the background and starts again when it returns', async () => {
    jest.useFakeTimers();
    allowMotion();
    appStateMock().mockClear();
    try {
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);
      const change = appStateChange();

      await act(() => {
        change('background');
      });
      await tick(HERO_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await act(() => {
        change('inactive');
      });
      await tick(HERO_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await act(() => {
        change('active');
      });
      await tick(HERO_AUTO_ADVANCE_MS);
      expect(dot(1)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('pauses while a finger is down and waits a full interval after it lifts', async () => {
    jest.useFakeTimers();
    allowMotion();
    try {
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);
      const row = screen.getByTestId('promo-row');

      await tick(HERO_AUTO_ADVANCE_MS - 500);
      await fireEvent(row, 'scrollBeginDrag');
      // Held for much longer than an interval: nothing moves under the thumb.
      await tick(HERO_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await fireEvent(row, 'scrollEndDrag');
      // The clock was restarted, so the old half-spent wait does not fire early.
      await tick(HERO_AUTO_ADVANCE_MS - 500);
      expect(dot(0)).toHaveStyle({ width: 18 });
      await tick(500);
      expect(dot(1)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('follows the page a swipe settled on', async () => {
    jest.useFakeTimers();
    allowMotion();
    try {
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);
      const row = screen.getByTestId('promo-row');

      await fireEvent(row, 'scrollBeginDrag');
      await fireEvent(row, 'scrollEndDrag');
      await fireEvent(row, 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: row.props.snapToInterval as number, y: 0 } },
      });
      expect(dot(1)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops the clock when reduced motion is switched on while the screen is open', async () => {
    jest.useFakeTimers();
    allowMotion();
    motionMock().mockClear();
    try {
      await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);
      // Every reader of the setting (the carousel and each card's press feedback) is told.
      const listeners = motionMock()
        .mock.calls.filter(([type]) => type === 'reduceMotionChanged')
        .map(([, handler]) => handler as (enabled: boolean) => void);
      expect(listeners.length).toBeGreaterThan(0);

      await tick(HERO_AUTO_ADVANCE_MS);
      expect(dot(1)).toHaveStyle({ width: 18 });

      await act(() => {
        for (const notify of listeners) notify(true);
      });
      await tick(HERO_AUTO_ADVANCE_MS * 3);
      // Still on the page it had reached: nothing moved after the setting changed.
      expect(dot(1)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears its timer and its app-state subscription on unmount', async () => {
    jest.useFakeTimers();
    allowMotion();
    const clock = watchClock();
    appStateMock().mockClear();
    try {
      const view = await renderWithProviders(<PromoCarousel banners={two()} onOpen={jest.fn()} />);
      expect(clock.started()).toBeGreaterThan(0);
      const subscription = appStateMock().mock.results[0]?.value as { remove: jest.Mock };

      await view.unmount();
      expect(clock.cleared()).toBeGreaterThanOrEqual(1);
      expect(subscription.remove).toHaveBeenCalled();
    } finally {
      clock.stop();
      jest.useRealTimers();
    }
  });
});
