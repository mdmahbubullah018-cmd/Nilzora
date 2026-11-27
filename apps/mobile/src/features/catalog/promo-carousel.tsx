import type { Banner } from '@nilzora/contracts';
import { ArrowRight } from 'lucide-react-native';
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { theme } from '@/theme';
import { PhotoShade } from '@/components/photo-shade';
import { PressableScale } from '@/components/pressable-scale';
import { GRID_GAP, SCREEN_PADDING } from './catalog-layout';
import { AutoplayToggle } from './autoplay-toggle';
import { PagerDots } from './pager-dots';
import { HERO_AUTO_ADVANCE_MS, useAutoPager } from './use-auto-pager';

export { HERO_AUTO_ADVANCE_MS };

/*
 * Promotional banners. Only what the admin actually published is shown.
 *
 * Every word on a banner is optional. When there is a picture the words are drawn on it, in a
 * container that is ~96% transparent (a 4% wash), so the artwork stays the subject and the text
 * never sits in a card of its own; white type and a soft shadow keep it readable instead of a
 * heavier overlay. A banner with no picture is a tinted card with its words; one with only a
 * picture is just the picture. A placement with no banners renders nothing at all.
 */

/** True when the banner has any words to show. */
function hasWords(banner: Banner): boolean {
  return banner.title !== '' || banner.subtitle !== null || banner.ctaLabel !== null;
}

/**
 * What a banner is, as one spoken sentence for its button: its words when it has any, otherwise
 * the admin's picture description.
 */
export function bannerLabel(banner: Banner): string {
  const words = [banner.title, banner.subtitle, banner.ctaLabel].filter(Boolean).join('. ');
  if (words !== '') return words;
  const described = banner.imageAlt?.trim() ?? '';
  return described !== '' ? described : 'Promotion';
}

/** Larger system text is allowed up to this far on a banner, so the words stay inside the fade. */
export const BANNER_TEXT_SCALE_LIMIT = 1.15;

/** How much of the picture the fade behind the words covers at most (dp). */
export const BANNER_SHADE_MAX_HEIGHT = 150;

/** Width / height of the picture frame of a banner. */
export const BANNER_RATIO = 12 / 5;

/**
 * The height of the fade behind a banner's words, in dp: the lower part of the picture, never
 * more than the picture itself. The words (one line of heading, one of text) stay inside the
 * dark part of it, so they keep 4.5:1 over any artwork.
 */
export function bannerShadeHeight(cardWidth: number): number {
  return Math.min(cardWidth / BANNER_RATIO, BANNER_SHADE_MAX_HEIGHT);
}

/** One banner's call to action. Drawn on the card only when the API gives it a label. */
function BannerCta({ label, onArtwork = false }: { label: string; onArtwork?: boolean }) {
  return (
    <View style={[styles.cta, onArtwork ? styles.ctaOnArtwork : null]}>
      <Text
        maxFontSizeMultiplier={onArtwork ? BANNER_TEXT_SCALE_LIMIT : undefined}
        style={[styles.ctaText, onArtwork ? styles.textOnArtwork : null]}
      >
        {label}
      </Text>
      <ArrowRight
        size={16}
        color={onArtwork ? '#FFFFFF' : theme.colors.primaryActionForeground}
        accessible={false}
      />
    </View>
  );
}

/** The caption under a banner's picture: heading, supporting text and button, each optional. */
function Caption({
  banner,
  compact = false,
  reserveDots = false,
}: {
  banner: Banner;
  compact?: boolean;
  reserveDots?: boolean;
}) {
  if (!hasWords(banner)) return null;
  return (
    <View
      style={[
        styles.caption,
        compact ? styles.captionCompact : null,
        reserveDots ? styles.withDots : null,
      ]}
    >
      {banner.title === '' ? null : (
        <Text numberOfLines={2} style={compact ? styles.captionTitleSmall : styles.captionTitle}>
          {banner.title}
        </Text>
      )}
      {banner.subtitle ? (
        <Text numberOfLines={compact ? 1 : 2} style={styles.captionText}>
          {banner.subtitle}
        </Text>
      ) : null}
      {banner.ctaLabel && !compact ? <BannerCta label={banner.ctaLabel} /> : null}
    </View>
  );
}

