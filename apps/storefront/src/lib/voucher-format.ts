import type { Voucher } from '@nilzora/contracts';
import { formatMoney } from '@/lib/format';

/*
 * How a voucher reads, shared by the Voucher Center, My Vouchers and checkout. Every figure
 * comes from the API; nothing here decides whether a voucher applies.
 */

const DHAKA_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dhaka',
});

/** "10% OFF", "৳150 OFF" or "FREE DELIVERY". */
export function voucherDiscount(voucher: Pick<Voucher, 'kind' | 'value'>): string {
  if (voucher.kind === 'free_delivery') return 'FREE DELIVERY';
  return voucher.kind === 'percent' ? `${String(voucher.value)}% OFF` : `${formatMoney(voucher.value)} OFF`;
}

/** The cap and minimum spend, e.g. "Min. spend ৳1,500 · Up to ৳300 off". */
export function voucherConditions(
  voucher: Pick<Voucher, 'minOrderMinor' | 'maxDiscountMinor' | 'kind'>,
): string {
  const parts = [
    voucher.minOrderMinor > 0 ? `Min. spend ${formatMoney(voucher.minOrderMinor)}` : 'No minimum spend',
  ];
  if (voucher.kind === 'percent' && voucher.maxDiscountMinor !== null) {
    parts.push(`Up to ${formatMoney(voucher.maxDiscountMinor)} off`);
  }
  return parts.join(' · ');
}

/** What the voucher applies to. */
export function voucherEligibility(voucher: Pick<Voucher, 'scope' | 'categories' | 'products'>): string {
  if (voucher.scope === 'categories') {
    const names = voucher.categories.map((category) => category.name);
    return names.length > 0 ? `On ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and more' : ''}` : 'On selected categories';
  }
  if (voucher.scope === 'products') {
    const names = voucher.products.map((product) => product.name);
    return names.length === 1 ? `On ${names[0] ?? 'one product'}` : 'On selected products';
  }
  return 'On everything in the store';
}

/** "Valid until 12 Dec 2026", "Expired 3 Dec 2026", "Starts 1 Jan 2027" or "No expiry". */
export function voucherValidity(voucher: Pick<Voucher, 'startsAt' | 'endsAt' | 'state'>): string {
  if (voucher.state === 'upcoming' && voucher.startsAt) {
    return `Starts ${DHAKA_DATE.format(new Date(voucher.startsAt))}`;
  }
  if (!voucher.endsAt) return 'No expiry date';
  const date = DHAKA_DATE.format(new Date(voucher.endsAt));
  return voucher.state === 'expired' ? `Expired ${date}` : `Valid until ${date}`;
}

/** Whether a voucher is shown faded: over, used up, or not yet started. */
export function voucherInactive(voucher: Pick<Voucher, 'state'>): boolean {
  return voucher.state === 'expired' || voucher.state === 'used' || voucher.state === 'fully_collected';
}
