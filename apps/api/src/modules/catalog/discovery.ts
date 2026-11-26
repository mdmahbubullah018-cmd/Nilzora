import {
  discoveryResponseSchema,
  discoverySectionSchema,
  type DiscoveryItem,
  type DiscoveryResponse,
  type DiscoverySection,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { variantKeys } from '../media/images';
import { colorView, postgresProductColors, type SummaryColor } from './colors';
import { stockView, type CatalogStore } from './store';

/*
 * Product discovery for the search page
 * -------------------------------------
 * Every section is ranked from data the store already holds, never from a hand-written list:
 *
 *   best-selling  units on orders that were confirmed and not cancelled, within 90 days
 *   trending      recent units (30 days, weighted 3Ã—) plus recent wishlist saves (1Ã— each),
 *                 so one noisy signal cannot carry a product on its own
 *   top-rated     approved reviews only, with a Bayesian prior (4.2 average, five reviews)
 *                 so one five-star review cannot outrank a long, proven history
 *   new           published, in-stock products, newest first â€” the honest fallback
 *
 * Only products on sale (active product, active category) with stock are candidates. A section
 * with no evidence is left out entirely, so no label is ever shown without the data behind it.
 * The reads need orders, wishlist rows and review moderation state, so they run on the direct
 * database connection under the service role, inside one transaction: nothing is written.
 */

/** How many products a section shows. */
export const DISCOVERY_SECTION_LIMIT = 5;
/** Read a few more candidates than are shown, so de-duplication still leaves a full section. */
const CANDIDATE_FACTOR = 3;
/** How many extra candidates the public-catalog fallback reads before the stock filter. */
const FALLBACK_EXTRA = 3;
/** The best-selling window: recent enough to be a current claim. */
const BEST_SELLING_DAYS = 90;
/** Trending looks at the last month of sales and saves. */
const TRENDING_DAYS = 30;
/** A gentle prior that pulls a one-review product back towards the shop's average. */
const PRIOR_AVERAGE = 4.2;
const PRIOR_REVIEWS = 5;

const TITLES = {
  'best-selling': 'Best Selling',
  trending: 'Trending Now',
  'top-rated': 'Top Rated',
  new: 'New at Nilzora',
} as const;

export interface DiscoveryStore {
  /** The sections the data supports, each already ranked and capped. */
  sections(limit?: number): Promise<DiscoveryResponse>;
}

export interface DiscoveryRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  price_minor: number | string;
  compare_at_price_minor: number | string | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  category_slug: string;
  category_name: string;
  brand_slug: string | null;
  brand_name: string | null;
  image_id: string | null;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  image_position: number | null;
  average_rating: number | string | null;
  review_count: number | string | null;
}

/** One ranked row as a card can show it. */
function toItem(
  row: DiscoveryRow,
  mediaBaseUrl: string | undefined,
  colors: Map<string, SummaryColor[]>,
): DiscoveryItem {
  const reviewCount = row.review_count === null ? 0 : Number(row.review_count);
  const image =
    row.image_id === null || row.image_key === null || mediaBaseUrl === undefined
      ? null
      : (() => {
          const [full, thumb] = variantKeys(row.image_key);
          return {
            id: row.image_id,
            url: `${mediaBaseUrl}/${full}`,
            thumbUrl: `${mediaBaseUrl}/${thumb}`,
            alt: row.image_alt,
            width: row.image_width ?? 1,
            height: row.image_height ?? 1,
            position: row.image_position ?? 0,
          };
        })();

  /** Discovery items carry the same card colour preview as every other listing. */
  return {
    product: {
      id: row.id,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      summary: row.summary,
      priceMinor: Number(row.price_minor),
      compareAtPriceMinor:
        row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
      ...stockView({
        stock_quantity: row.stock_quantity,
        max_order_quantity: row.max_order_quantity,
      }),
      isFeatured: row.is_featured,
      category: { slug: row.category_slug, name: row.category_name },
      image,
      brand:
        row.brand_slug === null || row.brand_name === null
          ? null
          : { slug: row.brand_slug, name: row.brand_name },
      // Discovery rows come from a ranking query that does not resolve campaigns, so the
      // card shows no campaign label; the price is the product's own and is correct.
      campaign: null,
      ...colorView(colors, row.id),
    },
    rating:
      reviewCount === 0 ? null : { averageRating: Number(row.average_rating ?? 0), reviewCount },
  };
}

