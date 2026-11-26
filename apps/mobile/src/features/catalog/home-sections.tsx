import type { Category, ProductSummary } from '@nilzora/contracts';
import { ArrowRight, Banknote, Camera, CloudOff, Mic, Search, Truck } from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { CartButton } from '@/components/cart-button';
import { EmptyState } from '@/components/empty-state';
import { AppIcon, type IconName } from '@/components/icon';
import { SectionHeader } from '@/components/section-header';
import { TabHeader } from '@/components/tab-header';
import { describeApiError } from '@/lib/errors';
import { theme } from '@/theme';
import { isVoiceSearchSupported } from '@/voice/native-speech';
import { SCREEN_PADDING, GRID_GAP, useRowCardWidth } from './catalog-layout';
import { branchProductCount, departmentsOf, productCountLabel } from './catalog-query';
import { CategoryCover } from './category-cover';
import { CategoryRowSkeleton, ProductRowSkeleton } from './catalog-skeletons';
import { ProductCard } from './product-card';

/*
 * The pieces of the Home screen. Each section owns its loading, error and "nothing to show"
 * behaviour, so one failing request never takes the rest of the page with it.
 */

/** Extends the two 30dp icon slots on the home bar back to a comfortable tap target. */
const HOME_ACTION_HIT_SLOP = { top: 6, bottom: 6, left: 7, right: 7 } as const;

