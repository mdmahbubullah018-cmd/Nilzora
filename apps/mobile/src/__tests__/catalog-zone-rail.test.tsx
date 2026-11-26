import type { ShoppingZone } from '@nilzora/contracts';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { WRAP_FADE_OUT_MS } from '../features/catalog/use-auto-pager';
import {
  shoppableZones,
  ZONE_AUTO_ADVANCE_MS,
  zoneBannerHeight,
  zoneCardWidth,
  ZoneSection,
} from '../features/catalog/zone-section';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * "Shop by collection" on Home: a full-width banner carousel.
 *
 * A collection with nothing on the shelf is left out, and a failed read draws nothing at all:
 * the rest of the Home screen works without it. A collection is tappable and opens the Shop on
 * it by its slug. Every word on a banner comes from the collection; two or more advance by
 * themselves (never with reduced motion, never while a finger is down or the app is away).
 */

function zone(overrides: Partial<ShoppingZone> = {}): ShoppingZone {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 4,
    ...overrides,
  };
}

const three = () => [
  zone(),
  zone({ id: '3f2a1b4c-0000-4000-8000-000000000002', slug: 'womens', name: "Women's" }),
  zone({ id: '3f2a1b4c-0000-4000-8000-000000000003', slug: 'kids', name: 'Kids' }),
];

function section(zones: readonly ShoppingZone[]) {
  return {
    status: 'success' as const,
    data: zones,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  };
}

/** Turns the suite's default "reduce motion" off for every reader of the setting. */
function allowMotion(): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
}

afterEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

const dot = (index: number) => screen.getByTestId(`zone-dot-${String(index)}`);

