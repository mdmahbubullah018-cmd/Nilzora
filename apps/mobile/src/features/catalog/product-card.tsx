import type { ProductSummary } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { Check, Plus } from 'lucide-react-native';
import { memo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AvailabilityBadge } from '@/components/availability-badge';
import { Price } from '@/components/price';
import { CampaignLabel } from '@/features/campaigns/campaign-label';
import { useCart } from '@/cart/cart-context';
import { savingPercent } from '@/lib/money';
import { theme } from '@/theme';
import { announce, describeAddOutcome } from './add-to-cart';
import { orderableLimit, productHref, productSpokenSummary, soldCountLabel } from './catalog-query';
import { useQuickAdd } from './quick-add';
import { ProductVisual } from './product-visual';
import { ProductColors } from './product-colors';

/**
 * Padding around the media tile inside the card. The card is a white surface with a hairline
 * edge, and the picture tile sits inset in it, so a product without a photo still reads as a
 * finished card against the grey page instead of a disc floating on the background.
 */
const PAD = 6;
const ADD_SIZE = 40;
const ADD_INSET = 6;
const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;
const RIPPLE_ON_FILL = { color: 'rgba(255, 255, 255, 0.3)' } as const;

/**
 * A small round "+" over the corner of the media tile. It is a sibling of the card's own
 * press target, never inside it. Once the product is in the cart it becomes a check with the
 * quantity, which is also the feedback for the tap; at the most one order may hold it is
 * disabled and says so. Renders nothing for a product that cannot be ordered.
 */
function QuickAddButton({ product, top }: { product: ProductSummary; top: number }) {
  const cart = useCart();
  const limit = orderableLimit(product);
  const inCart = cart.quantityOf(product.id);
  const atLimit = inCart >= limit;

  // The plain add: only for a product the catalog confirms has no variants (see useQuickAdd).
  const addDirect = () => {
    const outcome = cart.add(product.id, 1, limit);
    const feedback = describeAddOutcome({ outcome, requested: 1, before: inCart, limit });
    if (outcome === 'added') {
      announce(`${product.name} added to cart. ${inCart + 1} in your cart.`);
    } else {
      // Nothing visible changed, so say why: a dialog is read aloud and needs no new UI.
      Alert.alert(product.name, feedback.message);
    }
  };
  const quickAdd = useQuickAdd(product, addDirect);
  if (limit < 1) return null;

  const label = atLimit
    ? `${product.name}: ${inCart} in cart, the most you can order`
    : inCart > 0
      ? `Add one more ${product.name} to cart, ${inCart} in cart`
      : `Add ${product.name} to cart`;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: atLimit, busy: quickAdd.checking }}
        disabled={atLimit || quickAdd.checking}
        hitSlop={4}
        onPress={quickAdd.press}
        android_ripple={inCart > 0 ? RIPPLE_ON_FILL : RIPPLE}
        style={[
          styles.add,
          { top, right: PAD + ADD_INSET },
          inCart > 0 ? styles.addFilled : null,
          atLimit || quickAdd.checking ? styles.addAtLimit : null,
        ]}
      >
        {inCart > 0 ? (
          <>
            <Check size={16} color={theme.colors.primaryActionForeground} accessible={false} />
            <Text style={styles.addCount}>{inCart}</Text>
          </>
        ) : (
          <Plus size={20} color={theme.colors.link} accessible={false} />
        )}
      </Pressable>
      {quickAdd.sheet}
    </>
  );
}

export interface ProductCardProps {
  product: ProductSummary;
  /** Width in dp; the grid and the rows decide it. */
  width: number;
}

/**
 * A product in a grid or a row. The card is ONE accessible element read as "Name, Price …,
 * In stock"; everything visible inside it is hidden from screen readers so it is not read
 * twice. The press target lies over the whole card (like the web card's stretched link) and
 * the quick-add button sits above it.
 */
export const ProductCard = memo(function ProductCard({ product, width }: ProductCardProps) {
  const router = useRouter();
  const saving = savingPercent(product.priceMinor, product.compareAtPriceMinor);
  const soldOut = product.availability === 'out_of_stock';
  const tile = width - PAD * 2;

  return (
    <View style={[styles.card, { width }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.content}
      >
        <ProductVisual
          categorySlug={product.category.slug}
          imageUri={product.image?.thumbUrl ?? null}
          dimmed={soldOut}
          style={[styles.tile, { width: tile }]}
        >
          {saving !== null ? (
            <View style={styles.offer}>
              <Text style={styles.offerText}>Save {saving}%</Text>
            </View>
          ) : null}
        </ProductVisual>
        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.category}>
            {product.brand ? <Text style={styles.brand}>{product.brand.name} · </Text> : null}
            {product.category.name}
          </Text>
          <Text numberOfLines={2} style={styles.name}>
            {product.name}
          </Text>
          <Price
            priceMinor={product.priceMinor}
            compareAtPriceMinor={product.compareAtPriceMinor}
            size="sm"
          />
          <ProductColors colors={product.colors} />
          {soldCountLabel(product.soldCount) !== null ? (
            <Text style={styles.sold}>{soldCountLabel(product.soldCount)}</Text>
          ) : null}
          {product.campaign ? <CampaignLabel campaign={product.campaign} compact /> : null}
          {/* "In stock" is the norm; only states worth attention are shown. */}
          {product.availability !== 'in_stock' ? (
            <AvailabilityBadge availability={product.availability} />
          ) : null}
        </View>
      </View>

      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={productSpokenSummary(product)}
        accessibilityHint="Opens the product"
        android_ripple={RIPPLE}
        onPress={() => {
          router.push(productHref(product.slug));
        }}
        style={({ pressed }) => [StyleSheet.absoluteFill, pressed ? styles.pressed : null]}
      />

      <QuickAddButton product={product} top={PAD + tile - ADD_SIZE - ADD_INSET} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  content: { padding: PAD },
  tile: { borderRadius: theme.radii.lg },
  info: {
    gap: 5,
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  brand: { color: theme.colors.link },
  // One quiet line under the price: small, muted, never competing with the picture or the price.
  sold: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: theme.fontWeights.medium,
  },
  category: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  name: {
    // Two lines are reserved, so cards in a row stay the same height; the text sits in the
    // middle of that box so a one-line name does not leave a gap above the price.
    minHeight: 38,
    textAlignVertical: 'center',
    color: theme.colors.foreground,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: theme.fontWeights.medium,
  },
  pressed: { backgroundColor: 'rgba(15, 23, 42, 0.05)' },
  offer: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.offerBadge,
  },
  offerText: {
    color: theme.colors.offerBadgeForeground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
  },
  add: {
    position: 'absolute',
    minWidth: ADD_SIZE,
    height: ADD_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: ADD_SIZE / 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  addFilled: {
    borderColor: theme.colors.primaryAction,
    backgroundColor: theme.colors.primaryAction,
  },
  addAtLimit: { opacity: 0.7 },
  addCount: {
    color: theme.colors.primaryActionForeground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
});
