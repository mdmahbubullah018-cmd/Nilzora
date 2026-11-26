import type { CampaignSummary } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { campaignEnds, campaignOffer, HomeCampaignSection } from './campaign-highlights';

/*
 * The home page's sale band. The campaign's own banner — uploaded in Discounts & campaigns — is
 * the picture a shopper is meant to see, so the band draws it in the 12:5 frame the upload
 * guidance asks for; a campaign without one is still the words alone. Nothing here calculates
 * a discount: the offer text is the API's own figure.
 */

function campaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: '3f5669dc-bade-41f5-88d7-f31024f6d8fc',
    title: 'winter-collections-2026',
    scope: 'categories',
    discountKind: 'percent',
    discountValue: 40,
    maxDiscountMinor: 50_000,
    endsAt: '2026-11-13T14:53:00.000Z',
    banner: null,
    productCount: 1,
    ...overrides,
  };
}

const banner = {
  url: 'https://media.example.test/library/8b035c80/full.webp',
  thumbUrl: 'https://media.example.test/library/8b035c80/thumb.webp',
};

describe('HomeCampaignSection', () => {
  it('shows nothing at all when no campaign is live', () => {
    const { container } = render(<HomeCampaignSection campaigns={[]} />);

    expect(container.innerHTML).toBe('');
  });

  it('draws the campaign’s own banner, in the 12:5 frame the guidance asks for', () => {
    const { container } = render(<HomeCampaignSection campaigns={[campaign({ banner })]} />);

    const picture = container.querySelector('img');
    expect(picture?.getAttribute('src')).toBe(banner.url);
    // Decorative: the heading and the caption already name the sale.
    expect(picture?.getAttribute('alt')).toBe('');
    expect(container.querySelector('a[aria-label]')?.className).toContain('aspect-12/5');
  });

  it('keeps the band compact: the picture beside the words, never over them', () => {
    const { container } = render(<HomeCampaignSection campaigns={[campaign({ banner })]} />);

    // The banner link carries no words of its own: the title, offer and button sit beside it.
    const lead = container.querySelector('a[aria-label]');
    expect((lead?.textContent ?? '').trim()).toBe('');
    expect(lead?.parentElement?.className).toContain('lg:grid-cols-');
    expect(screen.getByRole('heading', { name: 'winter-collections-2026' })).toBeTruthy();
  });

  it('leads with the offer, not an empty heading, when the campaign has no title', () => {
    render(<HomeCampaignSection campaigns={[campaign({ title: '', banner })]} />);

    // The offer becomes the heading, and it is not repeated underneath.
    expect(screen.getByRole('heading', { level: 2, name: campaignOffer(campaign()) })).toBeTruthy();
    expect(screen.getAllByText(campaignOffer(campaign()))).toHaveLength(1);
  });

  it('labels a title-less campaign card with its offer instead of a blank line', () => {
    const lead = campaign();
    const second = campaign({ id: '8a000000-0000-4000-8000-000000000002', title: '', banner });
    const { container } = render(<HomeCampaignSection campaigns={[lead, second]} />);

    const cards = [...container.querySelectorAll('ul li')];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain(campaignOffer(second));
  });

  it('is the words alone for a campaign without a banner', () => {
    const { container } = render(<HomeCampaignSection campaigns={[campaign()]} />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'winter-collections-2026' })).toBeTruthy();
    expect(screen.getAllByText(campaignOffer(campaign())).length).toBeGreaterThan(0);
  });

  it('gives each further campaign its own thumbnail and offer', () => {
    const second = campaign({
      id: '8a000000-0000-4000-8000-000000000002',
      title: 'Eid picks',
      discountKind: 'fixed',
      discountValue: 30_000,
      maxDiscountMinor: null,
      endsAt: null,
      banner,
    });
    const { container } = render(<HomeCampaignSection campaigns={[campaign(), second]} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(banner.thumbUrl);
    expect(screen.getByText('Eid picks')).toBeTruthy();
    expect(screen.getByText('৳300 off')).toBeTruthy();
  });

  it('says when the sale ends, on the shop’s own clock', () => {
    render(<HomeCampaignSection campaigns={[campaign()]} />);

    expect(screen.getByText(`Ends ${campaignEnds(campaign().endsAt) ?? ''}`)).toBeTruthy();
  });

  it('links the whole banner and the cards to the sale', () => {
    const { container } = render(
      <HomeCampaignSection
        campaigns={[
          campaign({ banner }),
          campaign({ id: '8a000000-0000-4000-8000-000000000003', banner }),
        ]}
      />,
    );

    const links = [...container.querySelectorAll('a')];
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/products?sort=featured');
    }
  });
});
