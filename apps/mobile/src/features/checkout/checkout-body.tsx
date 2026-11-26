import type { Address, CartQuote, CheckoutQuote } from '@nilzora/contracts';
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, View } from 'react-native';
import { describeCartFixes, useCart } from '@/cart';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { ListSkeleton } from '@/components/skeleton';
import { theme } from '@/theme';
import { DeliverySection } from './delivery-section';
import { ItemsSection } from './items-section';
import type { OrderFailure } from './order-failure';
import { OrderNoteField } from './order-note-field';
import { OrderSummary } from './order-summary';
import { CouponField } from './coupon-field';
import { useMyVouchers } from '@/features/vouchers/voucher-hooks';
import { voucherConditions, voucherDiscount } from '@/features/vouchers/voucher-card';
import { formatMoney } from '@/lib/money';
import { PaymentMethods } from './payment-methods';
import { useCheckoutQuote } from './use-checkout-quote';
import { usePlaceOrder, type SavedKind } from './use-place-order';

export interface CheckoutBodyProps {
  /**
   * Whether the store currently accepts cash on delivery. Read from the public store profile;
   * the order function enforces the same flag in the database.
   */
  codAvailable: boolean;
  /** The customer's saved addresses; at least one. */
  addresses: readonly Address[];
  /**
   * Set once the order is saved: checkout then shows that the order was placed, until the
   * order page replaces it. Owned by the parent so that the emptied cart is never mistaken
   * for an empty checkout.
   */
  saved: SavedKind | null;
  onSaved: (kind: SavedKind) => void;
}

const PRICES_UPDATING = 'Updating prices…';
const PRICES_FAILED = 'Could not update prices. Try again to continue.';
const NEEDS_ATTENTION = 'Some items need attention. Fix your cart to continue.';
const NO_DELIVERY = 'Delivery is not available for this address yet. Choose another address.';
const LEAVING_BLOCKED = 'Your order is being placed. Please wait a moment.';
/** No payment method can be used, so there is nothing to confirm a total against. */
const PAYMENTS_UNAVAILABLE = 'Checkout is closed: cash on delivery is switched off right now.';

/** Why the order cannot be placed from this quote, in words; null when it can. */
function blockReason(
  quote: CartQuote,
  confirmable: boolean,
  priceError: boolean,
  codAvailable: boolean,
): string | null {
  if (!codAvailable) return PAYMENTS_UNAVAILABLE;
  if (priceError) return PRICES_FAILED;
  if (!confirmable) return PRICES_UPDATING;
  if (quote.lines.some((line) => line.problem !== null)) return NEEDS_ATTENTION;
  if (!quote.purchasable || quote.totalMinor === null) return NO_DELIVERY;
  return null;
}

/**
 * Checkout once the customer has at least one address: the address, what is being ordered,
 * the note, the payment method and the order summary, all priced by the API for the chosen
 * address. "Place order" confirms exactly the total of the latest settled quote.
 */
