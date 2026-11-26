import { MAX_ADDRESSES, type Address, type CartQuote } from '@nilzora/contracts';
import { buttonClasses, Card, CardContent, CardHeader, CardTitle } from '@nilzora/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import { AddressBlock, addressSummary } from '../addresses/address-block';
import { cartLineName, cartLineProblemText } from '../cart/cart-line';
import { ProductImage } from '../catalog/product-image';
import { itemCountLabel, StepBadge, textLinkClasses } from './page-parts';

/** The address the order goes to, with ways to change it. */
export function DeliveryAddressCard({
  selected,
  addresses,
}: {
  selected: Address;
  addresses: readonly Address[];
}) {
  const others = addresses.filter((address) => address.id !== selected.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">
          <StepBadge n={1} />
          Delivery address
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <AddressBlock address={selected} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            href={`/account/addresses/${selected.id}/edit?next=/checkout`}
            className={textLinkClasses}
          >
            Edit this address
          </Link>
          {addresses.length < MAX_ADDRESSES ? (
            <Link href="/account/addresses/new?next=/checkout" className={textLinkClasses}>
              Add a new address
            </Link>
          ) : null}
        </div>

        {others.length > 0 ? (
          <div className="grid gap-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold text-foreground">Deliver somewhere else</h3>
            <ul className="grid gap-2">
              {others.map((address) => (
                <li
                  key={address.id}
                  className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="grid min-w-0 gap-0.5 text-sm">
                    <p className="font-medium wrap-break-word text-foreground">
                      {addressSummary(address)}
                    </p>
                    <p className="wrap-break-word text-muted-foreground">{address.recipientName}</p>
                  </div>
                  <Link
                    href={`/checkout?address=${address.id}`}
                    className={buttonClasses({
                      variant: 'outline',
                      size: 'sm',
                      className: 'self-start sm:self-auto',
                    })}
                  >
                    Deliver here<span className="sr-only">: {addressSummary(address)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What is being ordered, as the API priced it for this page. */
export function CheckoutItemsCard({ quote }: { quote: CartQuote }) {
  const units = quote.lines.reduce((total, line) => total + line.quantity, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">
          <StepBadge n={2} />
          Items ({itemCountLabel(units)})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y divide-border">
          {quote.lines.map((line) => {
            const problem = cartLineProblemText(line);
            const name = cartLineName(line);
            return (
              <li
                key={`${line.productId}:${line.variantId ?? ''}`}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                {/* A compact square: 64px on a phone, 72px from the small breakpoint up. */}
                <ProductImage
                  image={line.image}
                  productName={name}
                  decorative
                  size="sm"
                  className="size-16 shrink-0 rounded-lg sm:size-18"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-sm font-semibold wrap-break-word text-foreground">{name}</p>
                    {line.variantLabel ? (
                      <p className="text-sm wrap-break-word text-muted-foreground">
                        {line.variantLabel}
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      Qty {line.quantity}
                      {line.unitPriceMinor !== null
                        ? ` · ${formatMoney(line.unitPriceMinor)} each`
                        : null}
                    </p>
                    {problem ? (
                      <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                        {problem}
                      </p>
                    ) : null}
                  </div>
                  {problem === null && line.lineTotalMinor !== null ? (
                    <p className="text-sm font-semibold text-foreground tabular-nums sm:shrink-0">
                      <span className="sr-only">Line total: </span>
                      {formatMoney(line.lineTotalMinor)}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <Link href="/cart" className={`justify-self-start text-sm ${textLinkClasses}`}>
          Change items in your cart
        </Link>
      </CardContent>
    </Card>
  );
}
