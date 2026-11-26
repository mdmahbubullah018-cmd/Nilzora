import type { CartLineImage, CartQuote } from '@nilzora/contracts';
import type { SupabaseClients } from '../../supabase/clients';
import { IMAGE_COLUMNS, toProductImage, type ImageRow } from '../media/images';

/*
 * Cart pictures
 * -------------
 * quote_cart prices a cart; it says nothing about pictures. The catalogue already knows
 * them, so the pictures are joined on here, in the API, and the pricing function is left
 * exactly as it is:
 *
 *   - a line's chosen variant's own image wins (product_variants.image_url);
 *   - otherwise the product's primary image (product_images at position 0);
 *   - otherwise null, and the app draws its own placeholder tile.
 *
 * Variant rows are only reachable through catalog_product_variants(), the same public
 * function the product screen reads, so no new SQL and no weaker RLS are needed.
 *
 * A picture is decoration: if this lookup fails the quote is still returned, just without
 * images. A cart that cannot show a photo must never become a cart that cannot be priced.
 */

/** One row of catalog_product_variants(); only the variant's own picture is read. */
type VariantImageRow = { variant_id: string; image_url: string | null };

export interface CartLineImagesOptions {
  /** Public base URL of the media bucket; without it no product picture can be built. */
  mediaBaseUrl?: string | undefined;
}

/** Adds each line's picture to a quote. Never throws. */
export type WithLineImages = <Quote extends CartQuote>(quote: Quote) => Promise<Quote>;

const NO_IMAGES: WithLineImages = (quote) => Promise.resolve(quote);

export function createCartLineImages(
  clients: SupabaseClients,
  { mediaBaseUrl }: CartLineImagesOptions = {},
): WithLineImages {
  if (mediaBaseUrl === undefined) return NO_IMAGES;

  /** The primary image of each product, by product id (one query for the whole cart). */
  async function primaryImages(productIds: readonly string[]): Promise<Map<string, CartLineImage>> {
    const images = new Map<string, CartLineImage>();
    if (productIds.length === 0) return images;
    const { data, error } = await clients
      .public()
      .from('product_images')
      .select(`product_id, ${IMAGE_COLUMNS}`)
      .in('product_id', [...productIds])
      .eq('position', 0);
    if (error) throw new Error(error.message);
    for (const row of data as unknown as (ImageRow & { product_id: string })[]) {
      const image = toProductImage(row, mediaBaseUrl);
      if (image === null) continue;
      images.set(row.product_id, { url: image.url, thumbUrl: image.thumbUrl, alt: image.alt });
    }
    return images;
  }

  /**
   * The chosen variants' own pictures, by variant id. There is no public read of the
   * variants table, so each distinct product slug in the cart is asked for its variants.
   */
  async function variantImages(
    lines: readonly { slug: string | null; variantId: string | null }[],
  ): Promise<Map<string, string>> {
    const images = new Map<string, string>();
    const wanted = new Set(
      lines.flatMap((line) => (line.variantId === null ? [] : [line.variantId])),
    );
    const slugs = [...new Set(lines.flatMap((line) => (line.slug === null ? [] : [line.slug])))];
    if (wanted.size === 0 || slugs.length === 0) return images;
    const answers = await Promise.all(
      slugs.map((slug) => clients.public().rpc('catalog_product_variants', { p_slug: slug })),
    );
    for (const { data, error } of answers) {
      if (error) throw new Error(error.message);
      for (const variant of (data ?? []) as unknown as VariantImageRow[]) {
        if (!wanted.has(variant.variant_id)) continue;
        const url = variant.image_url?.trim();
        if (url !== undefined && url !== '') images.set(variant.variant_id, url);
      }
    }
    return images;
  }

  return async function withLineImages<Quote extends CartQuote>(quote: Quote): Promise<Quote> {
    // Only lines that can show a picture at all are looked up: a product that is not on
    // sale reveals nothing, pictures included.
    const shown = quote.lines.filter((line) => line.problem !== 'unavailable' && line.name);
    if (shown.length === 0) return quote;
    try {
      const [primary, variants] = await Promise.all([
        primaryImages([...new Set(shown.map((line) => line.productId))]),
        variantImages(shown.map((line) => ({ slug: line.slug, variantId: line.variantId }))),
      ]);
      return {
        ...quote,
        lines: quote.lines.map((line) => {
          if (line.problem === 'unavailable' || line.name === null) return line;
          const variantUrl = line.variantId === null ? undefined : variants.get(line.variantId);
          const image: CartLineImage | null =
            variantUrl === undefined
              ? (primary.get(line.productId) ?? null)
              : { url: variantUrl, thumbUrl: variantUrl, alt: null };
          return { ...line, image };
        }),
      };
    } catch {
      // See the note above: no picture is better than a cart that cannot be priced.
      return quote;
    }
  };
}
