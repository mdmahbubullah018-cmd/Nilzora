import type { PublicStoreProfile } from '@nilzora/contracts';
import { INFO_PAGES } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TermsPage from './page';

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

describe('TermsPage', () => {
  it('prints the terms, including what the store really does', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await TermsPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(INFO_PAGES.terms.title);
    for (const section of INFO_PAGES.terms.sections) {
      expect(screen.getByRole('heading', { name: section.heading })).not.toBeNull();
    }
    const text = container.textContent ?? '';
    expect(text).toContain('Cash on delivery is the payment method Nilzora offers today');
    expect(text).toContain('while it is still pending');
  });

  it('does not invent fees, deadlines, jurisdiction or a warranty', async () => {
    seo.storeProfile.mockResolvedValue(
      profile({ supportEmail: 'help@nilzora.test', addressDistrict: 'Dhaka' }),
    );
    const { container } = render(await TermsPage());
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/jurisdiction|arbitration|governing law/i);
    expect(text).not.toMatch(/warrant(y|ies) (of|for) \d+|lifetime warranty/i);
    expect(text).not.toMatch(/\bwithin \d+ (business )?days?\b/i);
    expect(text).not.toMatch(/restocking fee|handling fee|processing fee/i);
  });

  it('ends with the store’s published contact details', async () => {
    seo.storeProfile.mockResolvedValue(profile({ supportEmail: 'help@nilzora.test' }));
    const { container } = render(await TermsPage());

    expect(container.textContent).toContain('Email: help@nilzora.test');
  });

  it('links on to the privacy policy, the FAQ and support', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await TermsPage());

    const next = screen.getByRole('navigation', { name: 'More information' });
    expect(Array.from(next.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/privacy', '/help/faq', '/contact'],
    );
  });
});
