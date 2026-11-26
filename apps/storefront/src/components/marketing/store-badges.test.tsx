import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppDownloadLinks } from '@/lib/app-links';
import { AppDownloadStrip, publishedBadges, StoreBadgeOptions } from './store-badges';

const PLAY = 'https://play.google.com/store/apps/details?id=com.nilzora.app';
const APPLE = 'https://apps.apple.com/bd/app/nilzora/id123456789';

function links(overrides: Partial<AppDownloadLinks> = {}): AppDownloadLinks {
  return { googlePlayUrl: null, appStoreUrl: null, ...overrides };
}

describe('the store download options', () => {
  it('renders nothing when the store published neither listing', () => {
    const { container } = render(<StoreBadgeOptions links={links()} />);

    expect(container.innerHTML).toBe('');
    expect(publishedBadges(links())).toEqual([]);
  });

  it('names the store and its familiar download wording, next to the brand mark', () => {
    render(<StoreBadgeOptions links={links({ googlePlayUrl: PLAY, appStoreUrl: APPLE })} />);

    const play = screen.getByRole('link', { name: /Google Play/ });
    expect(play.getAttribute('href')).toBe(PLAY);
    expect(play.getAttribute('target')).toBe('_blank');
    expect(play.getAttribute('rel')).toBe('noopener noreferrer');
    expect(play.textContent).toContain('GET IT ON');
    expect(play.textContent).toContain('Google Play');
    // The mark is the brand's own shape drawn inline, not a badge plate with a black background.
    expect(play.querySelector('svg')).not.toBeNull();
    expect(play.querySelector('img')).toBeNull();

    const apple = screen.getByRole('link', { name: /Download on the App Store/ });
    expect(apple.getAttribute('href')).toBe(APPLE);
    expect(apple.textContent).toContain('Download on the');
    expect(apple.textContent).toContain('App Store');
    expect(apple.querySelector('svg')).not.toBeNull();
  });

  it('shows only Google Play when that is the only listing', () => {
    render(<StoreBadgeOptions links={links({ googlePlayUrl: PLAY })} />);

    expect(screen.getByRole('link', { name: /Google Play/ })).not.toBeNull();
    expect(screen.queryByRole('link', { name: /App Store/ })).toBeNull();
  });

  it('shows only the App Store when that is the only listing', () => {
    render(<StoreBadgeOptions links={links({ appStoreUrl: APPLE })} />);

    expect(screen.getByRole('link', { name: /App Store/ })).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
  });

  it('refuses a link that is not on the real store, rather than showing a dead option', () => {
    render(
      <StoreBadgeOptions
        links={links({
          googlePlayUrl: 'https://play.google.com.evil.example/app',
          appStoreUrl: 'http://apps.apple.com/app/x',
        })}
      />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('never draws a QR code', () => {
    const { container } = render(
      <StoreBadgeOptions links={links({ googlePlayUrl: PLAY, appStoreUrl: APPLE })} />,
    );

    expect(screen.queryByRole('img', { name: /QR/i })).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('paints white on the navy footer and brand blue on the page', () => {
    const { unmount } = render(
      <StoreBadgeOptions links={links({ googlePlayUrl: PLAY })} tone="dark" />,
    );
    expect(screen.getByRole('link', { name: /Google Play/ }).className).toContain('text-white');
    unmount();

    render(<StoreBadgeOptions links={links({ googlePlayUrl: PLAY })} />);
    expect(screen.getByRole('link', { name: /Google Play/ }).className).toContain('text-primary');
  });
});

describe('the phone download strip', () => {
  it('is absent when no listing is published', () => {
    const { container } = render(<AppDownloadStrip links={links()} className="mt-1" />);

    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Download the Nilzora Apps')).toBeNull();
  });

  it('reads heading, then Google Play, then App Store on one non-wrapping line', () => {
    const { container } = render(
      <AppDownloadStrip links={links({ googlePlayUrl: PLAY, appStoreUrl: APPLE })} />,
    );

    const strip = screen.getByRole('region', { name: 'Download the Nilzora apps' });
    const line = strip.firstElementChild as HTMLElement;
    // One row, never a second line, whatever the width.
    expect(line.className).toContain('flex-nowrap');
    expect(line.className).not.toContain('flex-wrap');

    const parts = [...line.children].map((child) => child.textContent ?? '');
    expect(parts[0]).toContain('Download the Nilzora Apps');
    expect(parts[1]).toContain('Google Play');
    expect(parts[2]).toContain('App Store');

    // The sheet is translucent, not a solid card.
    expect(line.className).toContain('backdrop-blur');
    expect(line.className).toContain('bg-white/55');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows the heading with only the platform the store published', () => {
    render(<AppDownloadStrip links={links({ appStoreUrl: APPLE })} />);

    const strip = screen.getByRole('region', { name: 'Download the Nilzora apps' });
    const line = strip.firstElementChild as HTMLElement;
    expect(line.children).toHaveLength(2);
    expect(within(line).getByRole('link', { name: /App Store/ })).not.toBeNull();
    expect(within(line).queryByRole('link', { name: /Google Play/ })).toBeNull();
  });
});
