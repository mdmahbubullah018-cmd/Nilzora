import {
  campaignListResponseSchema,
  categorySchema,
  LOW_STOCK_THRESHOLD,
  productDetailSchema,
  productSummarySchema,
  productVariantSchema,
  type Availability,
  type CampaignSummary,
  type CatalogSort,
  type Category,
  type MediaPicture,
  type ProductDetail,
  type ProductFacets,
  type ProductSummary,
} from '@nilzora/contracts';
import { z } from 'zod';
import { disabledCatalogCache, type CatalogCache } from '../../cache';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, isoTimestamps, toStoreError } from '../commerce/errors';
import { sqlNull, untypedRpc } from '../admin/shared';
import { supabaseProductColors } from './colors';
import { toProductVideos, VIDEO_COLUMNS, type VideoRow } from '../media/videos';
import {
  IMAGE_COLUMNS,
  toProductImage,
  toProductImages,
  variantKeys,
  type ImageRow,
} from '../media/images';

/** The search a listing request asks for: what to show, and how to order and page it. */
export interface ProductSearch {
  categorySlug?: string | undefined;
  /** A prepared prefix query from toPrefixQuery(), never raw visitor input. */
  prefixQuery?: string | undefined;
  sort: CatalogSort;
  limit: number;
  offset: number;
  /** With a category: the products of every published subcategory below it too. */
  includeSubcategories?: boolean | undefined;
  /** Only products of this active brand. */
  brandSlug?: string | undefined;
  /** Selling price bounds in poisha, both inclusive. */
  minPriceMinor?: number | undefined;
  maxPriceMinor?: number | undefined;
  /** Only products that can be ordered now. */
  inStock?: boolean | undefined;
  /**
   * Only products in this shopping zone. The database resolves membership (explicit rows
   * first, then the product's category), so this is a filter and never a join.
   */
  zoneSlug?: string | undefined;
  /**
   * Variant values a product must be sold in: one variant carrying every one of them. Slugs of
   * `product_attribute_values` where the attribute's kind is 'size' or 'color'.
   */
  sizeSlugs?: readonly string[] | undefined;
  colorSlugs?: readonly string[] | undefined;
}

/**
 * The slugs of a category and every published category below it, in tree order. The tree is
 * the published one (catalog_category_tree), so a subcategory under a hidden parent is never
 * reached, exactly as the storefront's navigation never shows it.
 */
export function branchSlugs(categories: readonly Category[], slug: string): string[] {
  if (!categories.some((category) => category.slug === slug)) return [];
  const branch = [slug];
  for (let index = 0; index < branch.length; index += 1) {
    const parent = branch[index];
    for (const category of categories) {
      if (category.parentSlug === parent && !branch.includes(category.slug)) {
        branch.push(category.slug);
      }
    }
  }
  return branch;
}

/** Each category with the products on sale in it and below it (`totalProductCount`). */
export function withBranchCounts(categories: readonly Category[]): Category[] {
  const direct = new Map(categories.map((category) => [category.slug, category.productCount]));
  return categories.map((category) => ({
    ...category,
    totalProductCount: branchSlugs(categories, category.slug).reduce(
      (sum, slug) => sum + (direct.get(slug) ?? 0),
      0,
    ),
  }));
}

/** A listing row, as catalog_products() prices it. */
interface ListingRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  category_slug: string;
  category_name: string;
  campaign_id: string | null;
  campaign_title: string | null;
  campaign_ends_at: string | null;
  campaign_discount_kind: 'percent' | 'fixed' | null;
  campaign_discount_value: number | null;
  total_count?: number;
}

/** The campaign label a card or a detail page shows beside the price. */
export function campaignLabel(row: {
  campaign_id: string | null;
  campaign_title: string | null;
  campaign_ends_at: string | null;
  campaign_discount_kind: 'percent' | 'fixed' | null;
  campaign_discount_value: number | null;
}): ProductSummary['campaign'] {
  if (
    row.campaign_id === null ||
    row.campaign_title === null ||
    row.campaign_discount_kind === null ||
    row.campaign_discount_value === null
  ) {
    return null;
  }
  return {
    id: row.campaign_id,
    title: row.campaign_title,
    // A row read from PostgREST carries the timezone as "+00:00"; the contract wants "Z".
    endsAt: row.campaign_ends_at === null ? null : isoTimestamp(row.campaign_ends_at),
    discountKind: row.campaign_discount_kind,
    discountValue: Number(row.campaign_discount_value),
  };
}

