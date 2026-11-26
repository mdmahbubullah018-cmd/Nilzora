import { slugSchema, type ProductSummary } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import { getProduct } from '@/lib/catalog';

/*
 * GET /api/wishlist/products?slugs=a,b,c
 * --------------------------------------
 * A guest's saved products live in their browser as slugs, so the wishlist page asks for them
 * here. Only public product reads happen: no session is needed, nothing personal is returned,
 * and a slug that no longer resolves is left out rather than shown as a broken card. At most
 * 30 are resolved per request, which is the order of magnitude the page shows.
 */
const MAX_SLUGS = 30;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** The card fields of a product, taken from the detail read the catalog already offers. */
function toSummary(product: {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  availability: ProductSummary['availability'];
  maxOrderQuantity: number;
  isFeatured: boolean;
  category: { slug: string; name: string };
  image: ProductSummary['image'];
  brand?: { slug: string; name: string } | null | undefined;
  campaign?: ProductSummary['campaign'];
}): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    summary: product.summary,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    availability: product.availability,
    maxOrderQuantity: product.maxOrderQuantity,
    isFeatured: product.isFeatured,
    category: product.category,
    image: product.image,
    brand: product.brand ?? null,
    campaign: product.campaign ?? null,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const raw = new URL(request.url).searchParams.get('slugs') ?? '';
  const wanted = raw
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug !== '' && slugSchema.safeParse(slug).success)
    .slice(0, MAX_SLUGS);

  const products: ProductSummary[] = [];
  for (const slug of [...new Set(wanted)]) {
    const read = await getProduct(slug);
    if (read.kind === 'ok') products.push(toSummary(read.value));
  }
  return NextResponse.json({ products }, { headers: NO_STORE });
}
