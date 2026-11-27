import { orderListQuerySchema, type OrderSummary } from '@nilzora/contracts';
import { buttonClasses, Card, CardContent, EmptyState, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { ProductImage } from '@/components/catalog/product-image';
import { ProductVisual } from '@/components/catalog/product-visual';
import { OrderStatusBadge } from '@/components/orders/order-status';
import { ProductsToReview } from '@/components/product/products-to-review';
import { AccountNav } from '@/components/account/account-nav';
import { itemCountLabel, PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { formatLongDate, formatMoney } from '@/lib/format';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 10;
const PREVIEW_LINES = 3;

/** `?page=` as the API accepts it (1–1000); anything else shows the first page. */
function pageFrom(params: SearchParams): number {
  const raw = singleParam(params, 'page');
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return 1;
  const parsed = orderListQuerySchema.shape.page.safeParse(raw);
  return parsed.success ? parsed.data : 1;
}

function pageHref(page: number) {
  return page <= 1 ? '/account/orders' : (`/account/orders?page=${page}` as const);
}

/**
 * What was ordered, as pictures first: the customer recognises an order by what is in the
 * parcel far faster than by its number. Lines past the third are counted, not listed.
 */
function OrderPreview({ order }: { order: OrderSummary }) {
  const lines = order.preview.slice(0, PREVIEW_LINES);
  const [first] = lines;
  const summary =
    lines.length === 0
      ? 'Your items'
      : lines.length === 1 && first !== undefined
        ? `${String(first.quantity)} × ${first.productName}`
        : lines.map((line) => line.productName).join(', ');
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex shrink-0 -space-x-3">
        {lines.length === 0 ? (
          <ProductVisual size="sm" className="shadow-none" />
        ) : (
          lines.map((line, index) => (
            <ProductImage
              key={`${line.productName}-${String(index)}`}
              image={line.image}
              productName={line.productName}
              decorative
              // A stack of pictures: each one overlaps the previous, ringed in the page white.
              className="size-14 rounded-lg shadow-sm ring-2 ring-surface"
            />
          ))
        )}
      </div>
      <div className="grid min-w-0 gap-0.5">
        <p className="line-clamp-2 text-sm font-medium wrap-break-word text-foreground">
          {summary}
        </p>
        {first?.variantLabel ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{first.variantLabel}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{itemCountLabel(order.itemCount)}</p>
      </div>
    </div>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const page = pageFrom(await searchParams);
  const read = await readAccount((api, accessToken) =>
    api.listOrders(accessToken, { page, pageSize: PAGE_SIZE }),
  );
  if (read.kind === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(pageHref(page))}`);
  }
  /*
   * The products waiting for a review. A failure here hides the section instead of failing the
   * page: the orders are what the customer came for, and the reminder is only ever an extra.
   */
  const waiting =
    read.kind === 'ok'
      ? await readAccount((api, accessToken) => api.pendingReviews(accessToken))
      : { kind: 'unavailable' as const };
  const now = new Date().toISOString();

  const header = (
    <>
      <AccountNav current="/account/orders" />
      <PageHeader
        title="Your orders"
        description="Follow your deliveries. You pay each order in cash when it arrives."
      />
    </>
  );
  if (read.kind === 'suspended') {
    return (
      <PageFrame>
        {header}
        <SuspendedState />
      </PageFrame>
    );
  }
  if (read.kind !== 'ok') {
    return (
      <PageFrame>
        {header}
        <UnavailableState title="We could not load your orders" retryHref={pageHref(page)} />
      </PageFrame>
    );
  }

  const { orders, total, totalPages } = read.value;
  const toReview =
    page === 1 && waiting.kind === 'ok' && waiting.value.items.length > 0 ? (
      <ProductsToReview
        items={waiting.value.items}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
        now={now}
      />
    ) : null;

  if (orders.length === 0) {
    return (
      <PageFrame>
        {header}
        {toReview}
        <Card>
          {total === 0 ? (
            <EmptyState
              icon={Package}
              title="No orders yet"
              description="When you place an order, you can follow it here."
              className="py-14"
              action={
                <Link href="/products" className={buttonClasses()}>
                  Start shopping
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title="There are no orders on this page"
              className="py-14"
              action={
                <Link href="/account/orders" className={buttonClasses({ variant: 'outline' })}>
                  Go to your latest orders
                </Link>
              }
            />
          )}
        </Card>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {header}
      {toReview}
      <ul className="grid gap-3">
        {orders.map((order) => (
          <li key={order.orderNumber}>
            <Card>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <OrderPreview order={order} />
                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end sm:gap-5">
                  <div className="grid gap-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Link
                        href={`/account/orders/${order.orderNumber}`}
                        className="rounded-sm font-semibold text-foreground underline-offset-4 hover:underline"
                      >
                        Order {order.orderNumber}
                      </Link>
                      <OrderStatusBadge status={order.status} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Placed on{' '}
                      <time dateTime={order.placedAt}>{formatLongDate(order.placedAt)}</time>
                    </p>
                    <Link
                      href={`/account/orders/${order.orderNumber}/receipt`}
                      className="justify-self-start rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
                    >
                      Receipt
                    </Link>
                  </div>
                  <p className="font-display text-lg font-semibold text-foreground tabular-nums">
                    <span className="sr-only">Total: </span>
                    {formatMoney(order.totalMinor)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {totalPages > 1 ? (
        <nav aria-label="Order pages" className="flex flex-wrap items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClasses({ variant: 'outline' })}>
              <ChevronLeft aria-hidden="true" />
              Previous page
            </Link>
          ) : (
            <span />
          )}
          <p className="order-first w-full text-center text-sm text-muted-foreground sm:order-0 sm:w-auto">
            Page {page} of {totalPages}
          </p>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className={buttonClasses({ variant: 'outline' })}>
              Next page
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </PageFrame>
  );
}
