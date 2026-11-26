import { MAX_LINE_QUANTITY, type ProductDetail } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCart } from '@/cart/cart-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { Price } from '@/components/price';
import { QuantityStepper } from '@/components/quantity-stepper';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { formatMoney, itemCountLabel } from '@/lib/money';
import { theme } from '@/theme';
import { announce, describeAddOutcome, type AddFeedback } from './add-to-cart';
import { productHref } from './catalog-query';
import { VariantPicker } from './variant-picker';
import {
  chosenValues,
  initialSelection,
  isSelectionComplete,
  optionGroups,
  variantFor,
  withChoice,
} from './variant-selection';

/** What the sheet shows: the options still loading, not readable, or ready to choose from. */
export type QuickAddContent =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; product: ProductDetail };

export interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  content: QuickAddContent;
  /** Shown while the options are not known yet. */
  productName: string;
  productSlug: string;
  /** Reads the options again after a failure. */
  onRetry: () => void;
}

/**
 * The choice a product with variants needs before it can go in the cart, opened from a product
 * card or a wishlist row. Nothing is ever added without an exact variant: pressing "Add to cart"
 * with something missing outlines what is missing and says "Select a size", and a product whose
 * options cannot be read offers to try again or to open the product instead.
 */
export function QuickAddSheet({
  visible,
  onClose,
  content,
  productName,
  productSlug,
  onRetry,
}: QuickAddSheetProps) {
  const router = useRouter();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Select options">
      {content.status === 'loading' ? (
        <SkeletonGroup label="Loading options" style={styles.loading}>
          <Skeleton width={140} height={18} />
          <View style={styles.loadingRow}>
            <Skeleton width={64} height={48} radius={theme.radii.full} />
            <Skeleton width={64} height={48} radius={theme.radii.full} />
            <Skeleton width={64} height={48} radius={theme.radii.full} />
          </View>
          <Skeleton height={48} radius={theme.radii.full} />
        </SkeletonGroup>
      ) : content.status === 'error' ? (
        <View style={styles.errorBody}>
          <Notice tone="danger" title="Options could not be loaded">
            {`We could not load the options for ${productName}, so it was not added to your cart.`}
          </Notice>
          <Button label="Try again" onPress={onRetry} />
          <Button
            label="View product"
            variant="secondary"
            accessibilityHint="Opens the product to choose its options"
            onPress={() => {
              onClose();
              router.push(productHref(productSlug));
            }}
          />
        </View>
      ) : (
        <QuickAddOptions product={content.product} onClose={onClose} />
      )}
    </BottomSheet>
  );
}

function QuickAddOptions({ product, onClose }: { product: ProductDetail; onClose: () => void }) {
  const cart = useCart();
  // A product with a single variant has it chosen already; any other starts with nothing.
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    initialSelection(product.variants),
  );
  const [attempted, setAttempted] = useState(false);
  const [requested, setRequested] = useState(1);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);

  const groups = useMemo(() => optionGroups(product.variants), [product.variants]);
  const chosen = variantFor(product.variants, groups, selection);
  const complete = isSelectionComplete(groups, selection);
  const soldOut =
    chosen !== undefined && (chosen.availability === 'out_of_stock' || chosen.maxOrderQuantity < 1);
  const limit = chosen ? Math.min(chosen.maxOrderQuantity, MAX_LINE_QUANTITY) : MAX_LINE_QUANTITY;
  const quantity = Math.min(Math.max(requested, 1), Math.max(limit, 1));
  const inCart = cart.quantityOf(product.id, chosen?.id);
  const unitPriceMinor = chosen?.priceMinor ?? product.priceMinor;

  const choose = (attributeSlug: string, valueSlug: string) => {
    setFeedback(null);
    setRequested(1);
    setSelection((current) => withChoice(product.variants, current, attributeSlug, valueSlug));
  };

  const add = () => {
    if (chosen === undefined || soldOut) {
      setAttempted(true);
      announce(
        complete
          ? 'This combination is not sold. Choose another option.'
          : 'Choose your options before adding this to your cart.',
      );
      return;
    }
    const outcome = cart.add(product.id, quantity, limit, chosen.id);
    const result = describeAddOutcome({ outcome, requested: quantity, before: inCart, limit });
    if (outcome === 'added') {
      const label = chosenValues(groups, selection).join(', ');
      announce(
        `${product.name}, ${label}, added to cart. ${inCart + quantity} of this option in your cart.`,
      );
      onClose();
      return;
    }
    setFeedback(result);
    announce(result.message);
  };

  return (
    <View style={styles.body}>
      <View style={styles.summary}>
        <Text numberOfLines={2} style={styles.name}>
          {product.name}
        </Text>
        <Price
          priceMinor={unitPriceMinor}
          compareAtPriceMinor={chosen ? chosen.compareAtPriceMinor : product.compareAtPriceMinor}
          size="md"
        />
      </View>
      {groups.length === 0 ? (
        <Notice tone="warning">
          This product’s options cannot be chosen here. Open the product.
        </Notice>
      ) : (
        <VariantPicker
          variants={product.variants}
          groups={groups}
          selected={selection}
          onSelect={choose}
          showRequired={attempted}
        />
      )}
      {attempted && complete && chosen === undefined ? (
        <Notice tone="danger">This combination is not sold. Choose another option.</Notice>
      ) : null}
      {soldOut ? <Notice tone="warning">This option is sold out right now.</Notice> : null}
      <View style={styles.quantityRow}>
        <Text style={styles.quantityLabel}>Quantity</Text>
        <QuantityStepper
          value={quantity}
          onChange={setRequested}
          max={Math.max(limit, 1)}
          productName={product.name}
          disabled={chosen === undefined || soldOut}
        />
      </View>
      {feedback ? (
        <Notice tone={feedback.tone === 'danger' ? 'danger' : 'warning'}>{feedback.message}</Notice>
      ) : null}
      <Button
        label={
          chosen === undefined || soldOut
            ? 'Add to cart'
            : `Add to cart · ${formatMoney(unitPriceMinor * quantity)}`
        }
        accessibilityHint={
          chosen === undefined
            ? 'Choose an option for every attribute first'
            : `Adds ${itemCountLabel(quantity)} to your cart`
        }
        onPress={add}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: theme.spacing[4] },
  loadingRow: { flexDirection: 'row', gap: theme.spacing[2] },
  errorBody: { gap: theme.spacing[3] },
  body: { gap: theme.spacing[4] },
  summary: { gap: theme.spacing[1] },
  name: {
    color: theme.colors.foreground,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: theme.fontWeights.semibold,
  },
  quantityRow: { gap: theme.spacing[2] },
  quantityLabel: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
});
