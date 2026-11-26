import { MAX_LINE_QUANTITY, slugSchema, type CartLine } from '@nilzora/contracts';
import { CircleAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Price } from '@/components/catalog/price';
import { ProductImage } from '@/components/catalog/product-image';
import { CampaignLabel } from '@/components/marketing/campaign-highlights';
import { formatMoney } from '@/lib/format';
import { CartQuantityForm, CartRemoveForm } from './cart-line-controls';

/** A product page link, only for a slug of the catalog's shape (it comes from the API). */
export function productHref(slug: string | null | undefined): Route | null {
  if (!slugSchema.safeParse(slug).success) return null;
  // The slug is lower-case words and hyphens, so the path cannot change route.
  return `/products/${slug}` as Route;
}

/** Why a line cannot be ordered as it is, in plain words; null when it can. */
export function cartLineProblemText(
  line: Pick<CartLine, 'problem' | 'availableQuantity'>,
): string | null {
  if (line.problem === null) return null;
  if (line.problem === 'variant_required') return 'Choose an option for this product';
  if (line.problem === 'variant_invalid') return 'That option is no longer sold';
  if (line.problem === 'unavailable' || line.availableQuantity === null) {
    return 'No longer available';
  }
  if (line.availableQuantity === 0) return 'Out of stock';
  if (line.problem === 'insufficient_stock') return `Only ${line.availableQuantity} left`;
  return `At most ${line.availableQuantity} per order`;
}

/** The product's name, or a stand-in when it is no longer on sale (the API hides it). */
export function cartLineName(line: Pick<CartLine, 'name'>): string {
  return line.name ?? 'Product no longer available';
}

export function CartLineItem({ line }: { line: CartLine }) {
  const name = cartLineName(line);
  const problem = cartLineProblemText(line);
  const href = line.problem === 'unavailable' ? null : productHref(line.slug);
  // A quantity can be chosen only while the product is on sale with stock to offer.
  const canChooseQuantity = line.availableQuantity !== null && line.availableQuantity > 0;
  return (
    <li className="flex gap-4 py-5 sm:gap-5">
      <ProductImage
        image={line.image}
        productName={name}
        decorative
        size="sm"
        className="size-20 rounded-xl sm:size-24"
      />
      <div className="grid min-w-0 flex-1 gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="grid min-w-0 gap-1">
            <h3 className="text-base font-semibold wrap-break-word text-foreground">
              {href ? (
                <Link href={href} className="rounded-sm underline-offset-4 hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
            </h3>
            {line.variantLabel ? (
              <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
            ) : null}
            {line.unitPriceMinor !== null ? (
              <Price
                priceMinor={line.unitPriceMinor}
                compareAtPriceMinor={line.compareAtPriceMinor}
                size="sm"
              />
            ) : null}
            {line.campaign !== null ? <CampaignLabel campaign={line.campaign} /> : null}
            {problem ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                {problem}
              </p>
            ) : null}
          </div>
          {/* Lines with a problem are left out of the subtotal, so no line total is shown. */}
          {problem === null && line.lineTotalMinor !== null ? (
            <p className="text-sm font-semibold text-foreground tabular-nums sm:text-right">
              <span className="sr-only">Line total: </span>
              {formatMoney(line.lineTotalMinor)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {canChooseQuantity ? (
            <CartQuantityForm
              productId={line.productId}
              variantId={line.variantId ?? undefined}
              productName={name}
              quantity={line.quantity}
              maxQuantity={Math.min(
                Math.max(line.availableQuantity ?? 0, line.quantity),
                MAX_LINE_QUANTITY,
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Quantity: {line.quantity}</p>
          )}
          <CartRemoveForm
            productId={line.productId}
            variantId={line.variantId ?? undefined}
            productName={name}
          />
        </div>
      </div>
    </li>
  );
}