export function CheckoutBody({ addresses, saved, onSaved, codAvailable }: CheckoutBodyProps) {
  const router = useRouter();
  const { address: addressParam } = useLocalSearchParams<{ address?: string }>();
  const cart = useCart();

  // The customer's own pick applies only to the route parameter it was made under, so an
  // address just saved from checkout (the `address` parameter) wins over an older pick.
  const paramId = typeof addressParam === 'string' ? addressParam : undefined;
  const [pick, setPick] = useState<{ forParam: string | undefined; id: string } | null>(null);
  const pickedId = pick !== null && pick.forParam === paramId ? pick.id : undefined;
  const selected =
    addresses.find((address) => address.id === pickedId) ??
    addresses.find((address) => address.id === paramId) ??
    addresses.find((address) => address.isDefault) ??
    addresses[0];

  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const [fixNote, setFixNote] = useState<string | null>(null);
  // The code the customer asked for, and what is typed in the field. Only the server
  // decides whether a code applies and how much it takes off.
  const [couponCode, setCouponCode] = useState<string | undefined>(undefined);
  const [couponDraft, setCouponDraft] = useState('');
  // Collected vouchers ready to use; the quote still validates whichever one is chosen.
  const myVouchers = useMyVouchers();
  const voucherOptions = (myVouchers.data ?? [])
    .filter((voucher) => voucher.state === 'collected' && voucher.code !== null)
    .map((voucher) => ({
      code: voucher.code ?? '',
      title: voucher.title,
      summary: `${voucherDiscount(voucher)} off · ${voucherConditions(voucher)}`,
    }));

  const quote = useCheckoutQuote(selected?.id ?? null, couponCode);
  const { place, placing } = usePlaceOrder();

  // Whether this screen is still on screen when an answer arrives. The order itself is
  // finished by usePlaceOrder either way; only showing and opening it needs the screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // While the order is on its way the screen cannot be left (hardware back, header back or
  // swipe): leaving would hide the answer of an order that may be saved.
  const disablePrevention = usePreventRemove(placing, () => {
    void AccessibilityInfo.announceForAccessibility(LEAVING_BLOCKED);
  });
  // The Android back button too, directly: it is swallowed while the order is on its way.
  useEffect(() => {
    if (!placing) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void AccessibilityInfo.announceForAccessibility(LEAVING_BLOCKED);
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [placing]);

  // Only a settled quote for this very cart and address can be confirmed.
  const confirmable = quote.isSuccess && !quote.isPlaceholderData && !quote.isFetching;
  // A refresh that failed while the earlier prices are kept: they may be out of date.
  const priceError = quote.status === 'error' && quote.data !== undefined;
  const updating = quote.data !== undefined && !confirmable && !priceError;

  async function placeOrder(data: CheckoutQuote) {
    if (selected === undefined || !confirmable || data.totalMinor === null) return;
    if (blockReason(data, confirmable, priceError, codAvailable) !== null) return;
    setFailure(null);
    setNoteError(undefined);
    setFixNote(null);

    const result = await place(
      {
        addressId: selected.id,
        items: cart.selectedItems,
        note,
        expectedTotalMinor: data.totalMinor,
        ...(data.coupon === null ? {} : { couponCode: data.coupon.code }),
      },
      {
        onSaved: (kind) => {
          if (mounted.current) onSaved(kind);
        },
      },
    );
    if (result === null) return;
    // The order is saved (and the cart emptied) whether or not this screen is still here;
    // showing and opening it only makes sense from the screen that asked for it.
    if (!mounted.current) return;

    if (result.ok) {
      void AccessibilityInfo.announceForAccessibility(
        result.kind === 'placed'
          ? 'Order placed. Opening your order confirmation.'
          : 'This order was already placed. Opening its confirmation.',
      );
      // Leaving is allowed now; the prevention flag itself only clears on the next render.
      disablePrevention();
      router.replace({
        pathname: '/order-success/[orderNumber]',
        params: { orderNumber: result.order.orderNumber },
      });
      return;
    }
    const { failure: refused } = result;
    setFailure(refused);
    if (refused.kind === 'note_invalid') setNoteError(refused.message);
    void AccessibilityInfo.announceForAccessibility(`${refused.title}. ${refused.message}`);
  }

  function fixCart(data: CartQuote) {
    const text = describeCartFixes(cart.fixProblems(data.lines));
    const message = text === null ? 'Your cart is up to date.' : `Cart updated: ${text}.`;
    setFixNote(message);
    setFailure(null);
    void AccessibilityInfo.announceForAccessibility(message);
  }

  if (saved !== null) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="success" title={saved === 'placed' ? 'Order placed' : 'Already placed'}>
          {saved === 'placed'
            ? 'Opening your order confirmation…'
            : 'This order was already placed. Opening its confirmation…'}
        </Notice>
      </Screen>
    );
  }

  if (selected === undefined) return null;

  function renderPrices(data: CheckoutQuote) {
    const needsAttention = data.lines.some((line) => line.problem !== null);
    const reason = blockReason(data, confirmable, priceError, codAvailable);
    return (
      <>
        {fixNote ? <Notice tone="success">{fixNote}</Notice> : null}
        {needsAttention && confirmable ? (
          <View style={styles.attention}>
            <Notice tone="warning" title="Some items need attention">
              Some items are no longer available in the quantity you chose. Fix your cart to
              continue.
            </Notice>
            <Button
              label="Fix cart"
              onPress={() => {
                fixCart(data);
              }}
            />
            <Button
              label="Review your cart"
              variant="secondary"
              onPress={() => {
                router.navigate('/cart');
              }}
            />
          </View>
        ) : null}

        <ItemsSection quote={data} />
        <CouponField
          value={couponDraft}
          onChangeText={setCouponDraft}
          onApply={() => {
            const code = couponDraft.trim().toUpperCase();
            setCouponCode(code === '' ? undefined : code);
          }}
          onRemove={() => {
            setCouponCode(undefined);
            setCouponDraft('');
          }}
          appliedCode={data.couponProblem === null ? (data.coupon?.code ?? null) : null}
          problem={data.couponProblem}
          discountLabel={data.discountMinor > 0 ? `−${formatMoney(data.discountMinor)}` : null}
          vouchers={voucherOptions}
          onPickVoucher={(code) => {
            setCouponCode(code);
            setCouponDraft('');
          }}
          appliedIsVoucher={data.coupon?.isVoucher === true}
          appliedTitle={data.coupon?.title ?? null}
          // Applying again while the total is being refreshed would be a guess.
          busy={!confirmable && data !== undefined}
          editable={!placing}
        />
        <OrderNoteField
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setNoteError(undefined);
          }}
          error={noteError}
          editable={!placing}
        />
        <PaymentMethods codAvailable={codAvailable} />

        {failure ? (
          <View style={styles.attention}>
            <Notice
              tone={
                failure.kind === 'outcome_unknown' ||
                failure.kind === 'price_changed' ||
                failure.kind === 'earlier_cancelled'
                  ? 'warning'
                  : 'danger'
              }
              title={failure.title}
            >
              {failure.message}
            </Notice>
            {failure.kind === 'outcome_unknown' || failure.kind === 'key_conflict' ? (
              <Button
                label="View my orders"
                variant="secondary"
                onPress={() => {
                  router.navigate('/orders');
                }}
              />
            ) : null}
          </View>
        ) : null}

        <OrderSummary
          quote={data}
          updating={updating}
          priceError={priceError}
          retryingPrices={quote.isFetching}
          onRetryPrices={() => void quote.refetch()}
          confirmableTotalMinor={reason === null ? data.totalMinor : null}
          placing={placing}
          // While the order is being placed the button shows progress, not a reason.
          blockedReason={placing ? null : reason}
          onPlaceOrder={() => void placeOrder(data)}
        />
      </>
    );
  }

  const view = queryViewState(quote);
  return (
    // No pull-to-refresh here: refetching the quote or the addresses mid-checkout could change
    // the total or the chosen address under the customer. The quote refreshes itself when the
    // cart, the address or the coupon changes, and "Place order" re-checks it on the server.
    <Screen edges={STACK_EDGES}>
      {/* No swipe or header back while the order is on its way. */}
      <Stack.Screen options={{ gestureEnabled: !placing, headerBackVisible: !placing }} />
      <DeliverySection
        addresses={addresses}
        selected={selected}
        locked={placing}
        onSelect={(id) => {
          setPick({ forParam: paramId, id });
          setFailure(null);
        }}
        onAddAddress={() => {
          router.push({ pathname: '/addresses/new', params: { returnTo: '/checkout' } });
        }}
      />

      {view === 'loading' ? (
        <QueryStateView
          state="loading"
          skeleton={<ListSkeleton rows={2} label="Pricing your order" />}
        />
      ) : view === 'error' || quote.data === undefined ? (
        <QueryStateView
          state="error"
          error={quote.error}
          onRetry={() => void quote.refetch()}
          retrying={quote.isRefetching}
        />
      ) : (
        <View style={styles.prices}>{renderPrices(quote.data)}</View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  attention: { gap: theme.spacing[3] },
  prices: { gap: theme.spacing[4] },
});
