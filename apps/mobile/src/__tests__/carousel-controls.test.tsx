import type { Banner, ShoppingZone } from '@nilzora/contracts';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type * as ReactNs from 'react';
import type * as ReactNative from 'react-native';
import { AccessibilityInfo, Dimensions } from 'react-native';
import { resetAutoplayChoices } from '../features/catalog/autoplay-choice';
import { PromoCarousel } from '../features/catalog/promo-carousel';
import { WRAP_FADE_IN_MS, WRAP_FADE_OUT_MS } from '../features/catalog/use-auto-pager';
import { ZONE_AUTO_ADVANCE_MS, ZoneSection, zoneCardWidth } from '../features/catalog/zone-section';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { styleOf } from '../test-utils/style-of';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * The scroll itself is native, so the scroller is replaced by a plain view that exposes
 * scrollTo(): it is how these tests see WHAT the carousel asked the scroller to do (an animated
 * move to the next page, a jump with no animation, or nothing at all).
 */
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = jest.requireActual<typeof ReactNs>('react');
  const Host = jest.requireActual<typeof ReactNative>('react-native').View;
  const Scroller = React.forwardRef((props: object, ref: React.Ref<unknown>) => {
    const attach = (instance: unknown) => {
      const handle =
        instance === null
          ? null
          : Object.assign(instance as object, {
              scrollTo: (...args: unknown[]) =>
                (globalThis as { __scrollTo?: (...a: unknown[]) => void }).__scrollTo?.(...args),
            });
      if (typeof ref === 'function') ref(handle);
      else if (ref) (ref as { current: unknown }).current = handle;
    };
    return <Host {...props} ref={attach} />;
  });
  Scroller.displayName = 'MockScrollView';
  return { __esModule: true, default: Scroller };
});

const scrollTo = jest.fn();

function zone(n: number): ShoppingZone {
  return {
    id: `3f2a1b4c-0000-4000-8000-00000000000${String(n)}`,
    slug: `zone-${String(n)}`,
    name: `Zone ${String(n)}`,
    description: null,
    audience: 'all',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: n,
  };
}

const zones = (count: number) => Array.from({ length: count }, (_, index) => zone(index + 1));

function section(data: readonly ShoppingZone[]) {
  return {
    status: 'success' as const,
    data,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  };
}

