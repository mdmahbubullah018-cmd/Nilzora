import type { PublicPopup } from '@nilzora/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromoPopup } from './promo-popup';

/*
 * The storefront popup: when it may appear, when it must not, and what the customer sees.
 *
 * The delay and the frequency rule are the whole point of the feature, so they are the tests:
 * nothing before the delay, nothing twice under `once_per_session`, nothing on checkout, and a
 * popup that is gone once it is dismissed.
 */

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const popup: PublicPopup = {
  id: '0e000000-0000-4000-8000-000000000001',
  displayMode: 'template',
  imageUrl: 'https://media.nilzora.test/popups/x/y/full.webp',
  imageWidth: 1200,
  imageHeight: 860,
  isAnimated: false,
  imageAlt: 'Two cotton sarees in blue and gold',
  title: 'Eid on Nilzora',
  subtitle: null,
  description: null,
  buttonLabel: 'Shop the offer',
  buttonHref: '/categories/fashion',
  delaySeconds: 10,
  frequency: 'once_per_session',
  audience: 'all',
  priority: 0,
  endsAt: null,
};

beforeEach(() => {
  pathname.current = '/';
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PromoPopup', () => {
  it('shows nothing at all before the delay has passed', () => {
    vi.useFakeTimers();
    render(<PromoPopup popups={[popup]} signedIn={false} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('appears once the delay has passed, with the template copy and its action', () => {
    vi.useFakeTimers();
    render(<PromoPopup popups={[popup]} signedIn={false} />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Eid on Nilzora');
    expect(dialog.textContent).toContain('Shop the offer');
    // The picture is described for a screen reader.
    expect(screen.getByAltText('Two cotton sarees in blue and gold')).not.toBeNull();
  });

  it('closes when dismissed and remembers not to come back in this session', () => {
    vi.useFakeTimers();
    const { unmount } = render(<PromoPopup popups={[popup]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close this promotion' }));
    // The dialog is closed synchronously; the record is what stops a second appearance.
    expect(globalThis.sessionStorage.getItem(`nilzora.popup.${popup.id}`)).toBe('1');

    unmount();
    render(<PromoPopup popups={[popup]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('respects the daily rule across a reload', () => {
    vi.useFakeTimers();
    const daily = { ...popup, frequency: 'once_per_day' as const };
    const { unmount } = render(<PromoPopup popups={[daily]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(globalThis.localStorage.getItem(`nilzora.popup.${daily.id}`)).not.toBeNull();

    unmount();
    render(<PromoPopup popups={[daily]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows again on the next visit when the frequency is every visit', () => {
    vi.useFakeTimers();
    const everyVisit = { ...popup, frequency: 'every_visit' as const };
    const { unmount } = render(<PromoPopup popups={[everyVisit]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    // Nothing is written: the visitor may be shown it again.
    expect(globalThis.sessionStorage.getItem(`nilzora.popup.${everyVisit.id}`)).toBeNull();

    unmount();
    render(<PromoPopup popups={[everyVisit]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('shows a popup with no delay at once, and never twice under "once ever"', () => {
    vi.useFakeTimers();
    const once = { ...popup, delaySeconds: 0, frequency: 'once_ever' as const };
    const { unmount } = render(<PromoPopup popups={[once]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    // Unlike once-per-session, the record is in localStorage and survives a new session.
    expect(globalThis.localStorage.getItem(`nilzora.popup.${once.id}`)).not.toBeNull();

    unmount();
    globalThis.sessionStorage.clear();
    render(<PromoPopup popups={[once]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the highest-priority popup whose audience fits, and falls through to the next', () => {
    vi.useFakeTimers();
    const members = {
      ...popup,
      id: '0e000000-0000-4000-8000-0000000000a1',
      audience: 'logged_in' as const,
      title: 'Members only',
      priority: 9,
    };
    const guests = {
      ...popup,
      id: '0e000000-0000-4000-8000-0000000000a2',
      audience: 'guests' as const,
      title: 'Welcome, guest',
      priority: 5,
    };

    const first = render(<PromoPopup popups={[members, guests]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('dialog').textContent).toContain('Welcome, guest');
    first.unmount();
    globalThis.sessionStorage.clear();

    render(<PromoPopup popups={[members, guests]} signedIn />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('dialog').textContent).toContain('Members only');
  });

  it('skips a popup already shown on this device and offers the next one', () => {
    vi.useFakeTimers();
    const seen = {
      ...popup,
      id: '0e000000-0000-4000-8000-0000000000b1',
      title: 'Seen already',
      priority: 9,
    };
    const next = {
      ...popup,
      id: '0e000000-0000-4000-8000-0000000000b2',
      title: 'Not yet seen',
      priority: 1,
    };
    globalThis.sessionStorage.setItem(`nilzora.popup.${seen.id}`, '1');

    render(<PromoPopup popups={[seen, next]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByRole('dialog').textContent).toContain('Not yet seen');
  });

  it('never interrupts checkout or the sign-in flow', () => {
    vi.useFakeTimers();
    for (const route of ['/checkout', '/login', '/register', '/verify-otp']) {
      pathname.current = route;
      const { unmount } = render(<PromoPopup popups={[popup]} signedIn={false} />);
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
  });

  it('renders nothing when the store has no popup to show', () => {
    vi.useFakeTimers();
    render(<PromoPopup popups={[]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes itself when the artwork cannot be loaded, rather than leaving an empty card', () => {
    vi.useFakeTimers();
    render(<PromoPopup popups={[popup]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    fireEvent.error(screen.getByAltText('Two cotton sarees in blue and gold'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('draws a popup whose every word is empty as just its picture', () => {
    vi.useFakeTimers();
    const silent = {
      ...popup,
      title: null,
      subtitle: null,
      description: null,
      buttonLabel: null,
      buttonHref: null,
    };
    render(<PromoPopup popups={[silent]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    const dialog = screen.getByRole('dialog');
    expect(screen.getByAltText('Two cotton sarees in blue and gold')).not.toBeNull();
    // No empty button, no empty heading, no padded block for words that do not exist.
    expect(dialog.querySelector('a')).toBeNull();
    const visible = [...dialog.querySelectorAll('h2, p, a')]
      .filter((element) => element.closest('.sr-only') === null)
      .map((element) => element.textContent?.trim() ?? '')
      .filter((text) => text !== '');
    expect(visible).toEqual([]);
  });

  it('drops a button whose destination is missing instead of drawing a dead control', () => {
    vi.useFakeTimers();
    render(<PromoPopup popups={[{ ...popup, buttonHref: null }]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    const dialog = screen.getByRole('dialog');
    // The words the admin did write are still there…
    expect(dialog.textContent).toContain('Eid on Nilzora');
    // …but the label alone is not a button.
    expect(dialog.querySelector('a')).toBeNull();
    expect(dialog.textContent).not.toContain('Shop the offer');
  });

  it('shows complete artwork as one picture, with no copy drawn over it', () => {
    vi.useFakeTimers();
    const artwork = {
      ...popup,
      displayMode: 'artwork' as const,
      title: null,
      subtitle: null,
      description: null,
      buttonLabel: null,
      buttonHref: '/categories/fashion',
    };
    render(<PromoPopup popups={[artwork]} signedIn={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('Eid on Nilzora');
    // The whole picture is the destination.
    const link = dialog.querySelector('a[href="/categories/fashion"]');
    expect(link).not.toBeNull();
  });
});
