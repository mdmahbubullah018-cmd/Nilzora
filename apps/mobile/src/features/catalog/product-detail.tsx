import { MAX_LINE_QUANTITY, type ProductDetail } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import {
  Banknote,
  CircleAlert,
  CircleCheck,
  SearchX,
  ShoppingBag,
  Sparkles,
  TriangleAlert,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AvailabilityBadge } from '@/components/availability-badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { AppIcon, icons } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Price } from '@/components/price';
import { QuantityStepper } from '@/components/quantity-stepper';
import { RefreshableScrollView } from '@/components/pull-to-refresh/pull-to-refresh';
import { useCart } from '@/cart/cart-context';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';
import { useWishlist } from '@/wishlist';
import { useMemo } from 'react';
import { brandHref } from '@/features/brands/brand-components';
import { CampaignLabel } from '@/features/campaigns/campaign-label';
import { ProductReviewsSheet } from '@/features/reviews/product-reviews-sheet';
import { askAboutProduct } from '@/features/support/product-question';
import { SUPPORT_HREF } from '@/features/support/routes';
import { productShareTarget, shareProduct } from '@/features/share/product-share';
import { announce, describeAddOutcome, type AddFeedback } from './add-to-cart';
import { orderableLimit, shopHref, soldCountLabel } from './catalog-query';
import { ProductGallery } from './product-gallery';
import { ProductOffers } from '@/features/vouchers/product-offers';
import { RelatedProducts } from './related-products';
import { shownSizeChart, SizeGuide } from './size-guide';
import { VariantPicker } from './variant-picker';
import {
  chosenValues,
  initialSelection,
  isSelectionComplete,
  optionGroups,
  variantFor,
  withChoice,
  type VariantOptionGroup,
} from './variant-selection';

