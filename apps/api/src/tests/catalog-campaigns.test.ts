import { describe, expect, it } from 'vitest';
import { campaignLabel, createSupabaseCatalogStore } from '../modules/catalog/store';
import type { SupabaseClients } from '../supabase/clients';

/*
 * The public campaign feed at the store boundary.
 *
 * The eligibility rule itself (live, visible, inside its window, reaching a published product)
 * lives in the database function and is proved against the real schema. What is checked here is
 * what the API adds: that a row the database answers is shaped into the contract - including the
 * timestamp form. PostgREST writes a timezone as "+00:00" and the contract wants "Z", so a live
 * campaign with an end date used to fail the whole feed and the storefront showed no campaigns
 * at all.
 */

const MEDIA = 'https://media.example.com';
const CAMPAIGN_ID = '3f2a1b4c-0000-4000-8000-0000000000cc';

interface Answer {
  data?: unknown;
  error?: { code: string; message: string } | null;
}

function storeWith(answers: Record<string, Answer>) {
  const calls: { name: string; args: unknown }[] = [];
  const rpc = (name: string, args?: unknown) => {
    calls.push({ name, args });
    const answer = answers[name] ?? { data: null, error: null };
    return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
  };
  const from = () => ({
    select: () => ({
      eq: (_column: string, value: unknown) => ({
        maybeSingle: () =>
          Promise.resolve({
            data: value === 'missing-category' ? null : { id: 'category-1' },
            error: null,
          }),
      }),
    }),
  });
  const clients = {
    public: () => ({ rpc, from }),
    asUser: () => ({ rpc, from }),
  } as unknown as SupabaseClients;
  return { store: createSupabaseCatalogStore(clients, { mediaBaseUrl: MEDIA }), calls };
}

/** A row exactly as `catalog_campaigns` answers it through PostgREST. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: CAMPAIGN_ID,
    title: 'Winter Sale',
    scope: 'categories',
    discount_kind: 'percent',
    discount_value: '40',
    max_discount_minor: null,
    ends_at: '2026-11-13T14:53:00.123456+00:00',
    banner_image_key: 'library/2026/11/winter-banner',
    product_count: '7',
    ...overrides,
  };
}

describe('the public campaign feed', () => {
  it('accepts the offset timestamp PostgREST writes, so a live campaign is listed', async () => {
    const { store } = storeWith({ catalog_campaigns: { data: [row()] } });

    const campaigns = await store.listCampaigns('t-shirt');

    expect(campaigns).toHaveLength(1);
    // The same instant, in the form the contract asks for.
    expect(campaigns[0]?.endsAt).toBe('2026-11-13T14:53:00.123Z');
    expect(campaigns[0]?.title).toBe('Winter Sale');
    expect(campaigns[0]?.discountValue).toBe(40);
    expect(campaigns[0]?.productCount).toBe(7);
  });

  it('turns the stored media key into public picture URLs', async () => {
    const { store } = storeWith({ catalog_campaigns: { data: [row()] } });

    const [campaign] = await store.listCampaigns();

    expect(campaign?.banner?.url.startsWith(`${MEDIA}/`)).toBe(true);
    expect(campaign?.banner?.thumbUrl.startsWith(`${MEDIA}/`)).toBe(true);
  });

  it('keeps a campaign with no picture and no end date', async () => {
    const { store } = storeWith({
      catalog_campaigns: { data: [row({ banner_image_key: '', ends_at: null })] },
    });

    const [campaign] = await store.listCampaigns();

    expect(campaign?.banner).toBeNull();
    expect(campaign?.endsAt).toBeNull();
  });

  it('asks for the whole catalogue when no category was named', async () => {
    const { store, calls } = storeWith({ catalog_campaigns: { data: [] } });

    await store.listCampaigns();

    expect(calls).toStrictEqual([{ name: 'catalog_campaigns', args: { p_category_id: null } }]);
  });

  it('answers nothing at all for a category the store does not have', async () => {
    const { store, calls } = storeWith({ catalog_campaigns: { data: [row()] } });

    const campaigns = await store.listCampaigns('missing-category');

    expect(campaigns).toStrictEqual([]);
    // No feed read for a slug that matches nothing.
    expect(calls.some((call) => call.name === 'catalog_campaigns')).toBe(false);
  });
});
describe('the campaign label on a priced product', () => {
  it('carries the same instant in Z form, from a row read with an offset', () => {
    const label = campaignLabel({
      campaign_id: CAMPAIGN_ID,
      campaign_title: 'Winter Sale',
      campaign_ends_at: '2026-11-13T14:53:00.123456+00:00',
      campaign_discount_kind: 'percent',
      campaign_discount_value: 40,
    });

    expect(label?.endsAt).toBe('2026-11-13T14:53:00.123Z');
  });

  it('stays null for a product no campaign priced', () => {
    expect(
      campaignLabel({
        campaign_id: null,
        campaign_title: null,
        campaign_ends_at: null,
        campaign_discount_kind: null,
        campaign_discount_value: null,
      }),
    ).toBeNull();
  });
});
