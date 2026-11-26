import type { PublicStoreProfile } from '@nilzora/contracts';
import { INFO_PAGES, INFO_PAGES_UPDATED_ON, storeContactSection } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from './page';

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

describe('PrivacyPage', () => {
  it('prints every shared section, with a section list that links to each one', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await PrivacyPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(INFO_PAGES.privacy.title);
    for (const section of INFO_PAGES.privacy.sections) {
      expect(screen.getByRole('heading', { name: section.heading })).not.toBeNull();
    }
    const contents = screen.getByRole('navigation', { name: 'On this page' });
    expect(contents.querySelectorAll('a').length).toBe(INFO_PAGES.privacy.sections.length + 1);
  });

  it('says when it was last updated', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await PrivacyPage());

    const time = document.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(INFO_PAGES_UPDATED_ON);
  });

  it('closes with the contact details the store published', async () => {
    seo.storeProfile.mockResolvedValue(
      profile({ supportEmail: 'help@nilzora.test', supportPhone: '+8801712345678' }),
    );
    const { container } = render(await PrivacyPage());

    const text = container.textContent ?? '';
    expect(text).toContain(storeContactSection(null).heading);
    expect(text).toContain('Email: help@nilzora.test');
    expect(text).toContain('Phone: +8801712345678');
  });

  it('says the details could not be read rather than inventing a way to get in touch', async () => {
    seo.storeProfile.mockResolvedValue(null);
    const { container } = render(await PrivacyPage());

    expect(container.textContent).toContain('could not be read just now');
    expect(container.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
  });

  it('says nothing has been published when the profile carries no details', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await PrivacyPage());

    expect(container.textContent).toContain('has not published contact details yet');
    expect(container.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
  });

  it('promises no retention period, refund deadline or legal compliance', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    const { container } = render(await PrivacyPage());
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/we keep .* for \d+ (days|months|years)/i);
    expect(text).not.toMatch(/fully (compliant|GDPR|compliant with)/i);
    expect(text).not.toMatch(/within \d+ (business )?days/i);
  });
});
