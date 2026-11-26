import type { CampaignSummary } from '@nilzora/contracts';
import { render, screen, userEvent } from '@testing-library/react-native';
import { CampaignStrip } from '../features/campaigns/campaign-strip';
import { CampaignLabel, campaignEnds, campaignOffer } from '../features/campaigns/campaign-label';

/*
 * The home promo band and the label beside a price. Both only describe a campaign the API has
 * already priced: no arithmetic happens here, so these tests check wording, the spoken label
 * and that an ended campaign is never given a fake end time.
 */

function campaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Eid sale',
    scope: 'storewide',
    discountKind: 'percent',
    discountValue: 20,
    maxDiscountMinor: null,
    endsAt: null,
    banner: null,
    productCount: 12,
    ...overrides,
  };
}

describe('campaignOffer', () => {
  it('says a percentage off', () => {
    expect(campaignOffer(campaign())).toBe('20% off');
  });

  it('adds the cap when the campaign has one', () => {
    expect(campaignOffer(campaign({ maxDiscountMinor: 50_000 }))).toBe('20% off (up to ৳500)');
  });

  it('says the taka amount of a fixed discount, ignoring the percent cap', () => {
    expect(
      campaignOffer(
        campaign({ discountKind: 'fixed', discountValue: 30_000, maxDiscountMinor: 1 }),
      ),
    ).toBe('৳300 off');
  });
});

describe('campaignEnds', () => {
  it('has nothing to say without an end time', () => {
    expect(campaignEnds(null)).toBeNull();
  });

  it('formats an end time as a short local date and time', () => {
    // The exact day depends on the machine's time zone, so only the shape is asserted.
    expect(campaignEnds('2026-11-30T18:00:00.000Z')).toMatch(/^\d{1,2} \w{3}, \d\d:\d\d$/);
  });

  it('ignores a timestamp it cannot read', () => {
    expect(campaignEnds('not a date')).toBeNull();
  });
});

describe('CampaignLabel', () => {
  it('names the campaign and when it ends in one spoken phrase', async () => {
    const endsAt = '2026-11-30T18:00:00.000Z';
    await render(<CampaignLabel campaign={{ title: 'Eid sale', endsAt }} />);

    expect(screen.getByText('Eid sale')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Promotion Eid sale, ends ${campaignEnds(endsAt) ?? ''}`),
    ).toBeOnTheScreen();
  });

  it('drops the end time for a campaign that does not end', async () => {
    await render(<CampaignLabel campaign={{ title: 'Eid sale', endsAt: null }} />);

    expect(screen.getByLabelText('Promotion Eid sale')).toBeOnTheScreen();
  });

  it('labels a campaign published without a title "On sale" instead of drawing a blank pill', async () => {
    await render(<CampaignLabel campaign={{ title: '  ', endsAt: null }} />);

    expect(screen.getByText('On sale')).toBeOnTheScreen();
    expect(screen.getByLabelText('Promotion On sale')).toBeOnTheScreen();
  });
});

describe('CampaignStrip', () => {
  it('renders nothing at all when no campaign is live', async () => {
    await render(<CampaignStrip campaigns={[]} onSelect={() => undefined} />);

    expect(screen.queryByText('On sale now')).not.toBeOnTheScreen();
  });

  it('leads with the first campaign and lists the rest', async () => {
    const campaigns = [
      campaign({ id: '00000000-0000-4000-8000-000000000001', title: 'Eid sale' }),
      campaign({
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Winter picks',
        discountKind: 'fixed',
        discountValue: 30_000,
      }),
    ];
    await render(<CampaignStrip campaigns={campaigns} onSelect={() => undefined} />);

    expect(screen.getByText('On sale now')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Eid sale, 20% off/)).toBeOnTheScreen();
    expect(screen.getByText('Winter picks')).toBeOnTheScreen();
    expect(screen.getByText(/৳300 off/)).toBeOnTheScreen();
  });

  it('counts the products it reaches when the campaign does not end', async () => {
    await render(<CampaignStrip campaigns={[campaign()]} onSelect={() => undefined} />);

    expect(screen.queryByText(/products$/)).not.toBeOnTheScreen();
  });

  it('hands the tapped campaign to the caller', async () => {
    const selected: string[] = [];
    const campaigns = [
      campaign({ id: '00000000-0000-4000-8000-000000000001', title: 'Eid sale' }),
      campaign({
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Winter picks',
        productCount: 4,
      }),
    ];
    await render(
      <CampaignStrip
        campaigns={campaigns}
        onSelect={(chosen) => {
          selected.push(chosen.title);
        }}
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByText('Winter picks'));

    expect(selected).toEqual(['Winter picks']);
    expect(screen.getByText(/4 products/)).toBeOnTheScreen();
  });

  it('shows the campaign’s own banner, because that is what the admin uploaded', async () => {
    const banner = {
      url: 'https://media.example.test/library/1/full.webp',
      thumbUrl: 'https://media.example.test/library/1/thumb.webp',
    };
    const view = await render(
      <CampaignStrip
        campaigns={[
          campaign({ id: '00000000-0000-4000-8000-000000000001', banner }),
          campaign({ id: '00000000-0000-4000-8000-000000000002', banner }),
        ]}
        onSelect={() => undefined}
      />,
    );

    // The lead takes the full-size picture; the compact cards take the thumbnail.
    const tree = JSON.stringify(view.toJSON());
    expect(tree).toContain(banner.url);
    expect(tree).toContain(banner.thumbUrl);
  });

  it('shows nothing but the words for a campaign without a banner', async () => {
    const view = await render(
      <CampaignStrip campaigns={[campaign()]} onSelect={() => undefined} />,
    );

    expect(JSON.stringify(view.toJSON())).not.toContain('media.example.test');
    expect(screen.getByText('Eid sale')).toBeOnTheScreen();
  });

  it('names a campaign published without a title by its offer, once', async () => {
    const campaigns = [
      campaign({ id: '00000000-0000-4000-8000-000000000001', title: '' }),
      campaign({ id: '00000000-0000-4000-8000-000000000002', title: '', productCount: 5 }),
    ];
    await render(<CampaignStrip campaigns={campaigns} onSelect={() => undefined} />);

    // The lead prints the offer as its name and drops the separate offer line; the rail banner
    // names it by the offer too and says how many products are in it.
    expect(screen.getAllByText('20% off')).toHaveLength(2);
    expect(screen.getAllByLabelText(/^20% off/)).toHaveLength(2);
    expect(screen.getByText(/5 products/)).toBeOnTheScreen();
  });
});