/**
 * The same words, drawn on the artwork: a 4% wash with white type and a soft shadow. No opaque
 * panel, no gradient and no shadow on the card itself.
 */
function CaptionOnArtwork({
  banner,
  compact,
  reserveDots = false,
}: {
  banner: Banner;
  compact: boolean;
  reserveDots?: boolean;
}) {
  if (!hasWords(banner)) return null;
  return (
    <View
      style={[styles.captionOverlay, reserveDots ? styles.withDots : null]}
      pointerEvents="none"
      testID="banner-caption"
    >
      <View style={styles.captionOverlayText}>
        {banner.title === '' ? null : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={BANNER_TEXT_SCALE_LIMIT}
            style={compact ? styles.overlayTitleSmall : styles.overlayTitle}
          >
            {banner.title}
          </Text>
        )}
        {banner.subtitle ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={BANNER_TEXT_SCALE_LIMIT}
            style={styles.overlayText}
          >
            {banner.subtitle}
          </Text>
        ) : null}
      </View>
      {banner.ctaLabel && !compact ? <BannerCta label={banner.ctaLabel} onArtwork /> : null}
    </View>
  );
}

/** One banner card: the picture in its frame, then the caption. */
function BannerCard({
  banner,
  width,
  ratio,
  thumb,
  onOpen,
  position,
  compact = false,
  reserveDots = false,
}: {
  banner: Banner;
  width: number;
  /** Width / height of the picture frame. */
  ratio: number;
  /** The small rendition is enough for a narrow card. */
  thumb: boolean;
  onOpen: (banner: Banner) => void;
  /** Where the banner sits in a carousel, so a screen reader can say "Promotion 2 of 3". */
  position?: { index: number; total: number };
  compact?: boolean;
  /** Leaves room at the card's foot for the page dots drawn over the carousel. */
  reserveDots?: boolean;
}) {
  // The phone-shaped picture when the banner has one, otherwise the wide one.
  const picture = banner.mobileImage ?? banner.image;
  return (
    // The press feedback scales the whole card (frame and picture together), so the card keeps
    // its rounded edge while it is held.
    <PressableScale
      accessibilityLabel={
        position === undefined
          ? bannerLabel(banner)
          : `${bannerLabel(banner)}. Promotion ${String(position.index + 1)} of ${String(position.total)}`
      }
      onPress={() => {
        onOpen(banner);
      }}
      style={{ width }}
    >
      <View style={[styles.card, picture ? null : styles.cardTinted]}>
        {picture ? (
          <View>
            <Image
              source={{ uri: thumb ? picture.thumbUrl : picture.url }}
              accessible={false}
              style={{ width: '100%', aspectRatio: ratio }}
              resizeMode="cover"
            />
            {/* The fade is only drawn when there are words to read: a picture-only banner keeps
                its artwork exactly as the admin made it. */}
            {hasWords(banner) ? (
              <PhotoShade height={bannerShadeHeight(width)} strength="text" />
            ) : null}
            <CaptionOnArtwork banner={banner} compact={compact} reserveDots={reserveDots} />
          </View>
        ) : (
          <Caption banner={banner} compact={compact} reserveDots={reserveDots} />
        )}
      </View>
    </PressableScale>
  );
}

/**
 * The page-wide banner carousel: one card per banner, paged sideways with dots beneath.
 *
 * Two or more banners advance on their own every four seconds and wrap around; one banner sits
 * still, because there is nowhere to go. The clock (see useAutoPager) runs only while Home is
 * in front of the customer, the app is in the foreground and the device does not ask for reduced
 * motion; a finger on the carousel pauses it and lifting restarts a full wait. Every
 * transition is the same animated scroll a finger produces, so the page never jumps.
 *
 * The dots are decorative: a screen reader reaches every banner as its own button instead.
 */
