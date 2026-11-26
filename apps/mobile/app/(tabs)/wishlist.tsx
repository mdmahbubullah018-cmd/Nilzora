import { useRouter } from 'expo-router';
import { ShoppingCart } from 'lucide-react-native';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useApi } from '@/api/api-context';
import { useCart } from '@/cart/cart-context';
import { AvailabilityBadge } from '@/components/availability-badge';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { icons } from '@/components/icon';
import { ListScreen } from '@/components/list-screen';
import { PressableScale } from '@/components/pressable-scale';
import { Price } from '@/components/price';
import { QueryStateView } from '@/components/query-state';
import { ScreenHeader } from '@/components/screen-header';
import { ListSkeleton } from '@/components/skeleton';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { announce, describeAddOutcome } from '@/features/catalog/add-to-cart';
import { orderableLimit } from '@/features/catalog/catalog-query';
import { ProductVisual } from '@/features/catalog/product-visual';
import { useQuickAdd } from '@/features/catalog/quick-add';
import { ApiNotConfiguredError } from '@/lib/errors';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { theme } from '@/theme';
import { useWishlist, useWishlistProducts, type WishlistRow } from '@/wishlist';

/**
 * The Wishlist tab. Signed in, the list is the account's and follows the customer to the
 * website; signed out it is this device's. Either way every row is filled in from the live
 * product the API returns for its slug - never from a saved price or name - so a product that
 * has gone away says so instead of showing a price that is no longer true.
 */
export default function WishlistScreen() {
  const router = useRouter();
  const api = useApi();
  const wishlist = useWishlist();
  const slugs = wishlist.entries.map((entry) => entry.slug);
  const products = useWishlistProducts(slugs);
  const { onRefresh } = useManualRefresh(products.refetch);

  const openProduct = (row: WishlistRow) => {
    if (row.product === undefined) return;
    router.push({ pathname: '/product/[slug]', params: { slug: row.product.slug } });
  };

  /**
   * The wishlist is a tab, so it has no navigation bar to inherit a back control from — yet it
   * is also opened from the account screen, where a way back is expected. This pops the stack
   * when there is one, and otherwise returns to Home, so the control never goes nowhere.
   */
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  };

  const header = (
    <View style={styles.header}>
      <ScreenHeader title="Wishlist" onBack={goBack} />
      {wishlist.count > 0 ? (
        <Text style={styles.deviceNote}>
          {wishlist.synced
            ? 'Saved to your account, so it follows you to the website.'
            : 'Saved on this device. Sign in to keep your wishlist with your account.'}
        </Text>
      ) : null}
    </View>
  );

  if (!wishlist.hydrated) {
    return (
      <ListScreen<WishlistRow>
        edges={['top']}
        bottomSpace={TAB_BAR_SPACE}
        header={header}
        data={[]}
        renderItem={() => null}
        ListEmptyComponent={<ListSkeleton rows={3} label="Loading your wishlist" />}
      />
    );
  }

  if (wishlist.count === 0) {
    return (
      <ListScreen<WishlistRow>
        edges={['top']}
        bottomSpace={TAB_BAR_SPACE}
        header={header}
        data={[]}
        renderItem={() => null}
        ListEmptyComponent={
          <EmptyState
            icon={icons.wishlist}
            title="Your wishlist is empty"
            description="Open a product and tap the heart to save it here."
            action={{
              label: 'Browse the shop',
              onPress: () => {
                router.navigate('/shop');
              },
            }}
          />
        }
      />
    );
  }

  // Saved slugs still need the API to show live prices; without an address this is a build
  // problem, not a network one, and is named as such.
  if (api === null) {
    return (
      <ListScreen<WishlistRow>
        edges={['top']}
        bottomSpace={TAB_BAR_SPACE}
        header={header}
        data={[]}
        renderItem={() => null}
        ListEmptyComponent={<QueryStateView state="error" error={new ApiNotConfiguredError()} />}
      />
    );
  }

  return (
    <ListScreen<WishlistRow>
      testID="wishlist-list"
      edges={['top']}
      bottomSpace={TAB_BAR_SPACE}
      header={header}
      data={products.rows}
      keyExtractor={(row) => row.slug}
      onRefresh={onRefresh}
      ListEmptyComponent={
        products.loading ? <ListSkeleton rows={3} label="Loading your wishlist" /> : undefined
      }
      renderItem={({ item }) => (
        <WishlistRowView
          row={item}
          onOpen={() => {
            openProduct(item);
          }}
          onRemove={() => {
            wishlist.remove(item.slug);
          }}
          busy={item.product !== undefined && wishlist.busy(item.product.id)}
        />
      )}
    />
  );
}

