import {
  ONBOARDING_SKIP_AFTER_SECONDS,
  type PublicOnboarding,
  type PublicOnboardingSlide,
} from '@nilzora/contracts';
import type { Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { useReduceMotion } from '@/components/use-reduce-motion';
import { bannerTarget } from '@/features/brands/brand-components';
import { theme } from '@/theme';
import {
  ART_RATIO,
  Backdrop,
  INTRO_ART,
  INTRO_COLORS,
  PagerDots,
  PillButton,
} from './brand-onboarding-parts';

/**
 * The illustration a campaign slide uses when the Admin has not uploaded a picture.
 *
 * Slides name one of the app's icons rather than a picture, so the named icon selects the
 * closest of the four supplied Introduction illustrations; an icon this build does not know
 * falls back to the illustration in the slide's own position. Either way the sequence is drawn
 * with the same artwork as the app's own welcome, never with a generic icon.
 */
const ART_BY_ICON: Readonly<Record<string, number>> = {
  bag: INTRO_ART.products,
  cart: INTRO_ART.cart,
  cash: INTRO_ART.payment,
  delivery: INTRO_ART.shipping,
  heart: INTRO_ART.cart,
  payment: INTRO_ART.payment,
  products: INTRO_ART.products,
  shipping: INTRO_ART.shipping,
  shop: INTRO_ART.products,
  truck: INTRO_ART.shipping,
  wallet: INTRO_ART.payment,
  wishlist: INTRO_ART.cart,
};

const ART_CYCLE: readonly number[] = [
  INTRO_ART.products,
  INTRO_ART.cart,
  INTRO_ART.payment,
  INTRO_ART.shipping,
];

function artForSlide(slide: PublicOnboardingSlide, index: number): number {
  const named = slide.icon === null ? undefined : ART_BY_ICON[slide.icon];
  return named ?? ART_CYCLE[index % ART_CYCLE.length] ?? INTRO_ART.products;
}

export interface OnboardingScreenProps {
  campaign: PublicOnboarding;
  /** Called once, with the slide's own destination when the last slide names one. */
  onFinish: (destination?: Href) => void;
}

/**
 * The campaign sequence: horizontal slides from the Admin editor, one timer and one pager.
 *
 * Timing rules, as configured per campaign:
 * - each slide stays for 3, 5 or 10 seconds and then advances;
 * - Skip appears once 3 seconds have passed and is hidden before that;
 * - swiping, the dots and Next all work immediately, so nobody has to wait out the timer;
 * - the last slide's button ends the sequence ("Start Shopping" unless the slide names its
 *   own call to action).
 *
 * Timers stop while the app is in the background and are re-armed on return, so a sequence
 * never advances behind the customer's back and never leaves a stray timer behind.
 */
export function OnboardingScreen({ campaign, onFinish }: OnboardingScreenProps) {
  const { width, height } = useWindowDimensions();
  // The art never takes more than this share of the screen, so the copy always has room under it
  // (a percentage cannot do this inside a scroller, whose own height is not fixed).
  const artSize = { maxHeight: Math.max(150, Math.round(height * 0.38)) };
  const reduceMotion = useReduceMotion();
  const pager = useRef<ScrollViewInstance>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const [appActive, setAppActive] = useState(() => AppState.currentState !== 'background');
  const [failedImages, setFailedImages] = useState<readonly string[]>([]);
  const finished = useRef(false);
  const shownAt = useRef<number | null>(null);

  // The gate re-renders with a new callback each time; keeping it in a ref stops that from
  // restarting the slide timer on every render.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  const slides = campaign.slides;
  const last = Math.max(0, slides.length - 1);
  const slide = slides[Math.min(index, last)];
  const onLast = index >= last;

  const finish = useCallback((destination?: Href) => {
    if (finished.current) return;
    finished.current = true;
    onFinishRef.current(destination);
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(last, target));
      const node = pager.current;
      // The pager is absent in some test renderers; the dots still follow the request.
      if (node !== null && typeof node.scrollTo === 'function') {
        node.scrollTo({ x: next * width, animated: true });
      }
      setIndex(next);
    },
    [last, width],
  );

  const advance = useCallback(() => {
    if (index >= last) finish();
    else goTo(index + 1);
  }, [finish, goTo, index, last]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // Skip: measured from when the sequence appeared, so it is available after 3 seconds even
  // if the app was briefly in the background in between.
  useEffect(() => {
    if (canSkip) return;
    if (shownAt.current === null) shownAt.current = Date.now();
    const remaining = ONBOARDING_SKIP_AFTER_SECONDS * 1000 - (Date.now() - shownAt.current);
    if (remaining <= 0) {
      setCanSkip(true);
      return;
    }
    const timer = setTimeout(() => {
      setCanSkip(true);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [appActive, canSkip]);

  // One slide timer at a time: it is cleared on advance, on unmount and while the app is
  // not in the foreground.
  useEffect(() => {
    if (!appActive || finished.current) return;
    const timer = setTimeout(advance, campaign.slideSeconds * 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [advance, appActive, campaign.slideSeconds]);

  // The Admin stores a storefront path (/products, /categories/x, /<brand>): translated to the
  // app's own screens exactly as banner links are, never pushed as a raw website path.
  const ctaDestination: Href | null =
    slide?.ctaPath !== null && slide?.ctaPath !== undefined ? bannerTarget(slide.ctaPath) : null;

  return (
    <View style={styles.root}>
      <Backdrop scrollX={scrollX} width={width} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']} accessibilityViewIsModal>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Logo size="sm" />
          {canSkip && !onLast ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip the introduction"
              accessibilityHint="Closes this and goes to the shop"
              hitSlop={10}
              onPress={() => {
                finish();
              }}
              style={styles.skip}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <Animated.ScrollView
          ref={pager}
          testID="onboarding-pager"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          style={styles.pager}
          onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const page = Math.round(event.nativeEvent.contentOffset.x / width);
            setIndex(Math.max(0, Math.min(last, page)));
          }}
        >
          {slides.map((item, itemIndex) => {
            const active = itemIndex === index;
            const imageFailed = failedImages.includes(item.id);
            return (
              // A vertical scroller on each page: on a short screen the copy scrolls instead
              // of being clipped, while the buttons stay put.
              <ScrollView
                key={item.id}
                testID={`onboarding-slide-${String(itemIndex)}`}
                style={{ width }}
                contentContainerStyle={styles.slideContent}
                showsVerticalScrollIndicator={false}
                accessibilityElementsHidden={!active}
                importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
              >
                <View style={styles.artArea}>
                  {item.imageUrl !== null && !imageFailed ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={[styles.art, artSize]}
                      resizeMode="contain"
                      accessible
                      accessibilityLabel={item.altText ?? undefined}
                      onError={() => {
                        setFailedImages((previous) =>
                          previous.includes(item.id) ? previous : [...previous, item.id],
                        );
                      }}
                    />
                  ) : (
                    // No picture uploaded, or it failed to load: the supplied Introduction
                    // illustration fills the frame, so the sequence is never reduced to a
                    // generic icon.
                    <Image
                      source={artForSlide(item, itemIndex)}
                      style={[styles.art, artSize]}
                      resizeMode="contain"
                      accessible={false}
                      accessibilityIgnoresInvertColors
                    />
                  )}
                </View>
                {item.heading === '' && item.description === '' ? null : (
                  <View style={styles.copy}>
                    {item.heading === '' ? null : (
                      <Text
                        accessibilityRole="header"
                        style={styles.heading}
                        maxFontSizeMultiplier={1.3}
                      >
                        {item.heading}
                      </Text>
                    )}
                    {item.description === '' ? null : (
                      <Text style={styles.description} maxFontSizeMultiplier={1.4}>
                        {item.description}
                      </Text>
                    )}
                  </View>
                )}
              </ScrollView>
            );
          })}
        </Animated.ScrollView>

        <View style={styles.actions}>
          <PagerDots
            count={slides.length}
            activeIndex={index}
            reduceMotion={reduceMotion}
            accessibilityLabel="Onboarding page"
          />
          <View style={styles.controls}>
            {slide !== undefined &&
            slide.ctaLabel !== null &&
            ctaDestination !== null &&
            !onLast ? (
              <PillButton
                label={slide.ctaLabel}
                tone="quiet"
                onPress={() => {
                  finish(ctaDestination);
                }}
              />
            ) : null}
            {onLast ? (
              <PillButton
                label={slide?.ctaLabel ?? 'Start Shopping'}
                tone="primary"
                onPress={() => {
                  finish(ctaDestination ?? undefined);
                }}
              />
            ) : (
              <PillButton label="Next" tone="primary" onPress={advance} />
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  root: { flex: 1, backgroundColor: theme.brand.onSolid },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
  headerSpacer: { width: theme.touchTarget },
  skip: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  skipText: {
    color: INTRO_COLORS.violet,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  pager: { flex: 1 },
  slideContent: {
    // Centred in the space between the header and the buttons.
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[5],
  },
  // The art is sized from the screen (see artSize) and `contain` keeps the supplied proportions;
  // on a very short screen the slide scrolls instead of clipping its copy.
  artArea: { alignItems: 'center', justifyContent: 'center' },
  art: { width: '100%', maxWidth: 380, aspectRatio: ART_RATIO },
  copy: { gap: theme.spacing[3], alignItems: 'center' },
  heading: {
    textAlign: 'center',
    color: INTRO_COLORS.ink,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.4,
  },
  description: {
    textAlign: 'center',
    color: INTRO_COLORS.body,
    ...theme.text.lead,
    lineHeight: 23,
    maxWidth: 320,
  },
  actions: {
    alignItems: 'center',
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  controls: { alignSelf: 'stretch', gap: theme.spacing[3] },
});