export function PromoCarousel({
  banners,
  onOpen,
}: {
  banners: readonly Banner[];
  onOpen: (banner: Banner) => void;
}) {
  const { width } = useWindowDimensions();
  const count = banners.length;
  const cardWidth = width - SCREEN_PADDING * 2;
  const step = cardWidth + GRID_GAP;
  const { scrollRef, page, scrollHandlers, fade, paused, togglePaused, canPause } = useAutoPager({
    count,
    step,
    choiceKey: 'home-promotions',
  });

  if (count === 0) return null;
  return (
    <View style={styles.carousel}>
      {canPause ? (
        <AutoplayToggle
          paused={paused}
          onToggle={togglePaused}
          subject="promotion slideshow"
          testID="promo-autoplay-toggle"
        />
      ) : null}
      <View style={styles.frame}>
        <Animated.ScrollView
          ref={scrollRef}
          testID="promo-row"
          horizontal
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={step}
          snapToAlignment="start"
          showsHorizontalScrollIndicator={false}
          style={[styles.bleed, { opacity: fade }]}
          contentContainerStyle={styles.bleedContent}
          {...scrollHandlers}
        >
          {banners.map((banner, index) => (
            // 12:5 is the phone hero's frame: wide and horizontal, the shape the admin uploads for.
            <BannerCard
              key={banner.id}
              banner={banner}
              width={cardWidth}
              ratio={12 / 5}
              thumb={false}
              position={count > 1 ? { index, total: count } : undefined}
              reserveDots={count > 1}
              onOpen={onOpen}
            />
          ))}
        </Animated.ScrollView>
        {/* Inside the banner, on its bottom edge: the page indicator belongs to the picture it
            pages, not to a row of its own below it. The caption above reserves this strip. */}
        <View style={styles.dotsOverlay} pointerEvents="none">
          <View style={styles.dotsPill}>
            <PagerDots count={count} page={page} testIDPrefix="banner-dot" tone="onArtwork" />
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * The smaller campaign row: the same banners, as cards that peek from the screen edge so it
 * is obvious the row scrolls. Used for the placements that are not the page's hero.
 */
export function PromoRow({
  banners,
  onOpen,
}: {
  banners: readonly Banner[];
  onOpen: (banner: Banner) => void;
}) {
  const { width } = useWindowDimensions();
  if (banners.length === 0) return null;
  // Narrow enough that the next card always shows a sliver, wide enough for two lines of title.
  const cardWidth = Math.min(Math.max(width * 0.72, 240), 320);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={cardWidth + GRID_GAP}
      snapToAlignment="start"
      style={styles.bleed}
      contentContainerStyle={styles.bleedContent}
    >
      {banners.map((banner) => (
        <BannerCard
          key={banner.id}
          banner={banner}
          width={cardWidth}
          // The same wide frame as the hero, so the two rows read as one system.
          ratio={12 / 5}
          thumb
          compact
          onOpen={onOpen}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  bleedContent: { gap: GRID_GAP, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },

  carousel: { position: 'relative' },
  // The picture's own frame: the dots are positioned against this, not against the screen.
  frame: { position: 'relative' },
  dotsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing[2],
    alignItems: 'center',
  },
  // A slim dark pill keeps white dots legible over pale artwork; it hugs the 4dp dots rather
  // than reading as a panel of its own.
  dotsPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
  },
  /** The strip the dots sit in, kept clear of the words. */
  withDots: { paddingBottom: 18 },
  card: {
    borderRadius: theme.radii.xl,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cardTinted: {
    backgroundColor: theme.colors.surfaceMuted,
    minHeight: 96,
    justifyContent: 'center',
  },

  caption: { gap: 6, paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[3] },
  captionCompact: { gap: 2, paddingVertical: theme.spacing[2] },
  captionTitle: {
    color: theme.colors.foreground,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.3,
  },
  captionTitleSmall: {
    color: theme.colors.foreground,
    ...theme.text.subheading,
    fontSize: 15,
    lineHeight: 20,
  },
  captionText: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },

  // The words on the artwork: a 4% white wash over the navy fade, and nothing behind the type
  // but that fade. No shadow, no opaque panel.
  captionOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  captionOverlayText: { flex: 1, minWidth: 0, gap: 2 },
  overlayTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.3,
  },
  overlayTitleSmall: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: theme.fontWeights.semibold,
  },
  overlayText: {
    // Solid white: a translucent line would drop under 4.5:1 on a pale picture.
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
  },
  textOnArtwork: {
    color: '#FFFFFF',
  },

  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.spacing[1],
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.primaryAction,
  },
  ctaText: {
    color: theme.colors.primaryActionForeground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  // On the artwork the button is a label and an arrow, not a solid pill over the picture.
  ctaOnArtwork: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    minHeight: 0,
  },
});
