import type { PublicStoreProfile } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from './site-footer';

function profile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    contactEmail: 'care@nilzora.test',
    contactPhone: '+880 1700-000000',
    addressLine: 'House 1, Road 2',
    addressArea: 'Dhanmondi',
    addressDistrict: 'Dhaka',
    businessHours: 'Sat to Thu, 10am to 8pm',
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function linksIn(region: HTMLElement): [string | null, string | null][] {
  return within(region)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

describe('SiteFooter', () => {
  it('links customer service and exactly four shop links, each destination once', () => {
    const { container } = render(<SiteFooter />);

    expect(linksIn(screen.getByRole('navigation', { name: 'Customer service' }))).toEqual([
      ['Help & support', '/contact'],
      ['Track your order', '/account/orders'],
      ['Returns and refunds', '/account/returns'],
    ]);
    // No individual category names, and nothing else in the column.
    expect(linksIn(screen.getByRole('navigation', { name: 'Shop' }))).toEqual([
      ['Categories', '/categories'],
      ['Brands', '/brands'],
      ['New Arrivals', '/products?sort=newest'],
      ['All Products', '/products'],
    ]);
    // The account column is gone; those pages stay in the header and the mobile menu.
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull();
    expect(screen.queryByText('Your account')).toBeNull();

    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('has no contact column, payment strip, delivery promise or coming-soon note', () => {
    const { container } = render(<SiteFooter profile={profile()} />);

    expect(screen.queryByText('Contact')).toBeNull();
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toContain('House 1, Road 2');
    expect(container.textContent).not.toMatch(
      /we accept|cash on delivery|সারা বাংলাদেশে|coming soon|newsletter|subscribe/i,
    );
    expect(container.querySelector('input')).toBeNull();
  });

  it('links the information pages and nothing that does not exist yet', () => {
    const { container } = render(<SiteFooter />);

    expect(container.textContent).not.toMatch(
      /clear delivery charge|cancel while pending|premium quality|free shipping/i,
    );
    // The six pages that exist, each once, in the information row.
    expect(linksIn(screen.getByRole('navigation', { name: 'Information' }))).toEqual([
      ['About Nilzora', '/about'],
      ['Frequently asked questions', '/help/faq'],
      ['Delivery policy', '/help/shipping'],
      ['Returns and refunds policy', '/help/returns'],
      ['Privacy policy', '/privacy'],
      ['Terms of service', '/terms'],
    ]);
    // Pages that still have no route are not linked.
    expect(
      screen.queryByRole('link', { name: /how to order|delivery information|wishlist|coupon/i }),
    ).toBeNull();
  });

  it('shows only the social profiles the store published', () => {
    render(
      <SiteFooter
        profile={profile({
          displayName: 'Nilzora BD',
          social: {
            facebook: 'https://facebook.com/nilzora',
            instagram: null,
            youtube: 'https://youtube.com/@nilzora',
          },
        })}
      />,
    );

    const social = screen.getByRole('list', { name: 'Follow us' });
    expect(linksIn(social).map(([, href]) => href)).toEqual([
      'https://facebook.com/nilzora',
      'https://youtube.com/@nilzora',
    ]);
    expect(
      within(social).getByRole('link', { name: 'Nilzora BD on Facebook (opens in a new tab)' }),
    ).not.toBeNull();
    expect(screen.getByText(/© \d{4} Nilzora BD\. All rights reserved\./)).not.toBeNull();
  });

  it('leaves out the app column until a store listing is published', () => {
    render(<SiteFooter profile={profile()} />);

    expect(screen.queryByText('Get the app')).toBeNull();
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
  });

  it('links each published listing through its own mark and wording, with no QR code', () => {
    render(
      <SiteFooter
        appLinks={{
          googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
          appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
        }}
      />,
    );

    const app = screen.getByText('Get the app').closest('div[aria-labelledby]') as HTMLElement;
    const store = within(app).getByRole('link', { name: /Get it on Google Play/ });
    expect(store.getAttribute('href')).toBe(
      'https://play.google.com/store/apps/details?id=com.nilzora.app',
    );
    expect(store.getAttribute('rel')).toBe('noopener noreferrer');
    // The wording a customer recognises, not an icon alone.
    expect(store.textContent).toContain('GET IT ON');
    expect(store.textContent).toContain('Google Play');
    expect(
      within(app)
        .getByRole('link', { name: /Download on the App Store/ })
        .getAttribute('href'),
    ).toBe('https://apps.apple.com/bd/app/nilzora/id123456789');
    // No QR code, ever.
    expect(within(app).queryByRole('img', { name: /QR/ })).toBeNull();
  });

  it('shows only the platform the store published', () => {
    const { unmount } = render(
      <SiteFooter
        appLinks={{ googlePlayUrl: null, appStoreUrl: 'https://apps.apple.com/bd/app/x/id1' }}
      />,
    );

    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
    // The phone row and the wide-layout column both name the same one store.
    expect(screen.getAllByRole('link', { name: /App Store/ }).length).toBeGreaterThan(0);
    unmount();
  });

  it('offers the store options on a phone without opening a menu', () => {
    render(
      <SiteFooter
        profile={profile({
          playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
          appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
        })}
      />,
    );

    // Straight in the brand column, above the tagline: no accordion, no click to reveal.
    const brand = document.querySelector('a[aria-label="Nilzora"]')?.parentElement;
    expect(brand).not.toBeNull();
    const options = [
      ...(brand?.querySelectorAll('a[href*="play.google"], a[href*="apps.apple"]') ?? []),
    ];
    expect(options).toHaveLength(2);
    // Hidden from lg, where the footer's own app column takes over.
    expect(options[0]?.closest('ul')?.className).toContain('lg:hidden');
    for (const option of options) {
      const store =
        option.getAttribute('href')?.includes('play.google') === true ? 'Google Play' : 'App Store';
      expect(option.textContent).toContain(store);
    }
  });
});
