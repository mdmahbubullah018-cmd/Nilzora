import { slugSchema } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import type { ProductOptions } from '@/components/catalog/variant-selection';
import { readProductForCart } from '@/lib/catalog';

/*
 * GET /api/catalog/product-options?slug=cotton-shirt
 * --------------------------------------------------
 * A product card's list entry does not say whether the product is sold in variants, so its quick
 * add asks here before adding anything. The answer is the product's public detail (the same 60 s
 * cached read the product page uses), trimmed to what choosing options needs: no session, nothing
 * personal. A failure is a status the card treats as "cannot tell": it never assumes "no variants".
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!slugSchema.safeParse(slug).success) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400, headers: NO_STORE });
  }
  const read = await readProductForCart(slug);
  if (read.kind === 'missing') {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }
  if (read.kind === 'unavailable') {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  const product = read.value;
  const body: { product: ProductOptions } = {
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      priceMinor: product.priceMinor,
      compareAtPriceMinor: product.compareAtPriceMinor,
      availability: product.availability,
      maxOrderQuantity: product.maxOrderQuantity,
      variants: product.variants,
    },
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