function banner(n: number): Banner {
  return {
    id: `3f2a1b4c-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
    placement: 'home_hero',
    title: `Banner ${String(n)}`,
    subtitle: null,
    ctaLabel: null,
    image: { url: 'https://media.test/b.webp', thumbUrl: 'https://media.test/bt.webp' },
    mobileImage: null,
    imageAlt: null,
    linkType: 'none',
    linkValue: null,
  } as unknown as Banner;
}

function listener(event: string): (value: boolean) => void {
  const calls = (AccessibilityInfo.addEventListener as unknown as jest.Mock).mock.calls as [
    string,
    (value: boolean) => void,
  ][];
  const found = [...calls].reverse().find(([name]) => name === event);
  if (found === undefined) throw new Error(`Nothing listened for ${event}.`);
  return found[1];
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

const dot = (index: number) => screen.getByTestId(`zone-dot-${String(index)}`);
const toggle = () => screen.queryByTestId('zone-autoplay-toggle');
const animatedMoves = (): unknown[][] =>
  (scrollTo.mock.calls as unknown[][]).filter(
    ([options]) => (options as { animated: boolean }).animated,
  );

let announce: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  resetAutoplayChoices();
  scrollTo.mockClear();
  (globalThis as { __scrollTo?: unknown }).__scrollTo = scrollTo;
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  // Motion allowed, no screen reader: the common phone.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  announce.mockRestore();
});

describe('the Pause / Play control on the collection carousel', () => {
  it('is a labelled, 44 dp button once there is something to pause', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);

    const control = screen.getByRole('button', { name: 'Pause collection slideshow' });
    const style = styleOf(control);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });

  it('is not drawn for a single collection, where nothing advances', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(1))} onSelect={jest.fn()} />);

    expect(toggle()).toBeNull();
  });

  it('is not drawn when the device asks for reduced motion: nothing moves, so nothing to pause', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    await tick(ZONE_AUTO_ADVANCE_MS * 3);

    expect(toggle()).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stops the slideshow, says so, and starts it again on Play', async () => {
    const { user } = await renderWithProviders(
      <ZoneSection query={section(zones(3))} onSelect={jest.fn()} />,
    );
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(1)).toHaveStyle({ width: 18 });

    await user.press(screen.getByRole('button', { name: 'Pause collection slideshow' }));
    expect(announce).toHaveBeenLastCalledWith('Paused collection slideshow');
    expect(screen.getByRole('button', { name: 'Play collection slideshow' })).toBeOnTheScreen();
    scrollTo.mockClear();
    await tick(ZONE_AUTO_ADVANCE_MS * 4);
    expect(dot(1)).toHaveStyle({ width: 18 });
    expect(scrollTo).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Play collection slideshow' }));
    expect(announce).toHaveBeenLastCalledWith('Playing collection slideshow');
    expect(screen.getByRole('button', { name: 'Pause collection slideshow' })).toBeOnTheScreen();
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(2)).toHaveStyle({ width: 18 });
  });

  it('remembers the choice for the session when the screen is left and opened again', async () => {
    const first = await renderWithProviders(
      <ZoneSection query={section(zones(3))} onSelect={jest.fn()} />,
    );
    await first.user.press(screen.getByRole('button', { name: 'Pause collection slideshow' }));
    await first.unmount();

    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Play collection slideshow' })).toBeOnTheScreen();
    await tick(ZONE_AUTO_ADVANCE_MS * 3);
    expect(dot(0)).toHaveStyle({ width: 18 });
    expect(animatedMoves()).toHaveLength(0);
  });

  it('keeps the two carousels on Home independent', async () => {
    const view = await renderWithProviders(
      <>
        <ZoneSection query={section(zones(3))} onSelect={jest.fn()} />
        <PromoCarousel banners={[banner(1), banner(2)]} onOpen={jest.fn()} />
      </>,
    );
    await view.user.press(screen.getByRole('button', { name: 'Pause collection slideshow' }));

    expect(screen.getByRole('button', { name: 'Pause promotion slideshow' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Play collection slideshow' })).toBeOnTheScreen();
  });
});

describe('a screen reader', () => {
  it('starts the slideshow paused, and a shopper who presses Play gets it', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const { user } = await renderWithProviders(
      <ZoneSection query={section(zones(3))} onSelect={jest.fn()} />,
    );
    await tick(ZONE_AUTO_ADVANCE_MS * 3);
    expect(animatedMoves()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Play collection slideshow' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Play collection slideshow' }));
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(1)).toHaveStyle({ width: 18 });
  });

  it('stops the slideshow when one is switched on while the screen is open', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(1)).toHaveStyle({ width: 18 });

    await act(() => {
      listener('screenReaderChanged')(true);
    });
    await tick(ZONE_AUTO_ADVANCE_MS * 3);
    expect(dot(1)).toHaveStyle({ width: 18 });
  });

  it('never has a live region on a carousel, so an automatic move is never announced', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    await tick(ZONE_AUTO_ADVANCE_MS * 2);

    expect(JSON.stringify(screen.toJSON())).not.toContain('accessibilityLiveRegion');
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('reduced motion', () => {
  it('never advances, never animates a scroll and starts no timer', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    try {
      await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
      await tick(ZONE_AUTO_ADVANCE_MS * 5);

      expect(scrollTo).not.toHaveBeenCalled();
      expect(setIntervalSpy.mock.calls.filter(([, ms]) => ms === ZONE_AUTO_ADVANCE_MS)).toEqual([]);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('takes effect at once when the setting is switched on or off while the screen is open', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(1)).toHaveStyle({ width: 18 });
    expect(toggle()).not.toBeNull();

    await act(() => {
      listener('reduceMotionChanged')(true);
    });
    expect(toggle()).toBeNull();
    scrollTo.mockClear();
    await tick(ZONE_AUTO_ADVANCE_MS * 4);
    expect(dot(1)).toHaveStyle({ width: 18 });
    expect(scrollTo).not.toHaveBeenCalled();

    await act(() => {
      listener('reduceMotionChanged')(false);
    });
    expect(toggle()).not.toBeNull();
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(2)).toHaveStyle({ width: 18 });
  });
});

describe('wrapping from the last collection to the first', () => {
  it('fades and jumps instead of sweeping back across every page', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    const row = screen.getByTestId('zone-row');

    await tick(ZONE_AUTO_ADVANCE_MS * 2);
    expect(dot(2)).toHaveStyle({ width: 18 });
    expect(animatedMoves()).toHaveLength(2);
    scrollTo.mockClear();

    // The wrap tick starts a fade-out; nothing has scrolled yet.
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(scrollTo).not.toHaveBeenCalled();
    // Once it is invisible the carousel jumps: no animation, so no sweep.
    await tick(WRAP_FADE_OUT_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, animated: false });
    expect(dot(0)).toHaveStyle({ width: 18 });
    expect(animatedMoves()).toHaveLength(0);

    // And it fades back in to full opacity.
    await tick(WRAP_FADE_IN_MS + 50);
    expect(styleOf(row).opacity).toBe(1);
  });

  it('leaves the page where it is when a finger lands during the fade-out', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    const row = screen.getByTestId('zone-row');
    await tick(ZONE_AUTO_ADVANCE_MS * 3);
    scrollTo.mockClear();

    await fireEvent(row, 'scrollBeginDrag');
    await tick(WRAP_FADE_OUT_MS * 3);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(dot(2)).toHaveStyle({ width: 18 });
    expect(styleOf(row).opacity).toBe(1);
  });

  it('wraps the promotion carousel the same way', async () => {
    await renderWithProviders(
      <PromoCarousel banners={[banner(1), banner(2)]} onOpen={jest.fn()} />,
    );
    await tick(4000);
    scrollTo.mockClear();
    await tick(4000 + WRAP_FADE_OUT_MS);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, animated: false });
  });
});

describe('what a screen reader says', () => {
  it('names each slide with its collection, how many products it holds and its position', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(5))} onSelect={jest.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Shop the Zone 2, 2 products. Collection 2 of 5' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Shop the Zone 1, 1 product. Collection 1 of 5' }),
    ).toBeOnTheScreen();
  });

  it('keeps the pager dots out of the accessibility tree: they are decoration', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);

    const dots = dot(0).parent;
    expect(dots?.props.accessible).toBe(false);
    expect(dots?.props.importantForAccessibility).toBe('no');
  });

  it('names a promotion with its position when there are several, and plainly when there is one', async () => {
    const many = await renderWithProviders(
      <PromoCarousel banners={[banner(1), banner(2)]} onOpen={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Banner 2. Promotion 2 of 2' })).toBeOnTheScreen();
    await many.unmount();

    await renderWithProviders(<PromoCarousel banners={[banner(1)]} onOpen={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Banner 1' })).toBeOnTheScreen();
  });
});

describe('when the phone is rotated', () => {
  const original = Dimensions.get('window');
  afterEach(async () => {
    await act(() => {
      Dimensions.set({ window: original });
    });
  });

  it('stays on the same collection instead of landing between two pages', async () => {
    await renderWithProviders(<ZoneSection query={section(zones(3))} onSelect={jest.fn()} />);
    await tick(ZONE_AUTO_ADVANCE_MS);
    expect(dot(1)).toHaveStyle({ width: 18 });
    scrollTo.mockClear();

    await act(() => {
      Dimensions.set({ window: { ...original, width: 400 } });
    });

    expect(scrollTo).toHaveBeenCalledWith({ x: zoneCardWidth(400) + 12, animated: false });
  });
});