/** Advances the fake clock and lets React flush what the timer scheduled. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

// RN's jest mock for AppState is a jest.fn with an implementation: clear it, never restore it.
const appStateMock = () =>
  (AppState as unknown as { addEventListener: jest.Mock }).addEventListener;

function appStateChange(): (state: string) => void {
  const call = appStateMock().mock.calls.find(([type]) => type === 'change') as
    [string, (state: string) => void] | undefined;
  if (call === undefined) throw new Error('The carousel never listened for app-state changes.');
  return call[1];
}

function watchClock() {
  const set = jest.spyOn(globalThis, 'setInterval');
  const clear = jest.spyOn(globalThis, 'clearInterval');
  return {
    started: () => set.mock.calls.filter(([, ms]) => ms === ZONE_AUTO_ADVANCE_MS).length,
    cleared: () => clear.mock.calls.length,
    stop: () => {
      set.mockRestore();
      clear.mockRestore();
    },
  };
}

describe('which collections may be shown', () => {
  it('keeps those with something on the shelf', () => {
    expect(shoppableZones([zone(), zone({ slug: 'empty', productCount: 0 })])).toHaveLength(1);
  });
});

describe('the collection banner carousel', () => {
  it('shows each collection with its count, and opens the shop on its slug', async () => {
    const onSelect = jest.fn();
    const { user } = await renderWithProviders(
      <ZoneSection query={section([zone()])} onSelect={onSelect} />,
    );

    expect(screen.getByText('Shop by collection')).toBeOnTheScreen();
    const banner = screen.getByRole('button', {
      name: "Shop the Men's, 4 products. Collection 1 of 1",
    });
    expect(banner).toBeOnTheScreen();
    // Real words only: the name, the count (no description here) and the constant "Shop" label.
    expect(screen.getByText("Men's")).toBeOnTheScreen();
    expect(screen.getByText('4 products')).toBeOnTheScreen();
    expect(screen.getByText('Shop')).toBeOnTheScreen();

    await user.press(banner);
    expect(onSelect).toHaveBeenCalledWith('mens');
  });

  it('opens the shop on the slug of the banner that was tapped', async () => {
    const onSelect = jest.fn();
    const { user } = await renderWithProviders(
      <ZoneSection query={section(three())} onSelect={onSelect} />,
    );

    await user.press(
      screen.getByRole('button', { name: "Shop the Women's, 4 products. Collection 2 of 3" }),
    );
    expect(onSelect).toHaveBeenLastCalledWith('womens');
    await user.press(
      screen.getByRole('button', { name: 'Shop the Kids, 4 products. Collection 3 of 3' }),
    );
    expect(onSelect).toHaveBeenLastCalledWith('kids');
  });

  it('shows the description as the supporting line when the collection has one', async () => {
    await renderWithProviders(
      <ZoneSection
        query={section([zone({ description: 'Shirts, trousers and more' })])}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText('Shirts, trousers and more')).toBeOnTheScreen();
  });

  it('draws nothing when no collection can be shopped', async () => {
    await renderWithProviders(
      <ZoneSection query={section([zone({ productCount: 0 })])} onSelect={jest.fn()} />,
    );

    expect(screen.queryByText('Shop by collection')).not.toBeOnTheScreen();
  });

  it('fills the banner with the app artwork when the zone has one', async () => {
    const mobileBanner = {
      url: 'https://media.test/zone-mobile-banners/z/full.webp',
      thumbUrl: 'https://media.test/zone-mobile-banners/z/thumb.webp',
    };
    const banner = {
      url: 'https://media.test/zone-banners/z/full.webp',
      thumbUrl: 'https://media.test/zone-banners/z/thumb.webp',
    };
    const view = await renderWithProviders(
      <ZoneSection query={section([zone({ banner, mobileBanner })])} onSelect={jest.fn()} />,
    );

    const tree = JSON.stringify(view.toJSON());
    expect(tree).toContain(mobileBanner.url);
    expect(tree).not.toContain(banner.url);
  });

  it('falls back to the website picture when the zone has no app artwork', async () => {
    const banner = {
      url: 'https://media.test/zone-banners/z/full.webp',
      thumbUrl: 'https://media.test/zone-banners/z/thumb.webp',
    };
    const view = await renderWithProviders(
      <ZoneSection query={section([zone({ banner })])} onSelect={jest.fn()} />,
    );

    expect(JSON.stringify(view.toJSON())).toContain(banner.url);
  });

  it('falls back to the branded tile when the picture fails to load', async () => {
    const banner = {
      url: 'https://media.test/zone-banners/z/full.webp',
      thumbUrl: 'https://media.test/zone-banners/z/thumb.webp',
    };
    const view = await renderWithProviders(
      <ZoneSection query={section([zone({ banner })])} onSelect={jest.fn()} />,
    );
    await fireEvent(screen.getByTestId('zone-banner-image'), 'error');

    expect(JSON.stringify(view.toJSON())).not.toContain(banner.url);
    // The words are still there.
    expect(screen.getByText("Men's")).toBeOnTheScreen();
  });

  it('draws nothing when the read failed, leaving the rest of Home alone', async () => {
    await renderWithProviders(
      <ZoneSection
        query={{
          status: 'error',
          data: undefined,
          error: new Error('offline'),
          refetch: jest.fn(),
          isRefetching: false,
        }}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByText('Shop by collection')).not.toBeOnTheScreen();
  });

  it('is one full-width, paged banner per collection with dots, and nothing hardcoded', async () => {
    const view = await renderWithProviders(
      <ZoneSection query={section(three())} onSelect={jest.fn()} />,
    );

    // Every collection is rendered from the data, so nothing is hardcoded to a number or a name.
    expect(screen.getAllByRole('button', { name: /^Shop the / })).toHaveLength(3);
    const row = screen.getByTestId('zone-row');
    expect(row.props.horizontal).toBe(true);
    expect(row.props.pagingEnabled).toBe(true);
    // One banner per page: the step is a banner plus the gap, not a half-card rail.
    expect(row.props.snapToInterval).toBe(zoneCardWidth(750) + 12);
    expect(JSON.stringify(view.toJSON())).toContain(
      `"height":${String(zoneBannerHeight(zoneCardWidth(750)))}`,
    );
    expect(screen.getAllByTestId(/^zone-dot-/)).toHaveLength(3);
  });

  it('sizes a banner to the content width of the page', () => {
    // 390 - 2 * 20 screen padding.
    expect(zoneCardWidth(390)).toBe(350);
    expect(zoneCardWidth(360)).toBe(320);
    expect(zoneCardWidth(412)).toBe(372);
  });

  it('shows no dots for a single collection', async () => {
    await renderWithProviders(<ZoneSection query={section([zone()])} onSelect={jest.fn()} />);

    expect(screen.queryByTestId('zone-dot-0')).toBeNull();
  });
});

describe('the collection carousel auto-advance', () => {
  it('moves on every 4.5 seconds and wraps back to the first', async () => {
    jest.useFakeTimers();
    allowMotion();
    try {
      await renderWithProviders(<ZoneSection query={section(three())} onSelect={jest.fn()} />);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await tick(ZONE_AUTO_ADVANCE_MS - 1);
      expect(dot(0)).toHaveStyle({ width: 18 });
      await tick(1);
      expect(dot(1)).toHaveStyle({ width: 18 });
      await tick(ZONE_AUTO_ADVANCE_MS);
      expect(dot(2)).toHaveStyle({ width: 18 });
      await tick(ZONE_AUTO_ADVANCE_MS);
      // The wrap is a quick fade, not a sweep: the dots follow once the carousel has faded out.
      expect(dot(2)).toHaveStyle({ width: 18 });
      await tick(WRAP_FADE_OUT_MS);
      expect(dot(0)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('never starts a clock for a single collection', async () => {
    jest.useFakeTimers();
    allowMotion();
    const clock = watchClock();
    try {
      await renderWithProviders(<ZoneSection query={section([zone()])} onSelect={jest.fn()} />);
      await tick(ZONE_AUTO_ADVANCE_MS * 3);

      expect(clock.started()).toBe(0);
    } finally {
      clock.stop();
      jest.useRealTimers();
    }
  });

  it('does not advance when the device asks for reduced motion', async () => {
    jest.useFakeTimers();
    const clock = watchClock();
    try {
      await renderWithProviders(<ZoneSection query={section(three())} onSelect={jest.fn()} />);
      await tick(ZONE_AUTO_ADVANCE_MS * 3);

      expect(dot(0)).toHaveStyle({ width: 18 });
      expect(clock.started()).toBe(0);
    } finally {
      clock.stop();
      jest.useRealTimers();
    }
  });

  it('pauses while the app is in the background and resumes when it is active again', async () => {
    jest.useFakeTimers();
    allowMotion();
    appStateMock().mockClear();
    try {
      await renderWithProviders(<ZoneSection query={section(three())} onSelect={jest.fn()} />);
      const change = appStateChange();

      await act(() => {
        change('background');
      });
      await tick(ZONE_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await act(() => {
        change('active');
      });
      await tick(ZONE_AUTO_ADVANCE_MS);
      expect(dot(1)).toHaveStyle({ width: 18 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('pauses while dragging and restarts a full wait afterwards', async () => {
    jest.useFakeTimers();
    allowMotion();
    try {
      await renderWithProviders(<ZoneSection query={section(three())} onSelect={jest.fn()} />);
      const row = screen.getByTestId('zone-row');

      await tick(ZONE_AUTO_ADVANCE_MS - 500);
      await fireEvent(row, 'scrollBeginDrag');
      await tick(ZONE_AUTO_ADVANCE_MS * 3);
      expect(dot(0)).toHaveStyle({ width: 18 });

      await fireEvent(row, 'scrollEndDrag');
      await tick(ZONE_AUTO_ADVANCE_MS - 500);
      expect(dot(0)).toHaveStyle({ width: 18 });
      await tick(500);
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
      const view = await renderWithProviders(
        <ZoneSection query={section(three())} onSelect={jest.fn()} />,
      );
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
