import 'server-only';
import type { Voucher } from '@nilzora/contracts';
import { readAccount } from '@/lib/account-read';
import { session } from '@/lib/session';

/**
 * The vouchers a customer can collect or use on this product, for its page. The API decides what
 * applies (the product's own, its category's and the store-wide ones); a failure only means the
 * offers are left out, never that the product page breaks.
 */
export async function getProductVouchers(
  slug: string,
): Promise<{ vouchers: Voucher[]; signedIn: boolean }> {
  try {
    const mine = await readAccount((api, accessToken) => api.productVouchers(slug, accessToken));
    if (mine.kind === 'ok') return { vouchers: mine.value.vouchers, signedIn: true };
    if (mine.kind === 'signed_out') {
      const shown = await session.publicApi().productVouchers(slug, null);
      return { vouchers: shown.vouchers, signedIn: false };
    }
  } catch {
    // Offers are optional.
  }
  return { vouchers: [], signedIn: false };
}
