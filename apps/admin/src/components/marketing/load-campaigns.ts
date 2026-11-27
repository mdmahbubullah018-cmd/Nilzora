import 'server-only';
import type {
  AdminCampaignDetail,
  CampaignConflict,
  CampaignHistoryEntry,
  CampaignPreviewResponse,
  CampaignTarget,
} from '@nilzora/contracts';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';

/*
 * The campaign screens' reads, in parallel where a page needs several. Each result is the
 * read's own outcome: the page shows a state for every failure and never made-up data.
 */

/** How many products the product picker offers at once. */
export const PICKER_PRODUCT_LIMIT = 100;

export interface CampaignTargets {
  categories: CampaignTarget[];
  brands: CampaignTarget[];
  products: CampaignTarget[];
  /** True when the catalog holds more products than the picker was given. */
  productsTruncated: boolean;
}

/**
 * The targets a campaign can name. Categories and brands are small enough to send whole;
 * products are capped, because a form should not carry a whole catalog.
 */
export async function loadCampaignTargets(): Promise<AdminRead<CampaignTargets>> {
  const [categories, brands, products] = await Promise.all([
    adminRead(async (api, token) => {
      const response = await api.adminListCategories(token);
      return response.categories;
    }),
    adminRead((api, token) => api.adminListBrands(token).then((response) => response.brands)),
    adminRead((api, token) =>
      api.adminListProducts(token, { page: 1, pageSize: PICKER_PRODUCT_LIMIT }),
    ),
  ]);
  for (const read of [categories, brands, products]) {
    if (read.kind === 'signed_out') return { kind: 'signed_out' };
    if (read.kind !== 'ok') return read;
  }
  if (categories.kind !== 'ok' || brands.kind !== 'ok' || products.kind !== 'ok') {
    return { kind: 'unavailable' };
  }
  return {
    kind: 'ok',
    value: {
      categories: categories.value.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
      })),
      brands: brands.value.map((brand) => ({
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
      })),
      products: products.value.products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
      })),
      productsTruncated: products.value.total > products.value.products.length,
    },
  };
}

export interface CampaignDetailData {
  campaign: AdminCampaignDetail;
  preview: CampaignPreviewResponse;
  conflicts: CampaignConflict[];
  history: CampaignHistoryEntry[];
}

/** One campaign with the prices it sets, the campaigns it overlaps and its own history. */
export async function loadCampaignDetail(
  campaignId: string,
): Promise<AdminRead<CampaignDetailData>> {
  const campaign = await adminRead((api, token) => api.adminGetCampaign(token, campaignId));
  if (campaign.kind !== 'ok') return campaign;

  const [preview, conflicts, history] = await Promise.all([
    adminRead((api, token) =>
      api.adminCampaignProducts(token, campaignId, { page: 1, pageSize: 25 }),
    ),
    adminRead((api, token) => api.adminCampaignConflicts(token, campaignId)),
    adminRead((api, token) =>
      api.adminCampaignHistory(token, campaignId, { page: 1, pageSize: 25 }),
    ),
  ]);
  for (const read of [preview, conflicts, history]) {
    if (read.kind === 'signed_out') return { kind: 'signed_out' };
    if (read.kind !== 'ok') return read;
  }
  if (preview.kind !== 'ok' || conflicts.kind !== 'ok' || history.kind !== 'ok') {
    return { kind: 'unavailable' };
  }
  return {
    kind: 'ok',
    value: {
      campaign: campaign.value.campaign,
      preview: preview.value,
      conflicts: conflicts.value.conflicts,
      history: history.value.entries,
    },
  };
}
