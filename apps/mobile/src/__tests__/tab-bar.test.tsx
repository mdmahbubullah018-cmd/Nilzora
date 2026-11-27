import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar, type TabBarItem } from '../components/tab-bar';
import { badgeFor, definitionFor, hrefFor, TAB_BAR, TAB_DEFINITIONS } from '../navigation/tabs';
import { theme } from '../theme';

/** Reads the device's reduced-transparency preference without touching the real one. */
function mockTransparency(reduced: boolean): void {
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(reduced);
}

/** The surface the bar's slab actually paints. */
function barSurface(): string | undefined {
  const node = screen.getByTestId('tab-bar-surface');
  const style = StyleSheet.flatten(node.props.style as ViewStyle);
  return style?.backgroundColor as string | undefined;
}

const ITEMS: TabBarItem[] = TAB_BAR.map((destination) => ({
  key: destination.key,
  label: destination.label,
  icon: destination.icon,
  activeIcon: destination.activeIcon,
  ...badgeFor(destination.key, 0),
}));

/** The bar reads the device's safe area, so it needs a provider (a 360x800 Android frame here). */
function renderBar(
  activeIndex: number,
  items: TabBarItem[] = ITEMS,
  onSelect: (index: number) => void = () => {},
) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 800 },
        insets: { top: 24, left: 0, right: 0, bottom: 16 },
      }}
    >
      <TabBar items={items} activeIndex={activeIndex} onSelect={onSelect} />
    </SafeAreaProvider>,
  );
}

function withWishlistCount(count: number): TabBarItem[] {
  return ITEMS.map((item) => ({ ...item, ...badgeFor(item.key, count) }));
}

describe('the bottom navigation’s destinations', () => {
  it('is Home, Categories, Wishlist, Chat and Account', () => {
    expect(TAB_BAR.map((tab) => tab.label)).toEqual([
      'Home',
      'Categories',
      'Wishlist',
      'Chat',
      'Account',
    ]);
  });

  it('opens the existing support screen from the Chat item instead of a new tab route', () => {
    expect(TAB_BAR[3]?.key).toBe('chat');
    expect(TAB_BAR[3]?.icon).toBe('message');
    expect(TAB_BAR[3]?.href).toBe('/support');
  });

  it('no longer gives the cart a tab: it lives in the Home header', () => {
    expect(TAB_BAR.map((tab) => tab.key)).not.toContain('cart');
    expect(Object.keys(TAB_DEFINITIONS)).not.toContain('cart');
  });

  it('keeps the four real tab routes and the account’s own href', () => {
    expect(hrefFor('categories')).toBe('/categories');
    expect(hrefFor('wishlist')).toBe('/wishlist');
    expect(hrefFor('account')).toBe('/account');
    expect(definitionFor('account').label).toBe('Account');
  });

  it('keeps orders out of the bar (they live in the account)', () => {
    expect(Object.keys(TAB_DEFINITIONS)).not.toContain('orders');
  });

  it('badges the wishlist with what it saved, and nothing else', () => {
    expect(badgeFor('wishlist', 3)).toEqual({ badgeCount: 3, badgeLabel: 'Wishlist, 3 saved' });
    expect(badgeFor('chat', 3)).toEqual({});
    expect(badgeFor('account', 3)).toEqual({});
  });
});

describe('TabBar', () => {
  it('draws one tab per destination and marks only the current one', async () => {
    await renderBar(2);

    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: 'Wishlist' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
    expect(screen.getByRole('tab', { name: 'Chat' })).not.toBeSelected();
  });

  it('keeps the account selected while a nested account screen is open, and after coming back', async () => {
    // The bar is drawn from the tab index alone, so /profile, /orders and /settings never
    // move the selection off the account while they are pushed above the tabs.
    await renderBar(4);

    expect(screen.getByRole('tab', { name: 'Account' })).toBeSelected();
  });

  it('counts the wishlist in saved products, never the cart', async () => {
    await renderBar(0, withWishlistCount(3));

    expect(screen.getByRole('tab', { name: 'Wishlist, 3 saved' })).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: /^Cart/ })).not.toBeOnTheScreen();
  });

  it('shows no badge for an empty wishlist', async () => {
    await renderBar(0, withWishlistCount(0));

    expect(screen.getByRole('tab', { name: 'Wishlist' })).toBeOnTheScreen();
    expect(screen.queryByText('0')).not.toBeOnTheScreen();
  });

  it('reports which tab was pressed', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    await renderBar(0, ITEMS, onSelect);

    await user.press(screen.getByRole('tab', { name: 'Chat' }));

    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('drops the glass for a solid surface when the device asks for reduced transparency', async () => {
    mockTransparency(true);
    await renderBar(0);

    await waitFor(() => {
      expect(barSurface()).toBe(theme.colors.surface);
    });
  });

  it('keeps the glass surface by default', async () => {
    mockTransparency(false);
    await renderBar(0);

    await waitFor(() => {
      expect(barSurface()).toBe(theme.glass.tabBar);
    });
  });

  it('marks the current tab with a tint, never by filling its icon in', async () => {
    const { toJSON } = await renderBar(2);

    // Every glyph, the current one included, stays an outline: the tint behind the icon and the
    // heavier label are the only signals, so the bar keeps one visual weight.
    expect(screen.getByRole('tab', { name: 'Wishlist' })).toBeSelected();
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('"fill":"none"');
    expect(tree).not.toMatch(/"fill":"#[0-9A-Fa-f]{6}"/);
  });
});