/*
 * The product screen's content. The stock band, the per-order limit and the price all come
 * from the API; the total on the "Add to cart" bar is only quantity x price for display. The
 * cart holds product ids and quantities, never prices: the server prices the order at checkout.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;

const FEEDBACK_ICONS: Record<AddFeedback['tone'], LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/** What the customer is told after pressing "Add to cart". */
function AddFeedbackRow({
  feedback,
  onViewCart,
}: {
  feedback: AddFeedback;
  onViewCart: () => void;
}) {
  const colors = theme.notice[feedback.tone];
  const Icon = FEEDBACK_ICONS[feedback.tone];
  return (
    <View
      style={[styles.feedback, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Icon size={18} color={colors.icon} accessible={false} />
      <Text style={[styles.feedbackText, { color: colors.foreground }]}>{feedback.message}</Text>
      {feedback.offerCart ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View cart"
          onPress={onViewCart}
          android_ripple={RIPPLE}
          style={styles.feedbackAction}
        >
          <Text style={[styles.feedbackActionText, { color: colors.foreground }]}>View cart</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoRow({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={20} color={theme.colors.link} accessible={false} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoDescription}>{description}</Text>
      </View>
    </View>
  );
}

/** Paragraphs as written; line breaks inside a paragraph are kept. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

export interface ProductDetailViewProps {
  product: ProductDetail;
  /** The branded pull-to-refresh: price, stock and reviews (see the product route). */
  onRefresh: () => unknown;
}

/** The product, its quantity control and the sticky "Add to cart" bar. Fills the screen frame. */
export function ProductDetailView({ product, onRefresh }: ProductDetailViewProps) {
  const router = useRouter();
  const cart = useCart();
  const wishlist = useWishlist();
  const [requested, setRequested] = useState(1);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [sharing, setSharing] = useState(false);
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    initialSelection(product.variants),
  );

  // The API decides which options exist, what they cost and how many are left; the screen
  // only works out which variant a set of choices names.
  const groups: VariantOptionGroup[] = useMemo(
    () => optionGroups(product.variants),
    [product.variants],
  );
  const chosen = variantFor(product.variants, groups, selection);
  const needsChoice = product.variants.length > 0 && chosen === undefined;
  // Every attribute chosen, yet no variant has those values: a combination that is not sold.
  const unsold = needsChoice && isSelectionComplete(groups, selection);
  const sizeChart = shownSizeChart(product.sizeChart);

  const limit = chosen
    ? Math.min(chosen.maxOrderQuantity, MAX_LINE_QUANTITY)
    : orderableLimit(product);
  const soldOut = !needsChoice && limit < 1;
  const blocked = needsChoice || soldOut;
  // Stock can drop while the screen is open: the quantity follows the new limit.
  const quantity = Math.min(Math.max(requested, 1), Math.max(limit, 1));
  const inCart = cart.quantityOf(product.id, chosen?.id);
  const unitPriceMinor = chosen?.priceMinor ?? product.priceMinor;
  const total = formatMoney(unitPriceMinor * quantity);
  const description = product.description === null ? [] : paragraphsOf(product.description);
  const availability = chosen?.availability ?? product.availability;
  const sku = chosen?.sku ?? product.sku;

  const choose = (attributeSlug: string, valueSlug: string) => {
    setFeedback(null);
    setRequested(1);
    setSelection((current) => withChoice(product.variants, current, attributeSlug, valueSlug));
  };

  const addToCart = () => {
    const outcome = cart.add(product.id, quantity, limit, chosen?.id);
    const result = describeAddOutcome({ outcome, requested: quantity, before: inCart, limit });
    setFeedback(result);
    announce(result.message);
    // Next time starts from one again, so a second tap never repeats a large quantity by accident.
    if (outcome === 'added') setRequested(1);
  };

  const viewCart = () => {
    router.navigate('/cart');
  };

  /**
   * "Ask about this product", the same entry point the website's product page offers: the
   * product is recorded, then the existing support inbox opens and asks for the message.
   */
  const askSupport = () => {
    askAboutProduct({ productId: product.id, productName: product.name });
    router.push(SUPPORT_HREF);
  };

  /**
   * The product's public page, when this build knows the storefront's address. Nothing is shared
   * when it does not: a link invented from a guess would send the customer's contact to a page
   * that does not exist.
   */
  const share = useMemo(
    () =>
      productShareTarget({
        slug: product.slug,
        name: product.name,
        summary: product.summary,
        imageUrl: product.images[0]?.url ?? null,
      }),
    [product],
  );

  /** Opens the phone's own share sheet. A dismissal is silent; only a real failure speaks. */
  const shareNow = () => {
    if (sharing) return;
    setSharing(true);
    void shareProduct({
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      imageUrl: product.images[0]?.url ?? null,
    })
      .then((outcome) => {
        if (outcome === 'failed') announce(`${product.name} could not be shared.`);
        if (outcome === 'unavailable') announce('Sharing is unavailable in this build.');
      })
      .finally(() => setSharing(false));
  };

  const saved = wishlist.has(product.slug);
  const toggleSaved = () => {
    // The product id lets a signed-in account save it to the server, shared with the website.
    const nowSaved = wishlist.toggle(product.slug, product.id);
    announce(
      nowSaved
        ? wishlist.synced
          ? `${product.name} saved to your wishlist.`
          : `${product.name} saved to your wishlist on this device.`
        : `${product.name} removed from your wishlist.`,
    );
  };

  /** "Buy now": the same add, then straight on to the existing checkout. */
  const buyNow = () => {
    const outcome = cart.add(product.id, quantity, limit, chosen?.id);
    if (outcome === 'added' || outcome === 'at_limit') {
      setRequested(1);
      router.push('/checkout');
      return;
    }
    const result = describeAddOutcome({ outcome, requested: quantity, before: inCart, limit });
    setFeedback(result);
    announce(result.message);
  };

  const addLabel = unsold
    ? 'Not available'
    : needsChoice
      ? 'Choose your options'
      : soldOut
        ? 'Out of stock'
        : total === ''
          ? 'Add to cart'
          : `Add to cart · ${total}`;
  // What is still unanswered, named: "Choose a size to continue."
  const missingGroups = groups.filter((group) => selection[group.slug] === undefined);
  const requirementName = (group: VariantOptionGroup): string =>
    group.kind === 'size' ? 'size' : group.kind === 'color' ? 'colour' : group.name.toLowerCase();
  const chooseNote =
    missingGroups.length === 0
      ? 'Choose your options to continue.'
      : `Choose ${missingGroups.length === 1 ? 'a' : 'your'} ${missingGroups
          .map(requirementName)
          .join(' and a ')} to continue.`;
  const addSpoken = unsold
    ? 'This combination is not sold. Choose another option'
    : needsChoice
      ? 'Choose your options before adding this to your cart'
      : soldOut
        ? 'Out of stock'
        : `Add to cart, ${itemCountLabel(quantity)}${
            total === '' ? '' : `, total ${spokenMoney(unitPriceMinor * quantity)}`
          }`;

  return (
    <>
      <RefreshableScrollView
        testID="product-scroll"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onRefresh={onRefresh}
      >
        <ProductGallery
          product={product}
          dimmed={soldOut}
          variantImageUrl={chosen?.imageUrl ?? null}
          variantLabel={
            chosen === undefined ? null : chosen.options.map((option) => option.value).join(' · ')
          }
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find similar products"
          accessibilityHint="Searches the catalogue with this product's picture"
          onPress={() =>
            router.push({
              pathname: '/visual-search',
              params: { product: product.id, name: product.name },
            })
          }
          style={styles.findSimilar}
        >
          <Sparkles size={16} color={theme.colors.link} />
          <Text style={styles.findSimilarText}>Find similar products</Text>
        </Pressable>

        <View style={styles.heading}>
          <View style={styles.headingTop}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={product.category.name}
              accessibilityHint="Shows the products in this category"
              onPress={() => {
                router.navigate(shopHref({ category: product.category.slug }));
              }}
              style={styles.category}
            >
              <Text style={styles.categoryText}>{product.category.name}</Text>
            </Pressable>
            <View style={styles.headingActions}>
              {/*
                Passing the product on, beside the heart and the category — never over the
                picture, the price or the "Add to cart" bar. Absent when the build has no
                storefront address to link to.
              */}
              {share ? (
                <IconButton
                  icon={icons.share}
                  label={`Share ${product.name}`}
                  hint="Opens your phone's share sheet with a link to this product"
                  disabled={sharing}
                  onPress={shareNow}
                />
              ) : null}
              <IconButton
                icon={icons.wishlistFilled}
                label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                hint="The wishlist is kept on this device"
                selected={saved}
                filled={saved}
                onPress={toggleSaved}
              />
            </View>
          </View>
          <Text accessibilityRole="header" style={styles.name}>
            {product.name}
          </Text>
          {product.brand ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Brand: ${product.brand.name}`}
              accessibilityHint="Shows this brand's products"
              hitSlop={8}
              onPress={() => {
                if (product.brand) router.push(brandHref(product.brand.slug));
              }}
              style={styles.brand}
            >
              <Text style={styles.brandText}>
                by <Text style={styles.brandName}>{product.brand.name}</Text>
              </Text>
            </Pressable>
          ) : null}
          {soldCountLabel(product.soldCount) !== null ? (
            <View style={styles.soldRow}>
              <ShoppingBag size={14} color={theme.colors.mutedForeground} accessible={false} />
              <Text style={styles.soldText}>{soldCountLabel(product.soldCount)}</Text>
            </View>
          ) : null}
          {product.summary ? <Text style={styles.summary}>{product.summary}</Text> : null}
        </View>

        <View style={styles.priceBlock}>
          <Price
            priceMinor={unitPriceMinor}
            compareAtPriceMinor={chosen ? chosen.compareAtPriceMinor : product.compareAtPriceMinor}
            size="lg"
            showSaving
          />
          {product.campaign === null ? null : <CampaignLabel campaign={product.campaign} />}
          <View style={styles.meta}>
            <AvailabilityBadge availability={availability} />
            <Text accessibilityLabel={`Product code ${sku}`} style={styles.sku}>
              SKU {sku}
            </Text>
          </View>
        </View>

        {/* The options come before the review drawer: a customer chooses the colour and size
            first, then reads what other customers said about it. */}
        {groups.length > 0 ? (
          <VariantPicker
            variants={product.variants}
            groups={groups}
            selected={selection}
            onSelect={choose}
          />
        ) : null}

        <ProductReviewsSheet productId={product.id} slug={product.slug} />

        {unsold ? (
          <Text accessibilityLiveRegion="polite" style={styles.unsold}>
            This combination is not sold. Choose another option.
          </Text>
        ) : null}

        {sizeChart ? (
          <SizeGuide chart={sizeChart} chosenValues={chosenValues(groups, selection)} />
        ) : null}

        {blocked ? null : (
          <View style={styles.quantity}>
            <Text style={styles.quantityLabel}>Quantity</Text>
            <QuantityStepper
              value={quantity}
              max={limit}
              productName={product.name}
              onChange={(next) => {
                setRequested(next);
                setFeedback(null);
              }}
            />
            {inCart > 0 ? (
              <Text accessibilityLiveRegion="polite" style={styles.inCart}>
                {inCart} already in your cart
              </Text>
            ) : null}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ask about ${product.name}`}
          accessibilityHint="Opens support with this product attached to the conversation"
          onPress={askSupport}
          android_ripple={RIPPLE}
          style={({ pressed }) => [styles.ask, pressed ? styles.askPressed : null]}
        >
          <AppIcon name="message" size="sm" color={theme.colors.primaryAction} />
          <Text style={styles.askText}>Ask about this product</Text>
        </Pressable>

        <Card style={styles.info}>
          <InfoRow
            icon={Banknote}
            title="Cash on delivery"
            description="Pay in cash when your parcel arrives. No card or online payment needed."
          />
          <InfoRow
            icon={Truck}
            title="Delivery within Bangladesh"
            description="The delivery charge for your address and the full total are shown at checkout."
          />
          {/* The website's third promise, worded the same: a pending order can still be called off. */}
          <InfoRow
            icon={Undo2}
            title="Changed your mind?"
            description="You can cancel an order from your account while it is still pending."
          />
        </Card>

        <ProductOffers slug={product.slug} />

        {description.length > 0 ? (
          // A hairline and a little air set the long copy apart from the purchase controls, so
          // the screen reads as "how to buy" then "what it is" rather than one long column.
          <View style={[styles.about, styles.details]}>
            <Text accessibilityRole="header" style={styles.aboutTitle}>
              About this product
            </Text>
            {description.map((paragraph, index) => (
              <Text key={index} style={styles.aboutText}>
                {paragraph}
              </Text>
            ))}
          </View>
        ) : null}

        {/* The website's own suggestions, after everything about this product. */}
        <RelatedProducts product={product} />
      </RefreshableScrollView>

      <View style={styles.bar}>
        {feedback ? <AddFeedbackRow feedback={feedback} onViewCart={viewCart} /> : null}
        <View style={styles.actions}>
          {/* Kept on screen and disabled while a choice is missing: the bar never reflows,
              and "Buy now" is visibly waiting on the same selection as "Add to cart". */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Buy now, ${itemCountLabel(quantity)}`}
            accessibilityHint={
              blocked
                ? 'Choose an option for every attribute first'
                : 'Adds the product to your cart and opens checkout'
            }
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={buyNow}
            android_ripple={{ color: 'rgba(15, 23, 42, 0.12)' }}
            style={({ pressed }) => [
              styles.buyButton,
              blocked ? styles.buyButtonDisabled : null,
              pressed ? styles.buyButtonPressed : null,
            ]}
          >
            <Text style={[styles.buyText, blocked ? styles.buyTextDisabled : null]}>Buy now</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addSpoken}
            accessibilityHint={
              needsChoice
                ? 'Choose an option for every attribute first'
                : soldOut
                  ? 'This product cannot be ordered right now'
                  : 'Adds the product to your cart'
            }
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={addToCart}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.3)' }}
            style={({ pressed }) => [
              styles.addButton,
              blocked ? styles.addButtonDisabled : null,
              pressed && !blocked ? styles.addButtonPressed : null,
            ]}
          >
            <Text style={[styles.addText, blocked ? styles.addTextDisabled : null]}>
              {addLabel}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.barNote}>
          {needsChoice
            ? chooseNote
            : soldOut
              ? 'This product cannot be ordered right now.'
              : 'The delivery charge is added and the final total confirmed at checkout.'}
        </Text>
      </View>
    </>
  );
}

/** Padded, scrolling frame for the states that are not the product itself (loading, errors). */
export function ProductStatus({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** The product does not exist (any more), or the link is wrong. */
export function ProductNotFound({ onBrowse }: { onBrowse: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={SearchX}
        title="Product not found"
        description="This product may have been removed, or the link is out of date."
      />
      <View style={styles.notFoundAction}>
        <Button label="Browse the shop" onPress={onBrowse} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[8],
    // Tighter than a browsing page: the product's own blocks follow each other, and each one
    // that needs air sets it apart with a hairline instead of a wide gap.
    gap: theme.spacing[4],
  },
  heading: { gap: theme.spacing[1] },
  findSimilar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.spacing[1],
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
    marginTop: -theme.spacing[2],
  },
  findSimilarText: {
    color: theme.colors.link,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
  headingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  category: { alignSelf: 'flex-start', minHeight: theme.touchTarget, justifyContent: 'center' },
  brand: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  brandText: { color: theme.colors.mutedForeground, ...theme.text.body },
  brandName: { color: theme.colors.link, fontWeight: theme.fontWeights.semibold },
  categoryText: {
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
    color: theme.colors.link,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  name: {
    color: theme.colors.foreground,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.4,
  },
  summary: { color: theme.colors.body, fontSize: 16, lineHeight: 24 },
  soldRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  soldText: { color: theme.colors.mutedForeground, ...theme.text.caption },
  priceBlock: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[3] },
  sku: { color: theme.colors.mutedForeground, fontSize: 13 },
  quantity: { gap: theme.spacing[2] },
  quantityLabel: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
  },
  inCart: { color: theme.colors.mutedForeground, fontSize: 13 },
  unsold: { color: theme.notice.warning.foreground, fontSize: 14, lineHeight: 20 },

  /*
   * The quiet secondary action under the purchase controls: a hairline pill, so it is easy to
   * find without pulling attention away from Buy now and Add to cart in the bar below.
   */
  ask: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.surface,
  },
  askPressed: { backgroundColor: theme.colors.iconSurface },
  askText: { ...theme.text.bodyStrong, color: theme.colors.primaryAction },
  info: { padding: theme.spacing[4], gap: theme.spacing[4], borderRadius: theme.radii.xl },
  infoRow: { flexDirection: 'row', gap: theme.spacing[3], alignItems: 'flex-start' },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.iconSurface,
  },
  infoText: { flex: 1, gap: 2 },
  infoTitle: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  infoDescription: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },

  about: { gap: theme.spacing[3] },
  /** A section below the purchase controls, set apart by a hairline instead of nothing. */
  details: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  aboutTitle: {
    color: theme.colors.foreground,
    fontSize: 18,
    fontWeight: theme.fontWeights.semibold,
  },
  aboutText: { color: theme.colors.body, fontSize: 15, lineHeight: 23 },

  bar: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.surface,
    shadowColor: theme.colors.navy,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
  actions: { flexDirection: 'row', gap: theme.spacing[3] },
  buyButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    borderWidth: 1.5,
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  buyButtonPressed: { backgroundColor: theme.colors.softBackground },
  buyButtonDisabled: { borderColor: theme.colors.borderStrong, opacity: 0.6 },
  buyText: { color: theme.colors.navy, fontSize: 16, fontWeight: theme.fontWeights.semibold },
  buyTextDisabled: { color: theme.colors.mutedForeground },
  addButton: {
    flex: 1.6,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.primaryAction,
    overflow: 'hidden',
  },
  addButtonPressed: { backgroundColor: theme.colors.primaryActionHover },
  addButtonDisabled: { backgroundColor: theme.colors.borderStrong },
  addText: {
    color: theme.colors.primaryActionForeground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  addTextDisabled: { color: theme.colors.slate },
  barNote: {
    color: theme.colors.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },

  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    borderRadius: theme.radii.md,
    borderWidth: 1,
  },
  feedbackText: { flex: 1, fontSize: 14, lineHeight: 20, paddingVertical: theme.spacing[3] },
  feedbackAction: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  feedbackActionText: { fontSize: 14, fontWeight: theme.fontWeights.semibold },

  notFoundAction: { paddingHorizontal: theme.spacing[5], paddingBottom: theme.spacing[6] },
});
