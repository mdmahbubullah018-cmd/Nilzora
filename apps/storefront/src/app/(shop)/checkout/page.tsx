import { randomUUID } from 'node:crypto';
import type { Address } from '@nilzora/contracts';
import {
  Alert,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CartGlyph,
  EmptyState,
  PageHeader,
} from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { CheckoutItemsCard, DeliveryAddressCard } from '@/components/checkout/checkout-sections';
import { CouponCard } from '@/components/checkout/coupon-card';
import { voucherConditions, voucherDiscount } from '@/lib/voucher-format';
import {
  BackLink,
  CheckoutProgress,
  itemCountLabel,
  PageFrame,
  SummaryList,
  SummaryRow,
  textLinkClasses,
} from '@/components/checkout/page-parts';
import { PaymentMethods } from '@/components/checkout/payment-methods';
import { PlaceOrderForm } from '@/components/checkout/place-order-form';
import { DELIVERY_ZONE_LABELS } from '@/components/orders/order-status';
import { readAccount } from '@/lib/account-read';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { recordCheckoutStart } from '@/lib/saved-cart';
import { parseCart } from '@/lib/cart';
import { checkoutUnavailable } from '@nilzora/contracts';
import { storeProfile } from '@/lib/seo';
import { placeOrderAction } from '@/lib/checkout-actions';
import { formatMoney } from '@/lib/format';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

const SIGN_IN = '/login?next=/checkout';

function CheckoutFrame({ children, description }: { children: ReactNode; description?: string }) {
  return (
    <PageFrame width="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/cart">Back to your cart</BackLink>
        <CheckoutProgress />
      </div>
      <PageHeader
        title="Checkout"
        description={
          description ??
          'Check where your order goes and what is in it, then place it. You pay in cash when it arrives.'
        }
      />
      {children}
    </PageFrame>
  );
}

