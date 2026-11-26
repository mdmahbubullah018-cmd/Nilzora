import type { SupabaseClients } from '../../supabase/clients';

/*
 * The colours each product is sold in, for the card preview.
 *
 * Both database access modes answer from the same read-only function
 * (migration 20261231091000_catalog_product_colors.sql): reading the variant tables directly
 * is not permitted for the public role, and one call per card would be one call per product on
 * the page.
 *
 * A read failure is not an error here. A card with no dots is the truthful result when the
 * colours cannot be read, and a listing must never fail because a preview could not be drawn.
 */

export interface SummaryColor {
  valueSlug: string;
  value: string;
  swatchHex: string;
}

/** One row of `catalog_product_colors`. */
export interface ProductColorRow {
  product_id: string;
  value: string;
  value_slug: string;
  swatch_hex: string;
  position: number;
}

/**
 * Groups the rows by product, keeping the order the database returned, and drops products with
 * a single colour â€” one colour is not a choice, so a card shows nothing rather than a lone dot.
 */
export function groupProductColors(rows: readonly ProductColorRow[]): Map<string, SummaryColor[]> {
  const grouped = new Map<string, SummaryColor[]>();
  for (const row of rows) {
    const list = grouped.get(row.product_id) ?? [];
    list.push({ valueSlug: row.value_slug, value: row.value, swatchHex: row.swatch_hex });
    grouped.set(row.product_id, list);
  }
  for (const [productId, list] of grouped) {
    if (list.length < 2) grouped.delete(productId);
  }
  return grouped;
}

/** Colours for a page of products, read through the Supabase (PostgREST) client. */
export async function supabaseProductColors(
  clients: SupabaseClients,
  productIds: readonly string[],
): Promise<Map<string, SummaryColor[]>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await clients
    .public()
    .rpc('catalog_product_colors', { p_product_ids: [...productIds] });
  if (error || data === null) return new Map();
  return groupProductColors(data);
}

/** The minimum a `pg` client needs, so this module does not depend on the pool. */
interface Queryable {
  query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** Colours for a page of products, read over the direct database connection. */
export async function postgresProductColors(
  client: Queryable,
  productIds: readonly string[],
): Promise<Map<string, SummaryColor[]>> {
  if (productIds.length === 0) return new Map();
  const { rows } = await client.query(
    'select product_id, value, value_slug, swatch_hex, position from public.catalog_product_colors($1::uuid[])',
    [[...productIds]],
  );
  return groupProductColors(rows as ProductColorRow[]);
}

/**
 * The `colors` field of one product summary, already grouped. Spread into the summary so a
 * product with no choice carries no key at all, exactly as the schema describes it.
 */
export function colorView(
  colors: Map<string, SummaryColor[]>,
  productId: string,
): { colors?: SummaryColor[] } {
  const list = colors.get(productId);
  return list === undefined ? {} : { colors: list };
}

/** A caller's own `rpc(name, args)` (the Supabase client, or the wishlist's per-user call). */
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

/** Colours for a page of products through any `rpc` callable, so a user-scoped read (the
 * wishlist) uses the same function and the same grouping as the public listing. */
export async function rpcProductColors(
  rpc: Rpc,
  productIds: readonly string[],
): Promise<Map<string, SummaryColor[]>> {
  if (productIds.length === 0) return new Map();
  try {
    const rows = await rpc<ProductColorRow[] | null>('catalog_product_colors', {
      p_product_ids: [...productIds],
    });
    return groupProductColors(rows ?? []);
  } catch {
    // A preview is never worth failing a page for: no colours means no dots.
    return new Map();
  }
}