/** The brand row with the cart, then a search box that opens the Shop screen keyboard-ready. */
export function HomeHeader({
  onSearch,
  onVoiceSearch,
  onPhotoSearch,
}: {
  onSearch: () => void;
  /** Opens the search with the voice window; the microphone shows only when the phone supports it. */
  onVoiceSearch?: () => void;
  /** Opens the camera for image search, beside the microphone the way Daraz places it. */
  onPhotoSearch: () => void;
}) {
  const voice = onVoiceSearch !== undefined && isVoiceSearchSupported();
  return (
    <View style={styles.header}>
      <TabHeader subtitle="Shop now, pay on delivery" action={<CartButton />}>
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search products"
            accessibilityHint="Opens the shop with the search box ready"
            onPress={onSearch}
            android_ripple={{ color: 'rgba(2, 132, 199, 0.14)' }}
            style={styles.search}
          >
            <Search size={20} color={theme.colors.primary} accessible={false} />
            <Text style={styles.searchText} numberOfLines={1}>
              Search products
            </Text>
            <View style={voice ? styles.spaceWithVoice : styles.spaceWithCamera} />
          </Pressable>
          {/* The pair is one absolutely positioned row over the bar's right edge, so the two
              glyphs sit a thumb's width apart rather than a button's width apart. */}
          <View style={styles.actions} testID="home-search-actions">
            {voice ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search by voice"
                hitSlop={HOME_ACTION_HIT_SLOP}
                onPress={onVoiceSearch}
                android_ripple={{ color: 'rgba(2, 132, 199, 0.18)', borderless: true }}
                style={styles.action}
              >
                <Mic size={20} color={theme.colors.primary} accessible={false} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search by photo"
              accessibilityHint="Opens the camera to find a product from a picture"
              hitSlop={HOME_ACTION_HIT_SLOP}
              onPress={onPhotoSearch}
              android_ripple={{ color: 'rgba(2, 132, 199, 0.18)', borderless: true }}
              style={styles.action}
            >
              <Camera size={20} color={theme.colors.primary} accessible={false} />
            </Pressable>
          </View>
        </View>
      </TabHeader>
    </View>
  );
}

/** The navy welcome card. Only facts that are true of the shop: cash on delivery, delivery in Bangladesh. */
export function HomeHero({ onShop }: { onShop: () => void }) {
  return (
    <View style={styles.hero}>
      <View pointerEvents="none" style={[styles.heroGlow, styles.heroGlowTop]} />
      <View pointerEvents="none" style={[styles.heroGlow, styles.heroGlowBottom]} />
      <View style={styles.heroPill}>
        <View style={styles.heroDot} />
        <Text style={styles.heroPillText}>Cash on delivery</Text>
      </View>
      <Text accessibilityRole="header" style={styles.heroTitle}>
        Everyday style and essentials, delivered to your door.
      </Text>
      <Text style={styles.heroBody}>
        Fashion, footwear, beauty and more. Order in a few taps and pay in cash when your parcel
        arrives.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Shop all products"
        onPress={onShop}
        android_ripple={{ color: 'rgba(15, 23, 42, 0.2)' }}
        style={({ pressed }) => [styles.heroButton, pressed ? styles.heroButtonPressed : null]}
      >
        <Text style={styles.heroButtonText}>Shop all products</Text>
        <ArrowRight size={18} color={theme.colors.navy} accessible={false} />
      </Pressable>
      <View style={styles.heroFacts}>
        <View style={styles.heroFact}>
          <Banknote size={16} color={theme.colors.sky} accessible={false} />
          <Text style={styles.heroFactText}>Cash on delivery</Text>
        </View>
        <View style={styles.heroFact}>
          <Truck size={16} color={theme.colors.sky} accessible={false} />
          <Text style={styles.heroFactText}>Charge shown at checkout</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The four promises the shop can keep, worded as the website words them, each with the short
 * explanation its sheet shows. Every line says only what the project does: delivery times, the
 * return period and support hours are the store's own to state, so none is promised here.
 */
interface TrustItem {
  id: string;
  icon: IconName;
  title: string;
  /** What the narrow strip prints when the full title would not fit one line. */
  label?: string;
  explanation: readonly string[];
  action?: { label: string; href: Href };
}

const TRUST_ITEMS: readonly TrustItem[] = [
  {
    id: 'delivery',
    icon: 'delivery',
    title: 'Fast Delivery',
    explanation: [
      'Your order is delivered to the address you choose at checkout, and you pay in cash when it arrives.',
      'The delivery charge for your area is shown before you place the order, so there is no surprise at the door.',
      'Follow your order from confirmation to delivery in your account. Delivery times depend on your area and are not fixed in advance.',
    ],
    action: { label: 'Track my orders', href: '/orders' },
  },
  {
    id: 'checkout',
    icon: 'shield',
    title: 'Secure Checkout',
    explanation: [
      'Sign-in and ordering are protected, and every price and total is worked out by our server, so what you pay cannot be changed from your phone.',
      'Payment is cash on delivery for now, so we never ask for card or mobile-banking details online.',
    ],
  },
  {
    id: 'returns',
    icon: 'returns',
    title: 'Easy Returns',
    explanation: [
      'Once an order has been delivered, you can request a return from your account and follow its progress there.',
      'The store reviews each request. The return period and conditions are set by the store, so check its returns policy before you order.',
    ],
    action: { label: 'My returns', href: '/returns' },
  },
  {
    id: 'support',
    icon: 'help',
    title: 'Customer Support',
    label: 'Support',
    explanation: [
      'Questions about an order, a delivery or a return? Chat with us from Help & support and we will help.',
    ],
    action: { label: 'Help & support', href: '/support' },
  },
];

/**
 * The trust panel under the hero: a slim, barely-there strip set a short step below the banner.
 * Four columns, small icons over short labels, the same promises as the website in a shape that
 * suits a phone and never competes with the banner. Each one opens a small bottom sheet that
 * explains it; the spoken label says so.
 */
export function HomeTrustPanel() {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const current = TRUST_ITEMS.find((item) => item.id === openId);
  return (
    <>
      <View style={styles.trustPanel}>
        {TRUST_ITEMS.map(({ id, icon, title, label }) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint="Opens a short explanation"
            onPress={() => {
              setOpenId(id);
            }}
            android_ripple={{ color: 'rgba(2, 132, 199, 0.14)' }}
            style={styles.trustItem}
          >
            <View style={styles.trustIcon}>
              <AppIcon name={icon} size="xs" color={theme.colors.primary} />
            </View>
            {/* One line, always: the type shrinks a little on the narrowest phones instead of wrapping. */}
            <Text
              style={styles.trustLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {label ?? title}
            </Text>
          </Pressable>
        ))}
      </View>
      <BottomSheet
        visible={current !== undefined}
        onClose={() => {
          setOpenId(null);
        }}
        title={current?.title ?? ''}
        testID="trust-sheet"
        footer={
          current?.action ? (
            <Button
              label={current.action.label}
              variant="secondary"
              onPress={() => {
                const target = current.action?.href;
                setOpenId(null);
                if (target !== undefined) router.push(target);
              }}
            />
          ) : undefined
        }
      >
        <View style={styles.trustSheetBody}>
          {current?.explanation.map((line) => (
            <Text key={line} style={styles.trustSheetText}>
              {line}
            </Text>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

/** A section that failed to load: what happened and, when it can help, "Try again". */
export function SectionRetry({
  subject,
  error,
  onRetry,
  retrying,
}: {
  subject: string;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { message, retryable } = describeApiError(error);
  return (
    <Card>
      <View accessibilityLiveRegion="polite">
        <EmptyState icon={CloudOff} title={`We could not load ${subject}`} description={message} />
      </View>
      {retryable ? (
        <View style={styles.retry}>
          <Button label="Try again" loading={retrying} onPress={onRetry} />
        </View>
      ) : null}
    </Card>
  );
}

/** A sideways scroller that runs to the screen edges while its first card lines up with the page. */
function Bleed({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.bleedContent}
    >
      {children}
    </ScrollView>
  );
}

function CategoryTile({ category, onPress }: { category: Category; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${productCountLabel(branchProductCount(category))}`}
      accessibilityHint="Shows the products in this category"
      onPress={onPress}
      android_ripple={{ color: 'rgba(2, 132, 199, 0.14)' }}
      style={styles.tile}
    >
      <CategoryCover
        category={category}
        iconSize={30}
        style={styles.tileCover}
        testID="category-tile-cover"
      />
      <Text numberOfLines={2} style={styles.tileName}>
        {category.name}
      </Text>
      <Text style={styles.tileCount}>{productCountLabel(branchProductCount(category))}</Text>
    </Pressable>
  );
}

export interface SectionQuery<T> {
  status: 'pending' | 'error' | 'success';
  data: T | undefined;
  error: unknown;
  refetch: () => unknown;
  isRefetching: boolean;
}

/** "Shop by category": tiles that open the Shop filtered by that category. Hidden when there are none. */
export function CategorySection({
  query,
  onSelect,
  onSeeAll,
}: {
  query: SectionQuery<readonly Category[]>;
  onSelect: (slug: string) => void;
  onSeeAll: () => void;
}) {
  if (query.data !== undefined && query.data.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Shop by category"
        actionLabel="All categories"
        actionAccessibilityLabel="See all categories"
        onActionPress={onSeeAll}
      />
      {query.data !== undefined ? (
        <Bleed>
          {/* Only the main categories: a category's own screen lists its subcategories. */}
          {departmentsOf(query.data).map((category) => (
            <CategoryTile
              key={category.slug}
              category={category}
              onPress={() => {
                onSelect(category.slug);
              }}
            />
          ))}
        </Bleed>
      ) : query.status === 'error' ? (
        <SectionRetry
          subject="categories"
          error={query.error}
          retrying={query.isRefetching}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <CategoryRowSkeleton />
      )}
    </View>
  );
}

/** A titled sideways row of products with "See all". Hidden when the query loaded nothing to show. */
export function ProductRowSection<T>({
  title,
  subject,
  query,
  select,
  onSeeAll,
}: {
  title: string;
  /** Lower-case name for messages: "featured products". */
  subject: string;
  query: SectionQuery<T>;
  select: (data: T) => readonly ProductSummary[];
  onSeeAll: () => void;
}) {
  const products = query.data !== undefined ? select(query.data) : undefined;
  const cardWidth = useRowCardWidth();
  if (products !== undefined && products.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={title} onActionPress={onSeeAll} />
      {products !== undefined ? (
        <Bleed>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} width={cardWidth} />
          ))}
        </Bleed>
      ) : query.status === 'error' ? (
        <SectionRetry
          subject={subject}
          error={query.error}
          retrying={query.isRefetching}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ProductRowSkeleton label={`Loading ${subject}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[3] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 52,
    paddingHorizontal: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    shadowColor: theme.colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  searchText: { flex: 1, color: theme.colors.mutedForeground, fontSize: 15 },
  // Room inside the bar for the buttons that sit over its right edge: the camera alone, or
  // the camera and the microphone side by side.
  spaceWithCamera: { width: 34 },
  spaceWithVoice: { width: 64 },
  /** The trailing pair, pinned over the bar's right edge: two 30dp slots, no gap between them. */
  actions: {
    position: 'absolute',
    top: 2,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    width: 30,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hero: {
    gap: theme.spacing[3],
    padding: theme.spacing[6],
    paddingTop: theme.spacing[6] + 4,
    borderRadius: 24,
    backgroundColor: theme.colors.navy,
    overflow: 'hidden',
  },
  heroGlow: { position: 'absolute', borderRadius: 999 },
  heroGlowTop: {
    width: 220,
    height: 220,
    top: -110,
    right: -70,
    backgroundColor: 'rgba(56, 189, 248, 0.22)',
  },
  heroGlowBottom: {
    width: 180,
    height: 180,
    bottom: -110,
    left: -60,
    backgroundColor: 'rgba(139, 92, 246, 0.16)',
  },
  heroPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
  },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.sky },
  heroPillText: {
    color: theme.colors.sky,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
  heroTitle: {
    color: theme.colors.softBackground,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.6,
  },
  heroBody: { color: theme.colors.mutedSlate, fontSize: 15, lineHeight: 22 },
  heroButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[5],
    marginTop: theme.spacing[1],
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.sky,
    overflow: 'hidden',
  },
  heroButtonPressed: { backgroundColor: '#7DD3FC' },
  heroButtonText: {
    color: theme.colors.navy,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  heroFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[4],
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(203, 213, 225, 0.25)',
  },
  heroFact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroFactText: { color: theme.colors.mutedSlate, fontSize: 13, lineHeight: 18 },

  /*
   * A slim strip directly under the banner (no overlap), light enough to recede: the base
   * glass wash, a hairline border and no elevation. The fixed 55dp rail keeps the panel from
   * growing around its content while still letting a two-line label on a narrow phone.
   */
  trustPanel: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
    minHeight: 44,
    paddingVertical: 4,
    paddingHorizontal: theme.spacing[1],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: theme.glass.surface,
  },
  trustItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
  trustIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.glass.activePill,
  },
  trustSheetBody: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  trustSheetText: { color: theme.colors.body, ...theme.text.body, lineHeight: 22 },
  trustLabel: {
    color: theme.glass.foreground,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: theme.fontWeights.semibold,
    textAlign: 'center',
  },

  section: { gap: theme.layout.sectionHeaderGap },
  retry: { paddingHorizontal: theme.spacing[5], paddingBottom: theme.spacing[6] },
  bleed: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  bleedContent: { gap: GRID_GAP, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },

  tile: {
    width: 104,
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
  },
  tileCover: {
    width: 104,
    aspectRatio: 1,
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  tileName: {
    width: '100%',
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: theme.fontWeights.semibold,
    textAlign: 'center',
  },
  tileCount: { color: theme.colors.mutedForeground, fontSize: 11, textAlign: 'center' },
});
