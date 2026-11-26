import type { ShoppingZone } from '@nilzora/contracts';
import { ArrowRight } from 'lucide-react-native';
import { useState } from 'react';
import { Animated, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SectionHeader } from '@/components/section-header';
import { PhotoShade } from '@/components/photo-shade';
import { PressableScale } from '@/components/pressable-scale';
import { theme } from '@/theme';
import { GRID_GAP, SCREEN_PADDING } from './catalog-layout';
import { zoneTint } from './catalog-query';
import type { SectionQuery } from './home-sections';
import { SectionRetry } from './home-sections';
import { AutoplayToggle } from './autoplay-toggle';
import { PagerDots } from './pager-dots';
import { useAutoPager } from './use-auto-pager';

/*
 * "Shop by collection" on Home: a full-width banner carousel, one collection per page.
 *
 * Each banner is the collection's own artwork - the app's picture when the admin gave the zone
 * one, otherwise the website's, otherwise the branded tile built from the brand palette - with
 * the collection's name, its description (or its product count) and a "Shop" button laid on a
 * navy fade along the bottom edge. Every word comes from the collection itself: there is no
 * offer, discount or campaign text here, because the API does not provide any.
 *
 * Two or more collections advance on their own (see useAutoPager: paused while a finger is
 * down, while the app or screen is not in front, and for anyone who asked for reduced motion);
 * one collection sits still with no dots. A collection with nothing on the shelf is left out:
 * an empty shelf is a dead end, and its products stay reachable in plain browsing.
 */

/** How long one collection stays before the carousel moves on. */
export const ZONE_AUTO_ADVANCE_MS = 4500;

/** Width / height of a collection banner: wide like the promotions above it, a little taller. */
export const ZONE_BANNER_RATIO = 16 / 7;

/**
 * A banner is never shorter than this, so the name and the line under it always sit in the part
 * of the fade that is dark enough (see zoneShadeHeight) on the narrowest phones.
 */
export const ZONE_BANNER_MIN_HEIGHT = 140;

/** How much of the banner the fade covers at most; the type is always inside it. */
export const ZONE_SHADE_MAX_HEIGHT = 150;

/** Larger system text is allowed up to this far on a banner, so the words stay inside the fade. */
export const ZONE_TEXT_SCALE_LIMIT = 1.15;

/** The height of a collection banner of `cardWidth`. */
export function zoneBannerHeight(cardWidth: number): number {
  return Math.max(cardWidth / ZONE_BANNER_RATIO, ZONE_BANNER_MIN_HEIGHT);
}

/** The height of the fade behind the words: the lower part of the banner, in dp. */
export function zoneShadeHeight(cardWidth: number): number {
  return Math.min(zoneBannerHeight(cardWidth), ZONE_SHADE_MAX_HEIGHT);
}

/** The width of one collection banner for a window of `width`: the page's content width. */
export function zoneCardWidth(width: number): number {
  return width - SCREEN_PADDING * 2;
}

/** Collections a shopper can actually browse: those with something in them. */
export function shoppableZones(zones: readonly ShoppingZone[]): ShoppingZone[] {
  return zones.filter((zone) => zone.productCount > 0);
}

/** What a screen reader says for one banner: what it is, how much is in it, and where it sits. */
export function zoneBannerLabel(zone: ShoppingZone, index: number, total: number): string {
  const count = `${String(zone.productCount)} ${zone.productCount === 1 ? 'product' : 'products'}`;
  return `Shop the ${zone.name}, ${count}. Collection ${String(index + 1)} of ${String(total)}`;
}