export interface ProductPage {
  items: ProductSummary[];
  /** Matching products across all pages. */
  total: number;
}

/** Public catalog reads. Only products on sale in active categories are ever returned. */
export interface CatalogStore {
  listCategories(): Promise<Category[]>;
  listProducts(search: ProductSearch): Promise<ProductPage>;
  /**
   * The cards of a known set of products, priced and shaped exactly like a listing, ordered
   * as the caller asked (image search ranks by visual similarity). Only products on sale come
   * back, so an id that has left the catalogue yields no card.
   */
  listProductsByIds(ids: readonly string[]): Promise<ProductSummary[]>;
  /**
   * The on-sale product a scanned code names: its SKU (a product label or barcode payload)
   * or its slug (a QR code carrying a product link). Null when nothing matches.
   */
  findProductByCode(code: string): Promise<ProductSummary | null>;
  /** Null when the product does not exist or is not on sale. */
  getProduct(slug: string): Promise<ProductDetail | null>;
  /** Live, visible campaigns: all of them, or the ones reaching one category. */
  listCampaigns(categorySlug?: string): Promise<CampaignSummary[]>;
  /**
   * An active shopping zone, or null when the slug is unknown or the zone is not public.
   * A listing filtered by a zone asks this first, so a retired collection answers 404.
   */
  getZone(slug: string): Promise<{ id: string; slug: string; name: string } | null>;
  /**
   * The sizes and colours the products of this listing context are actually sold in. Empty
   * lists are the honest answer when nothing in the context carries variants (or when the
   * variant-filters migration has not reached this database yet), and the storefront then
   * offers no chips at all rather than a control that would empty the page.
   */
  listFacets(search: ProductFacetsSearch): Promise<ProductFacets>;
}

/** The listing context facets are computed for: every narrowing option, without paging. */
export type ProductFacetsSearch = Omit<ProductSearch, 'sort' | 'limit' | 'offset'>;

interface StockFields {
  stock_quantity: number;
  max_order_quantity: number;
}

/** Shoppers see a stock band and an order limit, never the exact stock level. */
export function stockView({ stock_quantity: stock, max_order_quantity: limit }: StockFields): {
  availability: Availability;
  maxOrderQuantity: number;
} {
  const availability: Availability =
    stock <= 0 ? 'out_of_stock' : stock <= LOW_STOCK_THRESHOLD ? 'low_stock' : 'in_stock';
  return { availability, maxOrderQuantity: Math.max(0, Math.min(stock, limit)) };
}

const productPageSchema = z.array(productSummarySchema);

const categoryListSchema = z.array(categorySchema);

/** One row of catalog_campaigns(). */
interface CampaignRow {
  campaign_id: string;
  title: string;
  scope: CampaignSummary['scope'];
  discount_kind: CampaignSummary['discountKind'];
  discount_value: number;
  max_discount_minor: number | null;
  ends_at: string | null;
  banner_image_key: string | null;
  product_count: number;
}

/** The two public variant URLs of a stored media key; null without a key or media. */
/**
 * A size chart as shoppers receive it. A picture chart keeps its library key and gains the
 * picture's public address; a table chart passes through untouched. Without a media host the
 * picture chart still carries its key, so the page can say there is a chart to see.
 */
function chartWithPicture(chart: unknown, mediaBaseUrl: string | undefined): unknown {
  if (typeof chart !== 'object' || chart === null) return null;
  const record = chart as { imageKey?: unknown };
  if (typeof record.imageKey !== 'string') return chart;
  const picture = pictureFromKey(record.imageKey, mediaBaseUrl);
  return picture === null ? chart : { ...record, imageUrl: picture.url };
}

function pictureFromKey(imageKey: string | null, mediaBaseUrl: string | undefined) {
  if (imageKey === null || imageKey === '' || mediaBaseUrl === undefined) return null;
  const [full, thumb] = variantKeys(imageKey);
  return { url: `${mediaBaseUrl}/${full}`, thumbUrl: `${mediaBaseUrl}/${thumb}` };
}

export interface CatalogStoreOptions {
  /** Public base URL of the media bucket; without it products carry no images. */
  mediaBaseUrl?: string | undefined;
  /** Catalog cache for the category tree; a cache that always misses when Redis is off. */
  cache?: CatalogCache | undefined;
}