/**
 * Turns the ranked rows into sections, in order, without showing the same product in every
 * section while an alternative exists. A section only falls back to rows shown earlier when
 * the catalogue has no fresh candidate at all for it.
 */
export function assembleSections(
  ranked: readonly {
    key: keyof typeof TITLES;
    rows: readonly DiscoveryRow[];
  }[],
  limit: number,
  mediaBaseUrl: string | undefined,
  colors: Map<string, SummaryColor[]> = new Map(),
): DiscoverySection[] {
  const seen = new Set<string>();
  const sections: DiscoverySection[] = [];

  for (const { key, rows } of ranked) {
    const fresh: DiscoveryRow[] = [];
    const repeats: DiscoveryRow[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) repeats.push(row);
      else fresh.push(row);
    }
    const rowsToShow = (fresh.length > 0 ? fresh : repeats).slice(0, limit);
    if (rowsToShow.length === 0) continue;
    for (const shownRow of rowsToShow) seen.add(shownRow.id);
    sections.push(
      discoverySectionSchema.parse({
        key,
        title: TITLES[key],
        items: rowsToShow.map((shownRow) => toItem(shownRow, mediaBaseUrl, colors)),
      }),
    );
  }

  return sections;
}

/** The columns every section needs, with the primary image and the approved rating. */
const candidatesSql = (orderBy: string, extra: string) => `
with eligible as (
  select
    p.id, p.slug, p.sku, p.name, p.summary, p.price_minor, p.compare_at_price_minor,
    p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at, p.brand_id,
    c.slug as category_slug, c.name as category_name,
    b.slug as brand_slug, b.name as brand_name,
    i.id as image_id, i.storage_key as image_key, i.alt_text as image_alt,
    i.width as image_width, i.height as image_height, i.position as image_position
  from public.products p
  join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id and b.is_active
  left join lateral (
    select pi.id, pi.storage_key, pi.alt_text, pi.width, pi.height, pi.position
    from public.product_images pi
    where pi.product_id = p.id
    order by pi.position
    limit 1
  ) i on true
  where p.status = 'active'
    and c.is_active
    and p.stock_quantity > 0
),
approved_ratings as (
  select r.product_id,
         count(*)::int as review_count,
         round(avg(r.rating)::numeric, 2) as average_rating
  from public.product_reviews r
  where r.status = 'approved'
  group by r.product_id
)
${extra}
select e.*, ar.average_rating, ar.review_count
from eligible e
${orderBy}
limit $1
`;

const SALES_UNITS = `
sales_units as (
  select oi.product_id, sum(oi.quantity)::int as units
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status in ('confirmed', 'processing', 'shipped', 'delivered')
    and o.placed_at >= now() - make_interval(days => $2::int)
  group by oi.product_id
)`;

const BEST_SELLING_QUERY = candidatesSql(
  `join sales_units s on s.product_id = e.id
   left join approved_ratings ar on ar.product_id = e.id
   order by s.units desc, e.published_at desc nulls last, e.id`,
  `, ${SALES_UNITS}`,
);

const TRENDING_QUERY = candidatesSql(
  `join activity a on a.product_id = e.id
   left join approved_ratings ar on ar.product_id = e.id
   order by a.score desc, a.units desc, a.saves desc, e.published_at desc nulls last, e.id`,
  `,
recent_sales as (
  select oi.product_id, sum(oi.quantity)::int as units
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status in ('confirmed', 'processing', 'shipped', 'delivered')
    and o.placed_at >= now() - make_interval(days => $2::int)
  group by oi.product_id
),
recent_saves as (
  select w.product_id, count(*)::int as saves
  from public.wishlist_items w
  where w.created_at >= now() - make_interval(days => $2::int)
  group by w.product_id
),
activity as (
  select coalesce(s.product_id, v.product_id) as product_id,
         coalesce(s.units, 0) * 3 + coalesce(v.saves, 0) as score,
         coalesce(s.units, 0) as units,
         coalesce(v.saves, 0) as saves
  from recent_sales s
  full join recent_saves v on v.product_id = s.product_id
)`,
);