/** `?address=` only when it names one of the customer's own addresses; else the default. */
function chooseAddress(
  addresses: readonly Address[],
  requested: string | undefined,
): Address | undefined {
  return (
    addresses.find((address) => address.id === requested) ??
    addresses.find((address) => address.isDefault) ??
    addresses[0]
  );
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Checked here, not in a layout: layouts do not re-run on client navigation.
  const current = await session.getSession();
  if (current.status === 'signed_out') redirect(SIGN_IN);
  if (current.status === 'suspended') {
    return (
      <CheckoutFrame>
        <SuspendedState />
      </CheckoutFrame>
    );
  }
  if (current.status === 'unavailable') {
    return (
      <CheckoutFrame>
        <UnavailableState title="We could not open checkout" retryHref="/checkout" />
      </CheckoutFrame>
    );
  }

  // The cookie holds product ids and quantities only; every amount below is the API's.
  const items = parseCart(await session.cartCookie.get());
  if (items.length === 0) {
    return (
      <CheckoutFrame>
        <Card>
          <EmptyState
            icon={CartGlyph}
            title="Your cart is empty"
            description="Add products to your cart, then come back here to place your order."
            className="py-14"
            action={
              <Link href="/cart" className={buttonClasses()}>
                Go to your cart
              </Link>
            }
          />
        </Card>
      </CheckoutFrame>
    );
  }

  const addressRead = await readAccount((api, accessToken) => api.listAddresses(accessToken));
  if (addressRead.kind === 'signed_out') redirect(SIGN_IN);
  if (addressRead.kind === 'suspended') {
    return (
      <CheckoutFrame>
        <SuspendedState />
      </CheckoutFrame>
    );
  }
  if (addressRead.kind !== 'ok') {
    return (
      <CheckoutFrame>
        <UnavailableState title="We could not load your addresses" retryHref="/checkout" />
      </CheckoutFrame>
    );
  }

  const { addresses } = addressRead.value;
  const selected = chooseAddress(addresses, singleParam(params, 'address'));
  if (!selected) {
    return (
      <CheckoutFrame>
        <Card>
          <EmptyState
            icon={MapPin}
            title="Add a delivery address"
            description="Tell us where to deliver your order. We bring it to your door and you pay in cash."
            className="py-14"
            action={
              <Link href="/account/addresses/new?next=/checkout" className={buttonClasses()}>
                Add a delivery address
              </Link>
            }
          />
        </Card>
      </CheckoutFrame>
    );
  }

  const couponCode = singleParam(params, 'coupon')?.trim().toUpperCase() || undefined;

  const quoteRead = await readAccount((api, accessToken) =>
    api.quoteCheckout(accessToken, {
      items,
      addressId: selected.id,
      ...(couponCode === undefined ? {} : { couponCode }),
    }),
  );
  if (quoteRead.kind === 'signed_out') redirect(SIGN_IN);
  if (quoteRead.kind === 'suspended') {
    return (
      <CheckoutFrame>
        <SuspendedState />
      </CheckoutFrame>
    );
  }
  if (quoteRead.kind !== 'ok') {
    return (
      <CheckoutFrame>
        <UnavailableState title="We could not price your order" retryHref="/checkout" />
      </CheckoutFrame>
    );
  }

  const { quote } = quoteRead.value;
  const linesNeedAttention = quote.lines.some((line) => line.problem !== null);
  const total = quote.purchasable ? quote.totalMinor : null;
  // The customer reached the last step with a priced order: that is a genuine attempt, and
  // it is what puts a cart in the staff queue if it goes quiet. Rendering cannot write
  // cookies, and the mirror ignores that, so this only records the attempt.
  await recordCheckoutStart({
    addressId: selected.id,
    ...(couponCode === undefined ? {} : { couponCode }),
  });
  // The address for a coupon change keeps the chosen delivery address and drops the code.
  const couponRemoveHref = `/checkout?address=${selected.id}`;
  // Collected vouchers ready to use; choosing one sets the same `coupon` parameter, so an
  // order carries one voucher or one code. The quote then validates it on the server.
  const voucherRead = await readAccount((api, accessToken) => api.myVouchers(accessToken));

  // The store's own answer to whether a cash order can be placed right now. The order
  // function reads the same flag inside the database, so a stale page cannot get past it.
  const profile = await storeProfile();
  const codAvailable = profile?.codAvailable ?? true;
  const noPaymentMethod = checkoutUnavailable(codAvailable);
  const voucherOptions =
    voucherRead.kind === 'ok'
      ? voucherRead.value.vouchers
          .filter((voucher) => voucher.state === 'collected' && voucher.code !== null)
          .map((voucher) => ({
            code: voucher.code ?? '',
            title: voucher.title,
            summary: `${voucherDiscount(voucher)} · ${voucherConditions(voucher)}`,
            href: `/checkout?address=${selected.id}&coupon=${encodeURIComponent(voucher.code ?? '')}`,
          }))
      : [];
  return (
    <CheckoutFrame
      description={
        noPaymentMethod
          ? 'Payment is paused right now, so orders cannot be placed. Your cart and delivery details are kept.'
          : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start lg:gap-8">
        <div className="grid gap-6">
          <DeliveryAddressCard selected={selected} addresses={addresses} />
          <CheckoutItemsCard quote={quote} />
          <CouponCard
            applied={couponCode}
            description={quote.coupon?.description ?? null}
            problem={quote.couponProblem}
            actionPath="/checkout"
            hidden={{ address: selected.id }}
            removeHref={couponRemoveHref}
            discountLabel={quote.discountMinor > 0 ? `−${formatMoney(quote.discountMinor)}` : null}
            vouchers={voucherOptions}
            isVoucher={quote.coupon?.isVoucher === true}
          />
        </div>

        <aside aria-labelledby="checkout-summary-heading" className="lg:sticky lg:top-28">
          <Card className="border-primary/15 bg-linear-to-b from-primary/5 to-surface shadow-sm">
            <CardHeader>
              <CardTitle as="h2" id="checkout-summary-heading">
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
                    −{formatMoney(quote.campaignDiscountMinor)}
                  </SummaryRow>
                ) : null}
                <SummaryRow
                  label={
                    quote.deliveryZone
                      ? `Delivery (${DELIVERY_ZONE_LABELS[quote.deliveryZone]})`
                      : 'Delivery'
                  }
                >
                  {quote.shippingFeeMinor !== null
                    ? formatMoney(quote.shippingFeeMinor)
                    : 'Not available'}
                </SummaryRow>
                {quote.discountMinor > 0 ? (
                  <SummaryRow
                    label={
                      quote.coupon?.kind === 'free_delivery'
                        ? `Free delivery (${quote.coupon.code})`
                        : quote.coupon?.isVoucher === true
                          ? `Voucher (${quote.coupon.title ?? quote.coupon.code})`
                          : `Coupon (${quote.coupon?.code ?? couponCode ?? ''})`
                    }
                  >
                    −{formatMoney(quote.discountMinor)}
                  </SummaryRow>
                ) : null}
                {quote.totalMinor !== null ? (
                  <SummaryRow label="Total" total>
                    {formatMoney(quote.totalMinor)}
                  </SummaryRow>
                ) : null}
              </SummaryList>

              <PaymentMethods codAvailable={codAvailable} />

              {noPaymentMethod ? (
                <Alert tone="warning" title="Checkout is temporarily unavailable">
                  No payment method can be used right now. Please try again a little later —
                  nothing has been charged and your cart is still here.
                </Alert>
              ) : total !== null ? (
                <PlaceOrderForm
                  action={placeOrderAction}
                  csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
                  addressId={selected.id}
                  expectedTotalMinor={total}
                  couponCode={quote.coupon?.code}
                  // One key per checkout render: see PlaceOrderForm for how retries keep it.
                  idempotencyKey={randomUUID()}
                />
              ) : linesNeedAttention ? (
                <Alert tone="warning" title="Some items need attention">
                  Some items are no longer available in the quantity you chose.{' '}
                  <Link href="/cart" className={textLinkClasses}>
                    Review your cart
                  </Link>{' '}
                  to continue.
                </Alert>
              ) : (
                <Alert tone="warning" title="Delivery is not available here yet">
                  We cannot deliver to this address yet. Choose another address or add a new one.
                </Alert>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </CheckoutFrame>
  );
}
