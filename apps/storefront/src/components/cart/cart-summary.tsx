import type { CartQuote } from '@nilzora/contracts';
import { Button, buttonClasses, Card, CardContent, CardHeader, CardTitle } from '@nilzora/ui';
import { Banknote, Truck } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import { itemCountLabel, SummaryList, SummaryRow } from '../checkout/page-parts';

/** The cart's totals and the way on to checkout. Every amount is the API's quote. */
export function CartSummary({ quote }: { quote: CartQuote }) {
  const needsAttention = quote.lines.some((line) => line.problem !== null);
  return (
    <Card className="shadow-lg ring-1 shadow-brand-navy/5 ring-primary/10 lg:sticky lg:top-48">
      <CardHeader>
        <CardTitle as="h2" id="cart-summary-heading">
          Order summary
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <SummaryList>
          <SummaryRow label={`Subtotal (${itemCountLabel(quote.itemCount)})`}>
            {formatMoney(quote.subtotalMinor)}
          </SummaryRow>
          {quote.campaignDiscountMinor > 0 ? (
            <SummaryRow label="Promotional saving included">
              {`−${formatMoney(quote.campaignDiscountMinor)}`}
            </SummaryRow>
          ) : null}
        </SummaryList>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Truck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Delivery charge calculated at checkout
        </p>

        {quote.purchasable ? (
          <Link href="/checkout" className={buttonClasses({ size: 'lg', className: 'w-full' })}>
            Proceed to checkout
          </Link>
        ) : (
          <div className="grid gap-2">
            <Button size="lg" className="w-full" disabled aria-describedby="cart-blocked-reason">
              Proceed to checkout
            </Button>
            <p id="cart-blocked-reason" className="text-sm text-red-700">
              {needsAttention
                ? 'Some items need attention. Remove them or change their quantities to continue.'
                : 'Your cart cannot be checked out right now.'}
            </p>
          </div>
        )}

        <p className="flex items-start gap-2 border-t border-border pt-4 text-sm text-body">
          <Banknote aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          Cash on Delivery — pay when your parcel arrives
        </p>
      </CardContent>
    </Card>
  );
}
