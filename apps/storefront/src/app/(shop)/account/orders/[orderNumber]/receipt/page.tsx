import { orderNumberSchema, receiptShareText, receiptText } from '@nilzora/contracts';
import { buttonClasses, Card, CardContent, PageHeader } from '@nilzora/ui';
import { ArrowRight, MessageCircle, Package } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { BackLink, PageFrame } from '@/components/checkout/page-parts';
import { CartClearedSignal } from '@/components/orders/cart-cleared-signal';
import { OrderReceipt } from '@/components/orders/order-receipt';
import { OrderSuccess } from '@/components/orders/order-success';
import { ReceiptActions } from '@/components/orders/receipt-actions';
import { readAccount } from '@/lib/account-read';
import { singleParam, type SearchParams } from '@/lib/auth-params';

export const metadata: Metadata = {
  title: 'Receipt',
  // A receipt is private: no search engine, no link preview of any part of it.
  robots: { index: false, follow: false },
};

/**
 * The customer's receipt for one order.
 *
 * It reads the order through the same authenticated call as the order page, so another
 * customer's receipt is a not-found answer rather than a document. `?placed=1` — set only by
 * the checkout redirect — adds the confirmation and clears the cart cookie; the receipt
 * itself is identical either way, which is why it can be reopened from the order page and
 * from the order list at any time.
 */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const parsed = orderNumberSchema.safeParse((await params).orderNumber);
  if (!parsed.success) notFound();
  const orderNumber = parsed.data;
  const query = await searchParams;
  const placed = singleParam(query, 'placed') === '1';

  const read = await readAccount((api, accessToken) => api.getOrder(accessToken, orderNumber));
  if (read.kind === 'signed_out') redirect(`/login?next=/account/orders/${orderNumber}/receipt`);
  // Missing and other customers' orders look the same, so order numbers cannot be probed.
  if (read.kind === 'not_found') notFound();

  const back = <BackLink href={`/account/orders/${orderNumber}`}>Back to order details</BackLink>;
  if (read.kind === 'suspended') {
    return (
      <PageFrame>
        {back}
        <PageHeader title={`Receipt for order ${orderNumber}`} />
        <SuspendedState />
      </PageFrame>
    );
  }
  if (read.kind !== 'ok') {
    return (
      <PageFrame>
        {back}
        <PageHeader title={`Receipt for order ${orderNumber}`} />
        <UnavailableState
          title="We could not load this receipt"
          retryHref={`/account/orders/${orderNumber}/receipt`}
        />
      </PageFrame>
    );
  }

  const { order } = read.value;
  const pdfHref = `/account/orders/${orderNumber}/receipt/pdf`;

  // Just after placing: a concise confirmation with two actions, not the whole receipt.
  if (placed) {
    return (
      <PageFrame>
        <CartClearedSignal />
        <OrderSuccess order={order} pdfHref={pdfHref} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {back}
      <PageHeader
        title={`Receipt for order ${orderNumber}`}
        description={
          order.status === 'cancelled'
            ? 'This order was cancelled. The receipt below shows what was ordered; nothing is due.'
            : 'Keep this for your records. You can open it again at any time from your orders.'
        }
      />

      <OrderReceipt order={order} />

      <div className="nz-no-print grid gap-4">
        <ReceiptActions
          orderNumber={orderNumber}
          pdfHref={pdfHref}
          receiptText={receiptText(order)}
          shareText={receiptShareText(order)}
        />
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/account/orders/${orderNumber}`}
            className={buttonClasses({ variant: 'outline' })}
          >
            <Package aria-hidden="true" />
            Order details
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/products" className={buttonClasses({ variant: 'ghost' })}>
            Continue shopping
          </Link>
        </div>
      </div>

      <Card className="nz-no-print">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Something wrong with this order? Open the order and ask us from there.
          </p>
          <Link
            href={`/account/orders/${orderNumber}`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            Get help with this order
          </Link>
        </CardContent>
      </Card>
    </PageFrame>
  );
}
