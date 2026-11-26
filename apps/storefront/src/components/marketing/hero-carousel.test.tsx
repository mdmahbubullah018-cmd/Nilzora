import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryHref } from '@/lib/catalog-query';
import type { HeroSlide } from '@/lib/hero-slides';
import { HeroCarousel } from './hero-carousel';

function slide(n: number, overrides: Partial<HeroSlide> = {}): HeroSlide {
  return {
    id: `slide-${n}`,
    alt: `Banner ${n}`,
    href: null,
    desktopSrc: `https://media.nilzora.test/banners/${n}/full.webp`,
    mobileSrc: null,
    ...overrides,
  };
}

const three = [slide(1, { href: categoryHref('women') }), slide(2), slide(3)];

let reducedMotion = false;

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function currentDot(): number {
  return screen
    .getAllByRole('button', { name: /^Show banner/ })
    .findIndex((dot) => dot.getAttribute('aria-current') === 'true');
}

function slides(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));
}

describe('HeroCarousel', () => {
  it('shows the uploaded artwork only, named by the banner title, linking where the admin set', () => {
    render(<HeroCarousel slides={three} fallback={<p>Fallback</p>} />);

    const first = slides()[0]!;
    const image = within(first).getByRole('img', { name: 'Banner 1' });
    expect(image.getAttribute('src')).toBe('https://media.nilzora.test/banners/1/full.webp');
    expect(image.getAttribute('loading')).toBe('eager');
    expect(image.getAttribute('fetchpriority')).toBe('high');
    expect(image.closest('a')?.getAttribute('href')).toBe('/categories/women');
    // Nothing but the picture: no headline, no button over the artwork.
    expect(first.textContent).toBe('');
    expect(screen.queryByText('Fallback')).toBeNull();
  });

  it('requests later banners only shortly before they are shown', () => {
    render(<HeroCarousel slides={three} fallback={null} />);

    expect(slides().map((s) => s.querySelector('img') !== null)).toEqual([true, false, false]);
    fireEvent.load(within(slides()[0]!).getByRole('img'));
    expect(slides().map((s) => s.querySelector('img') !== null)).toEqual([true, true, false]);
    const second = slides()[1]!.querySelector('img');
    expect(second?.getAttribute('loading')).toBe('lazy');
  });

  it('uses the phone artwork on small screens when the banner has one', () => {
    render(
      <HeroCarousel
        slides={[slide(1, { mobileSrc: 'https://media.nilzora.test/banners/1/phone.webp' })]}
        fallback={null}
      />,
    );

    const source = document.querySelector('picture source');
    expect(source?.getAttribute('media')).toBe('(max-width: 767px)');
    expect(source?.getAttribute('srcset')).toBe('https://media.nilzora.test/banners/1/phone.webp');
  });

  it('advances by itself and hides the inactive banners from assistive tech', () => {
    render(<HeroCarousel slides={three} fallback={null} />);
    expect(currentDot()).toBe(0);
    expect(slides()[1]!.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(3400);
    });
    expect(currentDot()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(currentDot()).toBe(1);
    expect(slides()[1]!.getAttribute('aria-hidden')).toBe('false');
    expect(slides()[0]!.hasAttribute('inert')).toBe(true);
  });

  it('pauses on hover and with the pause button', () => {
    render(<HeroCarousel slides={three} fallback={null} />);
    const carousel = screen.getByRole('region', { name: 'Featured banners' });

    fireEvent.mouseEnter(carousel);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentDot()).toBe(0);
    fireEvent.mouseLeave(carousel);

    fireEvent.click(screen.getByRole('button', { name: 'Pause banners' }));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentDot()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Play banners' }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(currentDot()).toBe(1);
  });

  it('never moves by itself when the visitor prefers reduced motion', () => {
    reducedMotion = true;
    render(<HeroCarousel slides={three} fallback={null} />);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(currentDot()).toBe(0);
    expect(screen.queryByRole('button', { name: /Pause banners|Play banners/ })).toBeNull();
    // Manual controls still work.
    fireEvent.click(screen.getByRole('button', { name: 'Next banner' }));
    expect(currentDot()).toBe(1);
  });

  it('moves with the arrows, the dots, the arrow keys and a swipe', () => {
    render(<HeroCarousel slides={three} fallback={null} />);
    const carousel = screen.getByRole('region', { name: 'Featured banners' });

    fireEvent.click(screen.getByRole('button', { name: 'Next banner' }));
    expect(currentDot()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Previous banner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous banner' }));
    expect(currentDot()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show banner 1 of 3' }));
    expect(currentDot()).toBe(0);

    fireEvent.keyDown(carousel, { key: 'ArrowRight' });
    expect(currentDot()).toBe(1);
    fireEvent.keyDown(carousel, { key: 'ArrowLeft' });
    expect(currentDot()).toBe(0);

    fireEvent.pointerDown(carousel, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 300,
      clientY: 100,
    });
    fireEvent.pointerUp(carousel, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 120,
      clientY: 110,
    });
    expect(currentDot()).toBe(1);

    // A mostly vertical gesture is a page scroll, not a swipe.
    fireEvent.pointerDown(carousel, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerUp(carousel, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 150,
      clientY: 300,
    });
    expect(currentDot()).toBe(1);
  });

  it('drops a banner whose image fails, and falls back when none is left', () => {
    render(<HeroCarousel slides={[slide(1), slide(2)]} fallback={<p>Fallback</p>} />);

    fireEvent.error(within(slides()[0]!).getByRole('img'));
    expect(screen.queryByText('Fallback')).toBeNull();
    expect(slides()).toHaveLength(1);
    // A single banner has nothing to rotate through.
    expect(screen.queryByRole('button', { name: /Show banner/ })).toBeNull();

    fireEvent.error(within(slides()[0]!).getByRole('img'));
    expect(screen.getByText('Fallback')).not.toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});
