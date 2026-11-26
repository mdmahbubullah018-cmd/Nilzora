import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onOpenSupport, setSupportOpenState, type SupportOpenRequest } from '@/lib/support-events';
import { MobileTabBar } from './mobile-tab-bar';

const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

/** The wishlist provider is the tab bar's only source of the saved count. */
const saved = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/wishlist/wishlist-provider', () => ({
  useWishlistOptional: () => ({ count: saved.count }),
}));

const requests: SupportOpenRequest[] = [];
let stopListening: () => void = () => undefined;

beforeEach(() => {
  navigation.pathname = '/';
  saved.count = 0;
  setSupportOpenState(false);
  requests.length = 0;
  stopListening = onOpenSupport((request) => requests.push(request));
});

afterEach(() => {
  stopListening();
});

function tabBar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Bottom navigation' });
}

function links(): HTMLElement[] {
  return within(tabBar()).getAllByRole('link');
}

function chatButton(): HTMLElement {
  return within(tabBar()).getByRole('button', { name: 'Chat' });
}

describe('MobileTabBar', () => {
  it('offers exactly Home, Categories, Wishlist, Chat and Account, in that order', () => {
    render(<MobileTabBar />);

    expect(links().map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/categories',
      '/wishlist',
      '/account',
    ]);
    const items = Array.from(tabBar().querySelectorAll('li'));
    expect(items.map((item) => item.textContent)).toEqual([
      'Home',
      'Categories',
      'Wishlist',
      'Chat',
      'Account',
    ]);
  });

  it('no longer offers a cart tab', () => {
    render(<MobileTabBar />);

    expect(within(tabBar()).queryByRole('link', { name: /^Cart/ })).toBeNull();
  });

  it.each([
    ['/', 'Home'],
    ['/categories', 'Categories'],
    ['/categories/sarees', 'Categories'],
    ['/wishlist', 'Wishlist'],
    ['/account', 'Account'],
    ['/account/orders', 'Account'],
  ])('marks the current tab on %s', (pathname, label) => {
    navigation.pathname = pathname;
    render(<MobileTabBar />);

    for (const link of links()) {
      const current = link.getAttribute('aria-current');
      if (link.textContent === label) expect(current).toBe('page');
      else expect(current).toBeNull();
    }
    expect(chatButton().getAttribute('data-active')).toBeNull();
  });

  it('shows the saved-product count on the Wishlist item from the shared state', () => {
    saved.count = 3;
    render(<MobileTabBar />);

    const wishlist = within(tabBar()).getByRole('link', {
      name: 'Wishlist, 3 saved products',
    });
    expect(within(wishlist).getByText('3')).not.toBeNull();
  });

  it('opens the existing support panel through the shared event', () => {
    render(<MobileTabBar />);

    expect(requests).toHaveLength(0);
    act(() => {
      chatButton().click();
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toStrictEqual({});
  });

  it('shows Chat as current while the panel is open, and does not reset an open conversation', () => {
    render(<MobileTabBar />);

    act(() => setSupportOpenState(true));
    expect(chatButton().getAttribute('data-active')).toBe('true');

    act(() => {
      chatButton().click();
    });
    // Already open: the widget keeps the conversation instead of jumping back to the list.
    expect(requests).toHaveLength(0);

    act(() => setSupportOpenState(false));
    expect(chatButton().getAttribute('data-active')).toBeNull();
  });

  it('is the strip across the foot of the screen, not a floating dock', () => {
    render(<MobileTabBar />);

    const bar = tabBar();
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).toContain('border-t');
    expect(bar.className).not.toMatch(/rounded-|bottom-3|bottom-4/);
  });

  it('marks the current tab with a tint, never by filling its icon in', () => {
    navigation.pathname = '/wishlist';
    render(<MobileTabBar />);

    for (const link of links()) {
      const icon = link.querySelector('[data-tab-icon] svg');
      // One outline weight everywhere: the tint on the icon box and the heavier label are the
      // only signals, so the bar keeps a single visual weight.
      expect(icon?.getAttribute('class') ?? '').not.toContain('fill-current');
    }

    const currentIcon = within(tabBar())
      .getByRole('link', { name: /^Wishlist/ })
      .querySelector('[data-tab-icon]');
    expect(currentIcon?.className).toContain('bg-primary/12');
  });
});