function WishlistRowView({
  row,
  onOpen,
  onRemove,
  busy,
}: {
  row: WishlistRow;
  onOpen: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { product } = row;
  const cart = useCart();
  const limit = product === undefined ? 0 : orderableLimit(product);
  const inCart = product === undefined ? 0 : cart.quantityOf(product.id);
  const name =
    product?.name ??
    (row.loading
      ? 'Loading product...'
      : row.missing
        ? 'Product no longer available'
        : 'This product could not be loaded');
  const detail = product
    ? null
    : row.loading
      ? 'Fetching the latest price and stock.'
      : row.missing
        ? 'It is no longer sold in the shop.'
        : 'Pull down to try again.';

  // The plain add is only for a product the catalog confirms has no variants; one with
  // variants opens the options sheet instead (see useQuickAdd).
  const addDirect = () => {
    if (product === undefined) return;
    const outcome = cart.add(product.id, 1, limit);
    const feedback = describeAddOutcome({ outcome, requested: 1, before: inCart, limit });
    if (outcome === 'added') {
      announce(`${product.name} added to cart. ${inCart + 1} in your cart.`);
    } else {
      Alert.alert(product.name, feedback.message);
    }
  };
  const quickAdd = useQuickAdd(
    { id: product?.id ?? '', slug: product?.slug ?? row.slug, name },
    addDirect,
  );

  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityLabel={product ? `${name}, open product` : name}
        accessibilityState={{ disabled: product === undefined }}
        disabled={product === undefined}
        onPress={onOpen}
        style={styles.rowMain}
      >
        <ProductVisual
          categorySlug={product?.category.slug}
          imageUri={product?.image?.url ?? null}
          size="card"
          dimmed={row.missing}
          style={styles.thumb}
        />
        {/* Everything about the product lives to the right of its picture: the name first, then
            its live price and availability, so the row reads left to right. */}
        <View style={styles.info}>
          <Text numberOfLines={2} style={styles.name}>
            {name}
          </Text>
          {product ? (
            <>
              <Price
                priceMinor={product.priceMinor}
                compareAtPriceMinor={product.compareAtPriceMinor}
                size="sm"
              />
              <AvailabilityBadge availability={product.availability} />
            </>
          ) : (
            <Text style={styles.detail}>{detail}</Text>
          )}
        </View>
      </PressableScale>
      <View style={styles.actions}>
        {limit > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              inCart > 0 ? `Add one more ${name} to cart, ${inCart} in cart` : `Add ${name} to cart`
            }
            accessibilityState={{ busy: quickAdd.checking }}
            disabled={quickAdd.checking}
            onPress={quickAdd.press}
            style={styles.addButton}
          >
            <ShoppingCart size={18} color={theme.colors.primary} strokeWidth={1.9} accessible={false} />
          </PressableScale>
        ) : null}
        <IconButton
          icon={icons.wishlistFilled}
          label={`Remove ${name} from your wishlist`}
          selected
          disabled={busy}
          onPress={onRemove}
        />
      </View>
      {quickAdd.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[1] },
  deviceNote: { ...theme.text.caption, color: theme.colors.mutedForeground },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  thumb: { width: 76, height: 76, borderRadius: theme.radii.input },
  info: { flex: 1, gap: theme.spacing[1] },
  name: { ...theme.text.bodyStrong, color: theme.colors.foreground },
  detail: { ...theme.text.caption, color: theme.colors.mutedForeground },
  actions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  /** A compact cart button beside the heart: same 40dp circle, brand-blue glyph on a tint. */
  addButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  addPressed: { backgroundColor: theme.colors.surfaceMuted },
});
