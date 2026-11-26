import type { ProductSummary } from '@nilzora/contracts';
import { listProducts } from '@/lib/catalog';
import { formatMoney } from '@/lib/format';

/*
 * The free-shipping claim
 * -----------------------
 * "Free Shipping on Orders ৳1,999+" is a promise about checkout, so it is shown only when BOTH
 * are true:
 *
 *   1. Checkout really waives delivery: a free-delivery policy is published that covers every
 *      order with a subtotal of ৳1,999 or more, in every delivery zone.
 *   2. The promise is reachable: at least one published, purchasable product sells for ৳1,999
 *      or more.
 *
 * Today the first is never true. Checkout always adds the flat delivery charge of the address's
 * zone (place_cod_order and the checkout quote; there is no waiver or threshold), and the API
 * publishes no free-delivery policy for the storefront to read. `freeDeliveryPolicy()` therefore
 * returns null and the claim stays hidden. When the API publishes the policy, read it there.
 */

/** The advertised threshold, in poisha: ৳1,999. */
export const FREE_SHIPPING_CLAIM_MINOR = 199_900;

/** Highest-priced products checked for a qualifying one. */
const QUALIFYING_SCAN = 24;

/** What checkout would have to publish for the claim to be true. */
export interface FreeDeliveryPolicy {
  /** Orders with at least this subtotal, in poisha, are delivered free. */
  minSubtotalMinor: number;
  /** True when the waiver applies in every delivery zone (inside and outside Dhaka). */
  allZones: boolean;
}

/**
 * The store's free-delivery policy as checkout applies it, or null when there is none.
 * There is no API field for it yet, so there is nothing to read: null.
 */
export function freeDeliveryPolicy(): FreeDeliveryPolicy | null {
  return null;
}

/** True when the policy makes every ৳1,999+ order free to deliver, wherever it goes. */
export function policyCoversClaim(
  policy: FreeDeliveryPolicy | null,
  claimMinor: number = FREE_SHIPPING_CLAIM_MINOR,
): boolean {
  return (
    policy !== null &&
    policy.allZones &&
    Number.isSafeInteger(policy.minSubtotalMinor) &&
    policy.minSubtotalMinor >= 0 &&
    policy.minSubtotalMinor <= claimMinor
  );
}

/** A product a shopper can buy right now, priced at or above the advertised threshold. */
export function isQualifyingProduct(
  product: ProductSummary,
  claimMinor: number = FREE_SHIPPING_CLAIM_MINOR,
): boolean {
  return (
    product.priceMinor >= claimMinor &&
    product.availability !== 'out_of_stock' &&
    product.maxOrderQuantity > 0
  );
}

/**
 * Whether the storefront may say "Free Shipping on Orders ৳1,999+". The catalog is only read
 * when checkout actually waives delivery, so while there is no policy this costs nothing. Any
 * doubt (a failed read, nothing qualifying among the highest-priced products) keeps it hidden.
 */
export async function showFreeShippingClaim(policy: FreeDeliveryPolicy | null): Promise<boolean> {
  if (!policyCoversClaim(policy)) return false;
  const priciest = await listProducts({ sort: 'price_desc', page: 1, pageSize: QUALIFYING_SCAN });
  if (priciest.kind !== 'ok') return false;
  return priciest.value.items.some((product) => isQualifyingProduct(product));
}

/** The claim's wording, with the threshold formatted from the same constant. */
export function freeShippingDetail(claimMinor: number = FREE_SHIPPING_CLAIM_MINOR): string {
  return `On orders ${formatMoney(claimMinor)}+`;
}
