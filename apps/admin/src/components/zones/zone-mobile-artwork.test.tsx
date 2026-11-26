// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ZoneAppCardPreview } from './zone-tile';

/*
 * The app's collection card, as the workspace previews it.
 *
 * The point of the preview is that an admin sees the picture the phone will really use: the
 * app's own artwork when there is one, the website's picture when there is not, and the branded
 * tile when the zone has neither. The name, the count and "Shop" always sit on the picture, so a
 * picture whose subject sits low will be covered by them.
 */

function zone(overrides: Record<string, unknown> = {}) {
  return {
    name: "Men's",
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    displayOrder: 0,
    productCount: 3,
    ...overrides,
  };
}

const SITE = {
  url: 'https://media.test/zone-banners/z/full.webp',
  thumbUrl: 'https://media.test/zone-banners/z/thumb.webp',
};
const APP = {
  url: 'https://media.test/zone-mobile-banners/z/full.webp',
  thumbUrl: 'https://media.test/zone-mobile-banners/z/thumb.webp',
};

function pictureSource(container: HTMLElement): string | null {
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

afterEach(cleanup);

describe('the app card preview', () => {
  it('shows the app artwork when the zone has its own picture', () => {
    const { container } = render(
      <ZoneAppCardPreview zone={zone({ banner: SITE, mobileBanner: APP })} />,
    );

    expect(pictureSource(container)).toBe(APP.url);
    expect(screen.getByText("Men's")).toBeTruthy();
    expect(screen.getByText('3 products')).toBeTruthy();
    expect(screen.getByText('Shop →')).toBeTruthy();
  });

  it('falls back to the website picture when the zone has no app artwork', () => {
    const { container } = render(<ZoneAppCardPreview zone={zone({ banner: SITE })} />);

    expect(pictureSource(container)).toBe(SITE.url);
  });

  it('draws the branded tile, with the same words, when there is no picture at all', () => {
    const { container } = render(<ZoneAppCardPreview zone={zone()} />);

    expect(pictureSource(container)).toBeNull();
    expect(screen.getByText("Men's")).toBeTruthy();
    expect(screen.getByText('Shop →')).toBeTruthy();
  });
});
