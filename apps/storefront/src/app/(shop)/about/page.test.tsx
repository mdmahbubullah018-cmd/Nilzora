import type { PublicStoreProfile } from '@nilzora/contracts';
import { INFO_PAGES } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutPage from './page';

const seo = vi.hoisted(() => ({
  storeProfile: vi.fn(),
  siteUrl: () => new URL('https://shop.example.test'),
}));
vi.mock('@/lib/seo', () => seo);

afterEach(() => {
  vi.clearAllMocks();
});

function profile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    addressArea: null,
    addressDistrict: null,
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    updatedAt: '2026-11-06T09:00:00.000Z',
    ...overrides,
  };
}

describe('AboutPage', () => {
  it('introduces the store with the official artwork and the shared wording', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await AboutPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(INFO_PAGES.about.title);
    // The official artwork, not a redrawn logo.
    expect(screen.getByAltText('Nilzora').getAttribute('src')).toContain('nilzora-logo');
    for (const section of INFO_PAGES.about.sections) {
      expect(screen.getByRole('heading', { name: section.heading })).not.toBeNull();
    }
    expect(container.textContent).toContain(INFO_PAGES.about.summary);
  });

  it('shows the store’s own tagline only when it has published one', async () => {
    seo.storeProfile.mockResolvedValue(profile({ tagline: 'Everyday essentials, delivered.' }));
    const { unmount } = render(await AboutPage());
    expect(screen.getByText('Everyday essentials, delivered.')).not.toBeNull();
    unmount();

    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await AboutPage());
    expect(container.textContent).not.toContain('Everyday essentials');
  });

  it('invents no history, statistics or team details', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await AboutPage());
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/\d[\d,.]*\s*(customers|orders|products|years)\b/i);
    expect(text).not.toMatch(/founded in|our team|our office|mission statement/i);
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
  });

  it('offers the way on to the shop, the FAQ and support', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await AboutPage());

    const next = screen.getByRole('navigation', { name: 'More information' });
    expect(Array.from(next.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/products', '/help/faq', '/contact'],
    );
  });
});
