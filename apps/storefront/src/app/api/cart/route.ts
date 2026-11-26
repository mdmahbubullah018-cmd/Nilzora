import { NextResponse } from 'next/server';
import { cartUnitCount, parseCart } from '@/lib/cart';
import { session } from '@/lib/session';

/** Units in this browser's cart, for the header badge on cacheable pages. */
export async function GET() {
  const count = cartUnitCount(parseCart(await session.cartCookie.get()));
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'private, no-store' } });
}
