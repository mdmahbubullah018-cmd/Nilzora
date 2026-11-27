import type { CartLine, CartQuote } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApi } from '@/api/api-context';
import { cartLineName, describeCartFixes, planCartFixes, useCart, useCartQuote } from '@/cart';
import { Button } from '@/components/button';
import { CartGlyph } from '@/components/cart-glyph';
import { Notice } from '@/components/notice';
import { QueryState, QueryStateView } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { ListSkeleton } from '@/components/skeleton';
import { ApiNotConfiguredError } from '@/lib/errors';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { CartLineRow } from './cart-line-row';
import { CartSummary } from './cart-summary';

const PRICES_UPDATING = 'Updating prices…';
const NEEDS_ATTENTION = 'Some items need attention. Fix your cart to continue.';
const NOTHING_SELECTED = 'Select at least one item to check out.';

/** Why checkout is closed for the selected lines, in words; null when it is open. */
function checkoutBlock(
  lines: readonly CartLine[],
  settled: boolean,
  selectedUnits: number,
): string | null {
  if (!settled) return PRICES_UPDATING;
  if (selectedUnits === 0) return NOTHING_SELECTED;
  return lines.some((line) => line.problem !== null) ? NEEDS_ATTENTION : null;
}

/**
 * The Cart tab. The cart itself (product ids and quantities) is local and shown at once;
 * everything with a price on it is the API's quote. Quantity edits change the cart
 * immediately and the quote follows, so until it does the prices are marked as updating and
 * checkout waits. Problem lines are explained and can be fixed in one tap; checkout opens
 * only when the server says the cart is purchasable.
 */