const TOP_RATED_QUERY = candidatesSql(
  `join approved_ratings ar on ar.product_id = e.id
   order by
     (ar.average_rating * ar.review_count + $2::numeric * $3::numeric)
       / (ar.review_count + $3::numeric) desc,
     ar.review_count desc,
     ar.average_rating desc,
     e.published_at desc nulls last,
     e.id`,
  '',
);

const NEWEST_QUERY = candidatesSql(
  `left join approved_ratings ar on ar.product_id = e.id
   order by e.published_at desc nulls last, e.id`,
  '',
);

interface RankedQuery {
  key: keyof typeof TITLES;
  sql: string;
  params: (limit: number) => (number | string)[];
}

const QUERIES: readonly RankedQuery[] = [
  {
    key: 'best-selling',
    sql: BEST_SELLING_QUERY,
    params: (limit) => [limit, BEST_SELLING_DAYS],
  },
  { key: 'trending', sql: TRENDING_QUERY, params: (limit) => [limit, TRENDING_DAYS] },
  {
    key: 'top-rated',
    sql: TOP_RATED_QUERY,
    params: (limit) => [limit, PRIOR_AVERAGE, PRIOR_REVIEWS],
  },
  { key: 'new', sql: NEWEST_QUERY, params: (limit) => [limit] },
];

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit)) return DISCOVERY_SECTION_LIMIT;
  return Math.min(Math.max(limit, 1), 12);
}

/**
 * Runs the four fixed reads in one read-only transaction on the API's own database role.
 * Role switching is deliberately not used: the `service_role` grants on these tables are
 * withheld by the migrations, while this connection already owns the reads the shop needs.
 * The transaction is READ ONLY, so a future edit to these queries cannot write anything.
 */
async function readRanked(pool: Pool, limit: number) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin read only');
    const ranked: { key: keyof typeof TITLES; rows: DiscoveryRow[] }[] = [];
    // Sequential on one connection inside the transaction; four fixed queries, no N+1.
    for (const query of QUERIES) {
      const result = await client.query<DiscoveryRow>(query.sql, query.params(limit));
      ranked.push({ key: query.key, rows: result.rows });
    }
    // The card's colour previews, read once for every row the sections may show, in the same
    // read-only transaction.
    const ids = [...new Set(ranked.flatMap((section) => section.rows.map((row) => row.id)))];
    const colors = await postgresProductColors(client, ids);
    await client.query('commit');
    return { ranked, colors };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresDiscoveryStore(
  pool: Pool,
  { mediaBaseUrl }: { mediaBaseUrl?: string | undefined } = {},
): DiscoveryStore {
  return {
    async sections(limit = DISCOVERY_SECTION_LIMIT) {
      const shown = boundedLimit(limit);
      const { ranked, colors } = await readRanked(pool, shown * CANDIDATE_FACTOR);

      return discoveryResponseSchema.parse({
        sections: assembleSections(ranked, shown, mediaBaseUrl, colors),
      });
    },
  };
}

/**
 * Without a direct database connection the API cannot read orders, wishlist rows or review
 * moderation state. Rather than invent a ranking, this honest fallback offers what the public
 * catalog can prove: the newest products on sale. No other section appears.
 */
export function createCatalogDiscoveryStore(catalog: CatalogStore): DiscoveryStore {
  return {
    async sections(limit = DISCOVERY_SECTION_LIMIT) {
      const shown = boundedLimit(limit);
      const { items } = await catalog.listProducts({
        sort: 'newest',
        limit: shown + FALLBACK_EXTRA,
        offset: 0,
      });
      const products = items
        .filter((product) => product.availability !== 'out_of_stock')
        .slice(0, shown);
      return discoveryResponseSchema.parse({
        sections:
          products.length === 0
            ? []
            : [
                {
                  key: 'new',
                  title: TITLES.new,
                  items: products.map((product) => ({ product, rating: null })),
                },
              ],
      });
    },
  };
}