export function createSupabaseCatalogStore(
  clients: SupabaseClients,
  { mediaBaseUrl, cache = disabledCatalogCache() }: CatalogStoreOptions = {},
): CatalogStore {
  /**
   * A category's cover picture from the base key stored on the row. The key itself is never
   * returned: only the two public variant URLs. Null without a cover or without media.
   */
  function categoryImage(imageKey: string | null): MediaPicture | null {
    return pictureFromKey(imageKey, mediaBaseUrl);
  }

  /**
   * Banner keys of the published categories, by slug. The banner column arrived in a later
   * migration, so a database without it (or any read failure) answers "no banners": a missing
   * banner must never take the category list down.
   */
  async function bannerKeys(): Promise<Map<string, string>> {
    const keys = new Map<string, string>();
    const { data, error } = await clients
      .public()
      .from('categories')
      .select('slug, banner_key')
      .not('banner_key', 'is', null);
    if (error || !data) return keys;
    for (const row of data as unknown as { slug: string; banner_key: string | null }[]) {
      if (row.banner_key !== null) keys.set(row.slug, row.banner_key);
    }
    return keys;
  }

  /**
   * Units sold per product for the products on one page, in a single read. Only delivered
   * orders count (see catalog_sold_counts). A database without the function, or a failed read,
   * answers "unknown" (an empty map): the label is then left off, never guessed.
   */
  async function soldCounts(productIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (productIds.length === 0) return counts;
    const { data, error } = await clients
      .public()
      .rpc('catalog_sold_counts', { p_product_ids: [...productIds] });
    if (error || !data) return counts;
    for (const row of data) counts.set(row.product_id, Number(row.sold));
    return counts;
  }

  /** The primary image of each product, by product id (one query for the whole page). */
  async function primaryImages(productIds: readonly string[]) {
    const images = new Map<string, ReturnType<typeof toProductImage>>();
    if (mediaBaseUrl === undefined || productIds.length === 0) return images;
    const { data, error } = await clients
      .public()
      .from('product_images')
      .select(`product_id, ${IMAGE_COLUMNS}`)
      .in('product_id', [...productIds])
      .eq('position', 0);
    if (error) throw toStoreError(error, 'product_images');
    for (const row of data as unknown as (ImageRow & { product_id: string })[]) {
      images.set(row.product_id, toProductImage(row, mediaBaseUrl));
    }
    return images;
  }

  /** A product's sellable variants. Empty for a product that sells as a single item. */
  async function readVariants(slug: string) {
    const { data, error } = await clients.public().rpc('catalog_product_variants', {
      p_slug: slug,
    });
    if (error) throw toStoreError(error, 'catalog_product_variants');
    return (data ?? []).map((row) =>
      productVariantSchema.parse({
        id: row.variant_id,
        sku: row.sku,
        priceMinor: Number(row.price_minor),
        compareAtPriceMinor:
          row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
        ...stockView({
          stock_quantity: row.stock_quantity,
          max_order_quantity: row.max_order_quantity,
        }),
        options: row.options,
        imageUrl: row.image_url,
      }),
    );
  }

  /** Every image of one product, in display order. */
  async function imagesOf(productId: string) {
    const { data, error } = await clients
      .public()
      .from('product_images')
      .select(IMAGE_COLUMNS)
      .eq('product_id', productId)
      .order('position');
    if (error) throw toStoreError(error, 'product_images');
    return toProductImages(data, mediaBaseUrl);
  }

  /** A product's videos, in order (RLS shows them only while the product is on sale). */
  async function videosOf(productId: string) {
    if (mediaBaseUrl === undefined) return [];
    const { data, error } = await clients
      .public()
      .from('product_videos')
      .select(VIDEO_COLUMNS)
      .eq('product_id', productId)
      .order('position');
    // Videos are optional extras: a failed read (e.g. a database that has not run the
    // product_videos migration yet) shows the product without them instead of failing it.
    if (error) return [];
    return toProductVideos(data as unknown as VideoRow[], mediaBaseUrl);
  }

  /** One brand by id: RLS hides inactive brands, so their product simply shows none. */
  async function brandById(brandId: string) {
    const { data, error } = await clients
      .public()
      .from('brands')
      .select('slug, name')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw toStoreError(error, 'brands');
    return data;
  }

  /** The active brand of each product, by product id (one query for the whole page). */
  async function brandsOf(productIds: readonly string[]) {
    const brands = new Map<string, { slug: string; name: string }>();
    if (productIds.length === 0) return brands;
    // RLS hides inactive brands, so their products simply show none.
    const { data, error } = await clients
      .public()
      .from('products')
      .select('id, brand:brands(slug, name)')
      .in('id', [...productIds]);
    if (error) throw toStoreError(error, 'product_brands');
    for (const row of data as unknown as {
      id: string;
      brand: { slug: string; name: string } | null;
    }[]) {
      if (row.brand) brands.set(row.id, { slug: row.brand.slug, name: row.brand.name });
    }
    return brands;
  }

  /**
   * One page of a listing, priced by catalog_products(): the campaign's price where one
   * governs a product, otherwise the product's own sale price. Filtering and sorting by
   * price use that same effective price, so the order of a "price: low to high" page
   * always matches the numbers on the cards. It runs with the publishable key, so Row
   * Level Security still decides what a visitor may see.
   */
  async function searchPage(    search: ProductSearch,
    branchSlugs: readonly string[] | null,
  ): Promise<{ rows: ListingRow[]; total: number }> {
    const call = (limit: number, offset: number) =>
      clients.public().rpc('catalog_products', {
        p_sort: search.sort,
        p_limit: limit,
        p_offset: offset,
        p_category_slug: sqlNull(search.categorySlug ?? null),
        p_query: sqlNull(search.prefixQuery ?? null),
        p_branch_slugs: sqlNull(branchSlugs === null ? null : [...branchSlugs]),
        p_brand_slug: sqlNull(search.brandSlug ?? null),
        p_min_price_minor: sqlNull(search.minPriceMinor ?? null),
        p_max_price_minor: sqlNull(search.maxPriceMinor ?? null),
        p_in_stock: sqlNull(search.inStock === true ? true : null),
        // Sent only when they were asked for: an unfiltered listing keeps calling the function
        // exactly as before, so browsing works whether or not the variant-filters migration has
        // been applied yet.
        ...(search.sizeSlugs === undefined || search.sizeSlugs.length === 0
          ? {}
          : { p_size_slugs: [...search.sizeSlugs] }),
        ...(search.colorSlugs === undefined || search.colorSlugs.length === 0
          ? {}
          : { p_color_slugs: [...search.colorSlugs] }),
        // Sent only when a zone was asked for: an unfiltered listing keeps calling the
        // function exactly as before, so browsing works whether or not the shopping-zones
        // migration has been applied yet.
        ...(search.zoneSlug === undefined ? {} : { p_zone_slug: search.zoneSlug }),
      });

    const { data, error } = await call(search.limit, search.offset);
    if (error) throw toStoreError(error, 'catalog_products');
    const rows = (data ?? []) as unknown as ListingRow[];
    if (rows.length > 0 || search.offset === 0) {
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    }
    // A page past the end says nothing about the size of the list; ask once more for it.
    const counted = await call(1, 0);
    if (counted.error) throw toStoreError(counted.error, 'catalog_products');
    const first = (counted.data ?? []) as unknown as ListingRow[];
    return { rows: [], total: Number(first[0]?.total_count ?? 0) };
  }
  /**
   * Cards for a set of priced rows: each product's primary image, brand, sold count and
   * colours, all in three batch reads rather than one per product.
   */
  async function summariesOf(rows: readonly ListingRow[]): Promise<ProductSummary[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [primary, brands, sold, colors] = await Promise.all([
      primaryImages(ids),
      brandsOf(ids),
      soldCounts(ids),
      supabaseProductColors(clients, ids),
    ]);
    const items = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      summary: row.summary ?? null,
      priceMinor: row.price_minor,
      compareAtPriceMinor: row.compare_at_price_minor ?? null,
      ...stockView(row),
      isFeatured: row.is_featured,
      category: { slug: row.category_slug, name: row.category_name },
      image: primary.get(row.id) ?? null,
      brand: brands.get(row.id) ?? null,
      campaign: campaignLabel(row),
      ...(colors.has(row.id) ? { colors: colors.get(row.id) } : {}),
      ...(sold.size > 0 || ids.length === 0 ? { soldCount: sold.get(row.id) ?? 0 } : {}),
    }));
    return conform(productPageSchema, items, 'catalog_products');
  }

  /** The published category tree, from the catalog cache when it has it. */
  function listCategories(): Promise<Category[]> {
    return cache.read(
      'nilzora:v1:catalog:categories',
      (value) => {
        const parsed = categoryListSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      },
      async () => {
        // One read of the published tree: hierarchy, cover images and storefront order.
        const { data, error } = await clients.public().rpc('catalog_category_tree');
        if (error) throw toStoreError(error, 'catalog_category_tree');
        const banners = await bannerKeys();
        return (data ?? []).map((row) =>
          conform(
            categorySchema,
            {
              slug: row.slug,
              name: row.name,
              description: row.description ?? null,
              productCount: Number(row.product_count),
              image: categoryImage(row.image_key),
              banner: categoryImage(banners.get(row.slug) ?? null),
              parentSlug: row.parent_slug,
              depth: row.depth,
              isFeatured: row.is_featured,
            },
            'catalog_category_tree',
          ),
        );
      },
    );
  }

  /**
   * The cards of a known set of products, in one call. `catalog_products_by_ids` prices them
   * exactly as a listing does, and RLS decides what a visitor may see.
   */
  async function cardsByIds(ids: readonly string[]): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];
    const { data, error } = await untypedRpc(clients.public())('catalog_products_by_ids', {
      p_ids: [...ids],
    });
    if (error) throw toStoreError(error, 'catalog_products_by_ids');
    return summariesOf((data ?? []) as unknown as ListingRow[]);
  }

  return {
    listCategories,

    async listProducts(search) {
      // Offsets beyond MAX_CATALOG_OFFSET never get here: the query contract refuses them.
      // A department lists its whole branch, so its subcategory slugs are resolved first
      // (from the cached tree) and sent as one filter.
      const branch =
        search.categorySlug === undefined || search.includeSubcategories !== true
          ? null
          : branchSlugs(await listCategories(), search.categorySlug);
      const { rows, total } = await searchPage(search, branch);
      return { items: await summariesOf(rows), total };
    },

    async listProductsByIds(ids) {
      return cardsByIds(ids);
    },

    async findProductByCode(code) {
      // Only the two shapes a real product label or link can carry reach the query, so the
      // scanned text can never add PostgREST filter syntax of its own.
      const value = code.trim();
      const bySku = /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(value) ? value.toUpperCase() : null;
      const bySlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.toLowerCase()) ? value.toLowerCase() : null;
      if (bySku === null && bySlug === null) return null;

      for (const [column, match] of [
        ['sku', bySku],
        ['slug', bySlug],
      ] as const) {
        if (match === null) continue;
        const { data, error } = await clients
          .public()
          .from('products')
          .select('id')
          .eq(column, match)
          .limit(1);
        if (error) throw toStoreError(error, 'products');
        const id = (data as unknown as { id: string }[] | null)?.[0]?.id;
        if (id !== undefined) {
          const [card] = await cardsByIds([id]);
          return card ?? null;
        }
      }
      return null;
    },

    async getProduct(slug) {
      // One read of the priced row: the campaign, if any, has already set its price.
      const { data, error } = await clients
        .public()
        .rpc('catalog_product', { p_slug: slug })
        .maybeSingle();
      if (error) throw toStoreError(error, 'catalog_product');
      if (!data) return null;
      const row = data as unknown as ListingRow & {
        description: string | null;
        published_at: string | null;
        brand_id: string | null;
        size_chart: unknown;
      };
      // Images, brand and variants depend only on the row above and not on each other, so
      // they travel together: one round trip instead of three sequential ones.
      const [images, brand, variants, videos, sold, colors] = await Promise.all([
        imagesOf(row.id),
        row.brand_id === null ? Promise.resolve(null) : brandById(row.brand_id),
        readVariants(slug),
        videosOf(row.id),
        soldCounts([row.id]),
        supabaseProductColors(clients, [row.id]),
      ]);
      return conform(
        productDetailSchema,
        {
          id: row.id,
          slug: row.slug,
          sku: row.sku,
          name: row.name,
          summary: row.summary,
          description: row.description,
          priceMinor: row.price_minor,
          compareAtPriceMinor: row.compare_at_price_minor,
          ...stockView(row),
          isFeatured: row.is_featured,
          category: { slug: row.category_slug, name: row.category_name },
          image: images[0] ?? null,
          images,
          brand,
          variants,
          colors: colors.get(row.id),
          sizeChart: chartWithPicture(row.size_chart, mediaBaseUrl),
          videos,
          campaign: campaignLabel(row),
          ...(sold.has(row.id) ? { soldCount: sold.get(row.id) } : {}),
        },
        'catalog_product',
      );
    },

    async getZone(slug) {
      // One indexed lookup of the public zone: inactive or unknown both answer null.
      const { data, error } = await clients.public().rpc('catalog_shopping_zone', {
        p_slug: slug,
      });
      if (error) throw toStoreError(error, 'catalog_shopping_zone');
      if (!data) return null;
      const zone = data as unknown as { id: string; slug: string; name: string };
      return { id: zone.id, slug: zone.slug, name: zone.name };
    },

    async listFacets(search) {
      const branch =
        search.categorySlug === undefined || search.includeSubcategories !== true
          ? null
          : branchSlugs(await listCategories(), search.categorySlug);
      const { data, error } = await clients.public().rpc('catalog_variant_facets', {
        p_category_slug: sqlNull(search.categorySlug ?? null),
        p_query: sqlNull(search.prefixQuery ?? null),
        p_branch_slugs: sqlNull(branch === null ? null : [...branch]),
        p_brand_slug: sqlNull(search.brandSlug ?? null),
        p_min_price_minor: sqlNull(search.minPriceMinor ?? null),
        p_max_price_minor: sqlNull(search.maxPriceMinor ?? null),
        p_in_stock: sqlNull(search.inStock === true ? true : null),
        p_zone_slug: sqlNull(search.zoneSlug ?? null),
        p_size_slugs: sqlNull(
          search.sizeSlugs === undefined || search.sizeSlugs.length === 0
            ? null
            : [...search.sizeSlugs],
        ),
        p_color_slugs: sqlNull(
          search.colorSlugs === undefined || search.colorSlugs.length === 0
            ? null
            : [...search.colorSlugs],
        ),
      });
      // A database that has not run the variant-filters migration has no facets to offer, and
      // that is not an error: the storefront simply shows no size or colour control.
      if (error) {
        if (error.code === '42883') return { sizes: [], colors: [] };
        throw toStoreError(error, 'catalog_variant_facets');
      }
      const raw = (data ?? {}) as {
        sizes?: { slug: string; value: string; count: number }[];
        colors?: { slug: string; value: string; count: number; swatchHex: string | null }[];
      };
      return {
        sizes: (raw.sizes ?? []).map((entry) => ({
          slug: entry.slug,
          value: entry.value,
          productCount: Number(entry.count),
        })),
        colors: (raw.colors ?? []).map((entry) => ({
          slug: entry.slug,
          value: entry.value,
          productCount: Number(entry.count),
          swatchHex: entry.swatchHex ?? null,
        })),
      };
    },

    async listCampaigns(categorySlug) {
      // One id lookup, then the public feed; an unknown slug simply has no campaigns.
      let categoryId: string | null = null;
      if (categorySlug !== undefined) {
        const { data, error } = await clients
          .public()
          .from('categories')
          .select('id')
          .eq('slug', categorySlug)
          .maybeSingle();
        if (error) throw toStoreError(error, 'categories');
        if (!data) return [];
        categoryId = data.id;
      }
      const { data, error } = await clients.public().rpc('catalog_campaigns', {
        p_category_id: sqlNull(categoryId),
      });
      if (error) throw toStoreError(error, 'catalog_campaigns');
      return conform(
        campaignListResponseSchema,
        {
          // The function answers through PostgREST, which writes a timestamp with an offset
          // ("+00:00"); the contract wants the Z form, so every one is normalised here.
          campaigns: (isoTimestamps(data ?? []) as CampaignRow[]).map((row) => ({
            id: row.campaign_id,
            title: row.title,
            scope: row.scope,
            discountKind: row.discount_kind,
            discountValue: Number(row.discount_value),
            maxDiscountMinor:
              row.max_discount_minor === null ? null : Number(row.max_discount_minor),
            endsAt: row.ends_at,
            banner: pictureFromKey(row.banner_image_key, mediaBaseUrl),
            productCount: Number(row.product_count),
          })),
        },
        'catalog_campaigns',
      ).campaigns;
    },
  };
}