export function CartScreen() {
  const router = useRouter();
  const api = useApi();
  const cart = useCart();
  const quote = useCartQuote();
  const { onRefresh } = useManualRefresh(quote.refetch);
  const [fixNote, setFixNote] = useState<string | null>(null);

  function announce(message: string) {
    void AccessibilityInfo.announceForAccessibility(message);
  }

  function changeQuantity(productId: string, variantId: string | null, next: number) {
    setFixNote(null);
    cart.setQuantity(productId, next, variantId);
  }

  function removeLine(productId: string, variantId: string | null, name: string) {
    setFixNote(null);
    cart.remove(productId, variantId);
    announce(`${name} removed from your cart`);
  }

  function fixCart(lines: CartQuote['lines']) {
    const text = describeCartFixes(cart.fixProblems(lines));
    const message = text === null ? 'Your cart is up to date.' : `Cart updated: ${text}.`;
    setFixNote(message);
    announce(message);
  }

  if (!cart.hydrated) {
    return (
      <Screen edges={STACK_EDGES}>
        <ListSkeleton rows={2} label="Loading your cart" />
      </Screen>
    );
  }

  if (cart.items.length === 0) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="empty"
          empty={{
            icon: CartGlyph,
            title: 'Your cart is empty',
            description: 'Products you add will wait here until you are ready to check out.',
            action: (
              <Button
                label="Browse the shop"
                onPress={() => {
                  router.navigate('/shop');
                }}
              />
            ),
          }}
        />
      </Screen>
    );
  }

  if (api === null) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView state="error" error={new ApiNotConfiguredError()} />
      </Screen>
    );
  }

  return (
    <Screen edges={STACK_EDGES} onRefresh={onRefresh}>
      {fixNote ? <Notice tone="success">{fixNote}</Notice> : null}
      <QueryState
        query={quote}
        loadingLabel="Pricing your cart"
        skeleton={<ListSkeleton rows={Math.min(cart.items.length, 3)} label="Pricing your cart" />}
      >
        {(data) => {
          // The quote is for the cart as it was a moment ago while a change is being priced.
          const settled = !quote.isPlaceholderData;
          // Two lines of one product (different variants) are priced separately, so the
          // quote is keyed by the same identity the cart uses.
          const lineByItem = new Map(
            data.lines.map((line) => [
              `${line.productId.toLowerCase()}:${(line.variantId ?? '').toLowerCase()}`,
              line,
            ]),
          );
          const rows = cart.items.flatMap((item) => {
            const line = lineByItem.get(
              `${item.productId.toLowerCase()}:${(item.variantId ?? '').toLowerCase()}`,
            );
            return line ? [{ line, quantity: item.quantity }] : [];
          });
          const unpriced = cart.items.length - rows.length;
          const canFix = settled && planCartFixes(data.lines).length > 0;
          // The selection is the customer's, so the totals and the "needs attention" gate are
          // worked out over the lines they mean to order. The checkout itself re-prices and
          // re-validates exactly these items on the server.
          const isLineSelected = (line: CartLine) =>
            cart.isSelected(line.productId, line.variantId);
          const selectedRows = rows.filter(({ line }) => isLineSelected(line));
          // Every selected line, problems included: this is what decides whether checkout opens.
          const selectedAllLines = data.lines.filter((line) => isLineSelected(line));
          // What the subtotal below actually covers: the selected lines the server can price.
          // A selected line with a problem is announced separately and is not in this money.
          const selectedLines = selectedAllLines.filter(
            (line) => line.problem === null && line.lineTotalMinor !== null,
          );
          const selectedUnits = selectedRows.reduce((total, row) => total + row.quantity, 0);
          // What the subtotal below actually covers: the selected lines the server can price.
          // A selected line with a problem is announced separately and is not in this money.
          const billableUnits = selectedLines.reduce((total, line) => total + line.quantity, 0);
          const selectedSubtotalMinor = selectedLines.reduce(
            (total, line) => total + (line.lineTotalMinor ?? 0),
            0,
          );
          const needsAttention = settled && data.lines.some((line) => line.problem !== null);
          const allSelected = rows.length > 0 && selectedRows.length === rows.length;

          return (
            <>
              {needsAttention ? (
                <View style={styles.attention}>
                  <Notice tone="warning" title="Some items need attention">
                    Some items are unavailable or have fewer units left than you chose. They are not
                    included in your total.
                  </Notice>
                  {canFix ? (
                    <Button
                      label="Fix cart"
                      onPress={() => {
                        fixCart(data.lines);
                      }}
                    />
                  ) : null}
                </View>
              ) : null}

              <View style={styles.selectAllRow}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={allSelected ? 'Deselect all items' : 'Select all items'}
                  accessibilityState={{ checked: allSelected }}
                  hitSlop={8}
                  onPress={() => {
                    cart.setAllSelected(!allSelected);
                  }}
                  style={styles.selectAllTarget}
                >
                  <View style={[styles.selectAllBox, allSelected ? styles.selectAllBoxOn : null]}>
                    {allSelected ? (
                      <Check
                        size={14}
                        color={theme.brand.onSolid}
                        strokeWidth={3}
                        accessible={false}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.selectAllLabel}>
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </Text>
                </Pressable>
                <Text style={styles.selectedSummary}>
                  {selectedRows.length} of {rows.length} selected
                </Text>
              </View>

              <View style={styles.lines}>
                {rows.map(({ line, quantity }) => (
                  <CartLineRow
                    key={`${line.productId}:${line.variantId ?? ''}`}
                    line={line}
                    quantity={quantity}
                    selected={isLineSelected(line)}
                    onSelectedChange={(selected) => {
                      cart.setSelected(line.productId, line.variantId, selected);
                    }}
                    onQuantityChange={(next) => {
                      changeQuantity(line.productId, line.variantId ?? null, next);
                    }}
                    onRemove={() => {
                      removeLine(line.productId, line.variantId ?? null, cartLineName(line));
                    }}
                    onOpenProduct={(slug) => {
                      router.push({ pathname: '/product/[slug]', params: { slug } });
                    }}
                  />
                ))}
                {unpriced > 0 ? <ListSkeleton rows={unpriced} label="Pricing new items" /> : null}
              </View>

              <CartSummary
                quote={data}
                updating={!settled}
                selectedUnits={billableUnits}
                selectedSubtotalMinor={selectedSubtotalMinor}
                blockedReason={checkoutBlock(selectedAllLines, settled, selectedUnits)}
                onCheckout={() => {
                  router.push('/checkout');
                }}
              />

              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  router.navigate('/shop');
                }}
                style={styles.continue}
              >
                <Text style={styles.continueText}>Continue shopping</Text>
              </Pressable>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  attention: { gap: theme.spacing[3] },
  lines: { gap: theme.spacing[2] },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  selectAllTarget: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  selectAllBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  selectAllBoxOn: {
    borderColor: theme.brand.primary,
    backgroundColor: theme.brand.primary,
  },
  selectAllLabel: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  selectedSummary: { color: theme.colors.mutedForeground, fontSize: 13 },
  continue: {
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    color: theme.colors.link,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
});
