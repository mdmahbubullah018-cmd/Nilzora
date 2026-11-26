import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppDownloadLinks } from '@/lib/app-links';
import { AppDownloadMenu } from './app-download-menu';

const PLAY = 'https://play.google.com/store/apps/details?id=com.nilzora.app';
const APPLE = 'https://apps.apple.com/bd/app/nilzora/id123456789';

function links(overrides: Partial<AppDownloadLinks> = {}): AppDownloadLinks {
  return { googlePlayUrl: null, appStoreUrl: null, ...overrides };
}

describe('the header app download control', () => {
  it('is not there at all when the store has published no listing', () => {
    const { container } = render(<AppDownloadMenu links={links()} onDark={false} />);

    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button', { name: /Download the Nilzora app/ })).toBeNull();
  });

  it('opens on hover and stays open while the pointer crosses into the panel', () => {
    const { container } = render(
      <AppDownloadMenu links={links({ googlePlayUrl: PLAY, appStoreUrl: APPLE })} onDark={false} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;

    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(screen.getByRole('link', { name: /Google Play/ })).not.toBeNull();

    // Moving from the glyph into the panel never leaves the wrapper, so nothing closes it.
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(screen.getByRole('link', { name: /App Store/ })).not.toBeNull();
  });

  it('opens and closes on click, which is what a touch screen sends', () => {
    render(<AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />);
    const trigger = screen.getByRole('button', { name: /Download the Nilzora app/ });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
  });

  it('keeps a hover-opened panel open when it is pressed, and closes it on the next press', () => {
    const { container } = render(
      <AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const trigger = screen.getByRole('button', { name: /Download the Nilzora app/ });

    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    // A press on an already-hovered glyph pins the panel instead of closing it under the pointer.
    fireEvent.click(trigger);
    expect(screen.getByRole('link', { name: /Google Play/ })).not.toBeNull();

    // Pinned: moving the pointer away no longer closes it.
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(screen.getByRole('link', { name: /Google Play/ })).not.toBeNull();

    fireEvent.click(trigger);
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
  });

  it('is the desktop control only: a "Get App" label under the glyph, hidden below xl', () => {
    const { container } = render(
      <AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    // Only the desktop header carries it; the phone gets the strip under the trusted section.
    expect(wrapper.className).toContain('hidden');
    expect(wrapper.className).toContain('xl:block');

    const trigger = screen.getByRole('button', { name: /Download the Nilzora app/ });
    expect(trigger.textContent).toContain('Get App');
    expect(trigger.textContent).not.toContain('Get in App');
    const label = within(trigger).getByText('Get App');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(label.className).not.toMatch(/(?:^|\s)bg-/);
  });

  it('opens a roomy panel that names both stores with their download wording', () => {
    render(
      <AppDownloadMenu links={links({ googlePlayUrl: PLAY, appStoreUrl: APPLE })} onDark={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Download the Nilzora app/ }));

    const panel = screen.getByRole('group', { name: 'Download the Nilzora app' });
    expect(panel.textContent).toContain('Download the Nilzora Apps');
    expect(panel.textContent).toContain('GET IT ON');
    expect(panel.textContent).toContain('Google Play');
    expect(panel.textContent).toContain('Download on the');
    expect(panel.textContent).toContain('App Store');
    // Roomy: real padding, and the store text sits at the larger of the two sizes.
    expect(panel.className).toContain('p-4');
    const storeName = within(panel).getByText('App Store');
    expect(storeName.className).toContain('text-sm');
  });

  it('opens when a keyboard visitor tabs onto it', () => {
    render(<AppDownloadMenu links={links({ appStoreUrl: APPLE })} onDark={false} />);

    fireEvent.focus(screen.getByRole('button', { name: /Download the Nilzora app/ }));

    expect(screen.getByRole('link', { name: /App Store/ })).not.toBeNull();
  });

  it('closes on Escape and gives focus back to the button', () => {
    render(<AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />);
    const trigger = screen.getByRole('button', { name: /Download the Nilzora app/ });
    fireEvent.click(trigger);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a press outside the control', () => {
    render(<AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Download the Nilzora app/ }));

    act(() => {
      fireEvent.pointerDown(document.body);
    });

    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
  });

  it('paints the glyph white over the banner and brand blue on the frosted bar', () => {
    const { rerender } = render(<AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark />);
    const trigger = () => screen.getByRole('button', { name: /Download the Nilzora app/ });
    expect(trigger().className).toContain('text-white');

    rerender(<AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />);
    expect(trigger().className).toContain('text-primary-action');
    // No coloured box behind the glyph: a transparent resting background only.
    expect(trigger().className).not.toMatch(/(?:^|\s)bg-(?!transparent)/);
  });

  it('remembers the platform the pointer is over without a timer leaking between renders', () => {
    vi.useFakeTimers();
    try {
      const { container, unmount } = render(
        <AppDownloadMenu links={links({ googlePlayUrl: PLAY })} onDark={false} />,
      );
      const wrapper = container.firstElementChild as HTMLElement;

      fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
      fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
      unmount();
      // Unmounting with a close scheduled must not warn or fire against a gone component.
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
