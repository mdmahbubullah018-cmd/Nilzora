import {
  campaignListResponseSchema,
  discoveryResponseSchema,
  hasListingFilters,
  MAX_CATALOG_OFFSET,
  productFacetsQuerySchema,
  productFacetsResponseSchema,
  productListQuerySchema,
  slugSchema,
  type CategoryListResponse,
  type DiscoveryResponse,
  type ProductFacetsResponse,
  type ProductListResponse,
  type ProductResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { requestInput, validate } from '../../middleware/validate';
import { PUBLIC_CATALOG_CACHE } from '../commerce/http';
import type { DiscoveryStore } from './discovery';
import { toPrefixQuery } from './search-query';
import { withBranchCounts, type CatalogStore } from './store';

const productListSchemas = { query: productListQuerySchema };
const productFacetSchemas = { query: productFacetsQuerySchema };
const productSchemas = { params: z.object({ slug: slugSchema }) };
const campaignSchemas = { query: z.object({ category: slugSchema.optional() }) };

/**
 * GET /catalog/categories, /catalog/products and /catalog/products/:slug — the public
 * catalog. Reads run with the publishable key, so Row Level Security decides what
 * visitors see: drafts, archived products and hidden categories never appear.
 */
export function catalogRouter(catalog: CatalogStore): Router {
  const router = Router();

  router.get('/catalog/categories', async (_req, res) => {
    // Each category also says how many products its whole branch holds (totalProductCount).
    const body: CategoryListResponse = {
      categories: withBranchCounts(await catalog.listCategories()),
    };
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  router.get('/catalog/products', validate(productListSchemas), async (_req, res) => {
    const { query } = requestInput<typeof productListSchemas>(res);
    const prefixQuery = query.q === undefined ? undefined : toPrefixQuery(query.q);
    const offset = (query.page - 1) * query.pageSize;
    // Relevance needs the plain search; a narrowed search lists the newest matches first.
    const filtered = hasListingFilters(query);
    const defaultSort = prefixQuery === undefined ? 'featured' : filtered ? 'newest' : 'relevance';

    /*
     * A zone that is unknown or hidden answers 404 rather than an empty list: a customer who
     * follows an old or shared link to a retired collection is told the truth, and a hidden
     * zone can never be probed for its contents.
     */
    if (query.zone !== undefined) {
      const zone = await catalog.getZone(query.zone);
      if (zone === null) {
        sendError(res, 404, 'not_found', 'Collection not found');
        return;
      }
    }

    // A search with no usable words matches nothing; the database is not asked.
    const { items, total } =
      prefixQuery === null
        ? { items: [], total: 0 }
        : await catalog.listProducts({
            categorySlug: query.category,
            prefixQuery,
            sort: query.sort ?? defaultSort,
            limit: query.pageSize,
            offset,
            includeSubcategories: query.includeSubcategories,
            brandSlug: query.brand,
            minPriceMinor: query.minPriceMinor,
            maxPriceMinor: query.maxPriceMinor,
            inStock: query.inStock,
            zoneSlug: query.zone,
            sizeSlugs: query.size,
            colorSlugs: query.color,
          });

    const body: ProductListResponse = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      // Never more pages than can be requested: deeper ones are refused (400).
      totalPages: Math.min(
        Math.ceil(total / query.pageSize),
        Math.floor(MAX_CATALOG_OFFSET / query.pageSize) + 1,
      ),
    };
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  router.get('/catalog/products/:slug', validate(productSchemas), async (_req, res) => {
    const { params } = requestInput<typeof productSchemas>(res);
    const product = await catalog.getProduct(params.slug);
    if (!product) {
      sendError(res, 404, 'not_found', 'Product not found');
      return;
    }
    const body: ProductResponse = { product };
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  /**
   * GET /catalog/product-facets — the sizes and colours the current listing context is sold in,
   * so a page offers only values that exist in the set it is listing. It takes the same filters
   * as the listing itself (and no paging), and answers empty lists when there are none, which a
   * client reads as "offer no size or colour control".
   */
  router.get('/catalog/product-facets', validate(productFacetSchemas), async (_req, res) => {
    const { query } = requestInput<typeof productFacetSchemas>(res);
    const prefixQuery = query.q === undefined ? undefined : toPrefixQuery(query.q);
    if (prefixQuery === null) {
      const empty: ProductFacetsResponse = { facets: { sizes: [], colors: [] } };
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(empty);
      return;
    }
    if (query.zone !== undefined) {
      const zone = await catalog.getZone(query.zone);
      // The listing answers 404 for a retired collection; there are no options to offer for it.
      if (zone === null) {
        const empty: ProductFacetsResponse = { facets: { sizes: [], colors: [] } };
        res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(empty);
        return;
      }
    }
    const facets = await catalog.listFacets({
      categorySlug: query.category,
      prefixQuery,
      includeSubcategories: query.includeSubcategories,
      brandSlug: query.brand,
      minPriceMinor: query.minPriceMinor,
      maxPriceMinor: query.maxPriceMinor,
      inStock: query.inStock,
      zoneSlug: query.zone,
      sizeSlugs: query.size,
      colorSlugs: query.color,
    });
    const body: ProductFacetsResponse = productFacetsResponseSchema.parse({ facets });
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  /**
   * GET /catalog/campaigns — the promotional campaigns a shopper may see. Only live,
   * visible campaigns that reach at least one published product are returned, and the
   * prices they set are already in every product payload; this feed is for banners.
   */
  router.get('/catalog/campaigns', validate(campaignSchemas), async (_req, res) => {
    const { query } = requestInput<typeof campaignSchemas>(res);
    const body = campaignListResponseSchema.parse({
      campaigns: await catalog.listCampaigns(query.category),
    });
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  return router;
}

/**
 * GET /catalog/discovery — what the search page shows before anyone types. The store decides
 * which sections its data supports and ranks them; a section with no evidence is absent, so
 * nothing is labelled "Best Selling" or "Top Rated" without the orders or reviews behind it.
 * Public, cacheable for the same short window as the rest of browsing.
 */
export function discoveryRouter(discovery: DiscoveryStore): Router {
  const router = Router();

  router.get('/catalog/discovery', async (_req, res) => {
    const body: DiscoveryResponse = discoveryResponseSchema.parse(await discovery.sections());
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  return router;
}
