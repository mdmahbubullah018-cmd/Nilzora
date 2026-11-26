import type { CartItem, CartQuote } from '@nilzora/contracts';
import {
  Alert,
  buttonClasses,
  Card,
  CardContent,
  CartGlyph,
  EmptyState,
  PageHeader,
} from '@nilzora/ui';
import { ApiError } from '@nilzora/web-session';
import { CloudOff, RotateCw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CartEmptiedSignal } from '@/components/cart/cart-emptied-signal';
import { CartLineItem } from '@/components/cart/cart-line';
import { CartFormsProvider } from '@/components/cart/cart-line-controls';
import { CartSummary } from '@/components/cart/cart-summary';
import { itemCountLabel, PageFrame, textLinkClasses } from '@/components/checkout/page-parts';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { cartUnitCount, parseCart } from '@/lib/cart';
import { removeCartLineAction, updateCartLineAction } from '@/lib/cart-actions';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false, follow: false },
};

/**
 * Why checkout sent the customer back here, chosen by a known flag. Query text is
 * never displayed, so a crafted link cannot put its own words on the page.
 */
const ISSUE_NOTICES: Readonly<Record<string, string>> = {
  stock:
    'Some items no longer have enough stock for your order. Change their quantities, then check out again.',
  unavailable:
    'Some items in your cart are no longer available. Remove them, then check out again.',
  limit: 'Some quantities are above what one order may hold. Lower them, then check out again.',
  invalid: 'Your cart could not be checked out as it was. Review it, then check out again.',
  options:
    'Some items need a size, colour or other option, or the option you chose is no longer sold. Choose the options on each item, then check out again.',
};

function issueNoticeFrom(params: SearchParams): string | undefined {
  const issue = singleParam(params, 'issue');
  return issue !== undefined && Object.hasOwn(ISSUE_NOTICES, issue)
    ? ISSUE_NOTICES[issue]
    : undefined;
}

/** Prices the cart with the API, or null when no price can be shown right now. */
async function priceCart(items: CartItem[]): Promise<CartQuote | null> {
  try {
    const api = await session.api();
    return (await api.quoteCart(items)).quote;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    console.error('[nilzora] cart quote failed', {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
    return null;
  }
}

function EmptyCart() {
  return (
    <PageFrame width="lg">
      <PageHeader title="Your cart" />
      <CartEmptiedSignal />
      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-brand-sky/15 blur-3xl"
        />
        <div className="relative grid justify-items-center gap-5 px-6 py-16 text-center">
          <span className="relative grid size-24 place-items-center rounded-full bg-primary/10 ring-8 ring-primary/5">
            <CartGlyph size={40} className="text-primary" />
          </span>
          <div className="grid max-w-sm gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Your cart is empty
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Looks like you have not added anything yet. Explore the store and the products you add
              will appear here.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/products" className={buttonClasses({ size: 'lg' })}>
              Continue shopping
            </Link>
            <Link href="/categories" className={buttonClasses({ variant: 'outline', size: 'lg' })}>
              Browse categories
            </Link>
          </div>
        </div>
      </Card>
    </PageFrame>
  );
}

export default async function CartPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  // The cookie holds product ids and quantities only; every price below is the API's.
  const items = parseCart(await session.cartCookie.get());
  if (items.length === 0) return <EmptyCart />;

  const quote = await priceCart(items);
  if (!quote) {
    return (
      <PageFrame width="lg">
        <PageHeader title="Your cart" />
        <Card>
          <EmptyState
            icon={CloudOff}
            title="We could not load your cart"
            description="Your items are still saved. Nilzora could not be reached; please try again in a moment."
            className="py-14"
            action={
              <Link href="/cart" className={buttonClasses({ variant: 'outline' })}>
                <RotateCw aria-hidden="true" />
                Try again
              </Link>
            }
          />
        </Card>
      </PageFrame>
    );
  }

  // Once the cart can be checked out again, the reason it was sent back no longer applies.
  const notice = quote.purchasable ? undefined : issueNoticeFrom(params);
  return (
    <PageFrame width="lg">
      <PageHeader
        title="Your cart"
        description={`${itemCountLabel(cartUnitCount(items))} in your cart. Prices are checked again when you place your order.`}
      />
      {notice ? <Alert tone="warning">{notice}</Alert> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="cart-items-heading" className="grid gap-4">
          <h2 id="cart-items-heading" className="sr-only">
            Items in your cart
          </h2>
          <Card>
            <CardContent className="py-0 sm:py-0">
              <CartFormsProvider
                updateAction={updateCartLineAction}
                removeAction={removeCartLineAction}
              >
                <ul className="divide-y divide-border">
                  {quote.lines.map((line) => (
                    <CartLineItem key={`${line.productId}:${line.variantId ?? ''}`} line={line} />
                  ))}
                </ul>
              </CartFormsProvider>
            </CardContent>
          </Card>
          <Link
            href="/products"
            className={`inline-flex min-h-11 items-center justify-self-start text-sm sm:min-h-0 pointer-coarse:min-h-11 ${textLinkClasses}`}
          >
            Continue shopping
          </Link>
        </section>

        <aside aria-labelledby="cart-summary-heading" className="lg:sticky lg:top-28">
          <CartSummary quote={quote} />
        </aside>
      </div>
    </PageFrame>
  );
}