function ZoneBanner({
  zone,
  tintIndex,
  total,
  width,
  reserveDots = false,
  onPress,
}: {
  zone: ShoppingZone;
  tintIndex: number;
  /** How many banners the carousel holds, for "Collection 2 of 5". */
  total: number;
  width: number;
  /** Leaves room at the banner's foot for the page dots drawn over the carousel. */
  reserveDots?: boolean;
  onPress: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // The app's own artwork first: an admin can give the phone a picture that suits a banner whose
  // words sit inside it. Without one the website's picture stands in, exactly as before.
  const pictureUrl = zone.mobileBanner?.url ?? zone.banner?.url ?? null;
  // A picture that will not load falls back to the branded tile rather than a blank banner.
  const showPicture = pictureUrl !== null && failedUrl !== pictureUrl;
  const [tintFrom, tintTo] = zoneTint(tintIndex);
  const count = `${String(zone.productCount)} ${zone.productCount === 1 ? 'product' : 'products'}`;

  return (
    <PressableScale
      accessibilityLabel={zoneBannerLabel(zone, tintIndex, total)}
      accessibilityHint="Opens the shop with this collection"
      onPress={onPress}
      style={{ width }}
    >
      <View style={[styles.banner, { height: zoneBannerHeight(width) }]}>
        {/* The whole banner is the artwork. */}
        {showPicture ? (
          <Image
            key={pictureUrl}
            testID="zone-banner-image"
            source={{ uri: pictureUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessible={false}
            onError={() => {
              setFailedUrl(pictureUrl);
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tintFrom }]}>
            <View style={[styles.blob, { backgroundColor: tintTo }]} />
          </View>
        )}
        <PhotoShade height={zoneShadeHeight(width)} strength="text" />
        {/* The words sit on the fade along the bottom edge: legible on any artwork (4.5:1 even on
            a white one), and never a panel of their own. One line each, so they always stay
            inside the dark part of the fade; the full words are in the spoken label. */}
        <View style={[styles.body, reserveDots ? styles.bodyWithDots : null]}>
          <View style={styles.words}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={ZONE_TEXT_SCALE_LIMIT}
              style={styles.name}
            >
              {zone.name}
            </Text>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={ZONE_TEXT_SCALE_LIMIT}
              style={styles.caption}
            >
              {zone.description ?? count}
            </Text>
          </View>
          <View style={styles.cta}>
            <Text maxFontSizeMultiplier={ZONE_TEXT_SCALE_LIMIT} style={styles.ctaText}>
              Shop
            </Text>
            <ArrowRight size={15} color={theme.brand.onSolid} accessible={false} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

/** The paged banners, on their own so the auto-advance clock only exists when there are some. */
function ZoneCarousel({
  zones,
  onSelect,
}: {
  zones: readonly ShoppingZone[];
  onSelect: (slug: string) => void;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = zoneCardWidth(width);
  const step = cardWidth + GRID_GAP;
  const { scrollRef, page, scrollHandlers, fade, paused, togglePaused, canPause } = useAutoPager({
    count: zones.length,
    step,
    intervalMs: ZONE_AUTO_ADVANCE_MS,
    choiceKey: 'home-collections',
  });

  return (
    <View style={styles.carousel}>
      {/* First in the tree, so a screen reader meets the way to stop the motion before the
          content that moves; it is drawn over the banner's top right corner. */}
      {canPause ? (
        <AutoplayToggle
          paused={paused}
          onToggle={togglePaused}
          subject="collection slideshow"
          testID="zone-autoplay-toggle"
        />
      ) : null}
      <View style={styles.frame}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={step}
          snapToAlignment="start"
          showsHorizontalScrollIndicator={false}
          style={[styles.row, { opacity: fade }]}
          contentContainerStyle={styles.rowContent}
          accessibilityLabel="Collections"
          testID="zone-row"
          {...scrollHandlers}
        >
          {zones.map((zone, index) => (
            <ZoneBanner
              key={zone.id}
              zone={zone}
              tintIndex={index}
              total={zones.length}
              width={cardWidth}
              reserveDots={zones.length > 1}
              onPress={() => {
                onSelect(zone.slug);
              }}
            />
          ))}
        </Animated.ScrollView>
        {/* On the banner's own bottom edge, exactly like the hero carousel: the indicator pages
            the picture it sits on instead of taking a row of its own beneath it. */}
        <View style={styles.dotsOverlay} pointerEvents="none">
          <View style={styles.dotsPill}>
            <PagerDots count={zones.length} page={page} testIDPrefix="zone-dot" tone="onArtwork" />
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * The carousel with its own loading and error behaviour. Nothing at all when no collection can
 * be shopped or the read failed: the rest of the Home screen works without it.
 */
export function ZoneSection({
  query,
  onSelect,
}: {
  query: SectionQuery<readonly ShoppingZone[]>;
  onSelect: (slug: string) => void;
}) {
  const zones = query.data === undefined ? undefined : shoppableZones(query.data);
  const { width } = useWindowDimensions();
  if (zones !== undefined && zones.length === 0) return null;
  if (query.status === 'error' && zones === undefined) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Shop by collection" />
      {zones !== undefined ? (
        <ZoneCarousel zones={zones} onSelect={onSelect} />
      ) : query.status === 'error' ? (
        <SectionRetry
          subject="collections"
          error={query.error}
          retrying={query.isRefetching}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <View style={[styles.loadingTile, { height: zoneBannerHeight(zoneCardWidth(width)) }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.layout.sectionHeaderGap },
  carousel: { position: 'relative' },
  frame: { position: 'relative' },
  dotsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing[2],
    alignItems: 'center',
  },
  dotsPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
  },
  // The row bleeds to the screen edge so a swipe is not clipped by the page padding, then pads
  // the first banner back into line with the heading.
  row: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  rowContent: { paddingHorizontal: SCREEN_PADDING, gap: GRID_GAP },
  /*
   * The banner IS the picture: one radius, no border, no shadow, with the words on the fade
   * along the bottom edge.
   */
  banner: {
    width: '100%',
    justifyContent: 'flex-end',
    borderRadius: theme.radii.xl,
    backgroundColor: theme.brand.navy,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    right: -40,
    bottom: -48,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.5,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    // The words sit close to the banner's foot, where the fade is deepest, so the name and the
    // call to action read as one block over the artwork instead of floating in its middle — but
    // never so close that they touch the rounded edge.
    paddingBottom: theme.spacing[2] + 1,
  },
  /** The strip the page dots sit in, kept clear of the collection's words. */
  bodyWithDots: { paddingBottom: theme.spacing[5] + 2 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  name: {
    color: theme.brand.onSolid,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.3,
  },
  // Solid white: a translucent line would drop under 4.5:1 on a pale picture.
  caption: { color: theme.brand.onSolid, fontSize: 13, lineHeight: 18 },
  // A cue, not a second button (the whole banner is the tap target): a white outline on the
  // fade with a transparent middle, so the artwork shows through. White on the fade keeps well
  // above 4.5:1, so the word and the arrow stay clear on any picture.
  /** A cue, not a button: plain words over the banner's fade, with no border, fill or pill. */
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  ctaText: {
    color: theme.brand.onSolid,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
  loadingTile: {
    width: '100%',
    borderRadius: theme.radii.xl,
    backgroundColor: theme.colors.surfaceMuted,
  },
});
