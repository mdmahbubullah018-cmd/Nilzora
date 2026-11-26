import { useEffect, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { curves } from '@/components/motion-curves';
import { theme } from '@/theme';

/*
 * The introduction's flat building blocks: the colour-washed backdrop with the wave, the page
 * indicator and the pill buttons. Depth comes from gradients and soft colour only — nothing
 * here casts a shadow or has an elevation.
 */

export const INTRO_COLORS = {
  ink: theme.brand.navy,
  body: '#475569',
  violet: '#6D4AE8',
  violetEnd: '#7C5CF0',
  dotIdle: theme.brand.muted,
  /** One soft tint per screen, each fading in from white at the top. */
  washes: ['#F1EEFF', '#E9F7FF', '#FFF0F5', '#EEF2FF', '#E8F7F4'],
} as const;

const wave = require('../../../assets/onboarding/onboarding-wave.webp') as number;
/** The wave artwork's own proportions (1440 x 504). */
const WAVE_RATIO = 504 / 1440;

/**
 * The four supplied Introduction illustrations, in their own order. Both sequences on this
 * overlay draw from this set, so the app's own welcome and an Admin campaign are illustrated
 * with the same artwork instead of one of them falling back to generic icons.
 */
export const INTRO_ART = {
  products: require('../../../assets/onboarding/onboarding-1-products.webp') as number,
  cart: require('../../../assets/onboarding/onboarding-2-cart.webp') as number,
  payment: require('../../../assets/onboarding/onboarding-3-payment.webp') as number,
  shipping: require('../../../assets/onboarding/onboarding-4-shipping.webp') as number,
} as const;

/** Every illustration has the same frame, so one ratio sizes all of them. */
export const ART_RATIO = 1200 / 1040;

function Wash({ id, tint }: { id: string; tint: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.45" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor={tint} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export interface BackdropProps {
  /** The pager's horizontal offset; each screen's wash fades in around its own page. */
  scrollX: Animated.Value;
  width: number;
}

/** Full-screen backdrop: one gradient per screen, cross-faded with the swipe, and the wave. */
export function Backdrop({ scrollX, width }: BackdropProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden>
      {INTRO_COLORS.washes.map((tint, index) => (
        <Animated.View
          key={tint}
          style={[
            StyleSheet.absoluteFill,
            index === 0
              ? null
              : {
                  opacity: scrollX.interpolate({
                    inputRange: [(index - 1) * width, index * width, (index + 1) * width],
                    outputRange: [0, 1, 0],
                    extrapolate: 'clamp',
                  }),
                },
          ]}
        >
          <Wash id={`intro-wash-${String(index)}`} tint={tint} />
        </Animated.View>
      ))}
      <Image
        source={wave}
        style={[styles.wave, { width, height: width * WAVE_RATIO }]}
        resizeMode="stretch"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

export interface PagerDotsProps {
  count: number;
  activeIndex: number;
  reduceMotion: boolean;
  /** Names the sequence being paged; each overlay passes its own. */
  accessibilityLabel?: string;
}

const DOT = 8;
const DOT_ACTIVE = 26;

/**
 * The page indicator: the current page is a violet pill, the others small muted dots. It is one
 * accessible element ("Introduction page, 2 of 4"), and the current page is wider as well as
 * coloured, so the state is not carried by colour alone.
 */
export function PagerDots({
  count,
  activeIndex,
  reduceMotion,
  accessibilityLabel = 'Introduction page',
}: PagerDotsProps) {
  const [widths] = useState(() =>
    Array.from({ length: count }, (_, i) => new Animated.Value(i === activeIndex ? 1 : 0)),
  );

  useEffect(() => {
    const animations = widths.map((value, i) =>
      Animated.timing(value, {
        toValue: i === activeIndex ? 1 : 0,
        duration: reduceMotion ? 0 : 240,
        easing: curves.outCubic,
        // Width is a layout property; four tiny dots are cheap to lay out.
        useNativeDriver: false,
      }),
    );
    const group = Animated.parallel(animations);
    group.start();
    return () => {
      group.stop();
    };
  }, [activeIndex, reduceMotion, widths]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 1, max: count, now: activeIndex + 1 }}
      style={styles.dots}
    >
      {widths.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              width: value.interpolate({ inputRange: [0, 1], outputRange: [DOT, DOT_ACTIVE] }),
              backgroundColor: value.interpolate({
                inputRange: [0, 1],
                outputRange: [INTRO_COLORS.dotIdle, INTRO_COLORS.violet],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  tone: 'primary' | 'quiet';
  accessibilityHint?: string;
}

/** A flat, fully rounded button: a violet gradient for the main action, white for the other. */
export function PillButton({ label, onPress, tone, accessibilityHint }: PillButtonProps) {
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        primary ? null : styles.pillQuiet,
        pressed ? styles.pillPressed : null,
      ]}
    >
      {primary ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="intro-pill" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={INTRO_COLORS.violet} />
                <Stop offset="1" stopColor={INTRO_COLORS.violetEnd} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#intro-pill)" />
          </Svg>
        </View>
      ) : null}
      <Text
        style={[styles.pillLabel, primary ? styles.pillLabelPrimary : styles.pillLabelQuiet]}
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const PILL_HEIGHT = 54;

const styles = StyleSheet.create({
  wave: { position: 'absolute', left: 0, bottom: 0 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6, height: DOT },
  dot: { height: DOT, borderRadius: DOT / 2 },
  pill: {
    minHeight: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[5],
    elevation: 0,
  },
  pillQuiet: {
    backgroundColor: theme.brand.onSolid,
    borderWidth: 1.5,
    borderColor: '#DDD6FE',
  },
  pillPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  pillLabel: { fontSize: 16, lineHeight: 22, fontWeight: theme.fontWeights.semibold },
  pillLabelPrimary: { color: theme.brand.onSolid },
  pillLabelQuiet: { color: INTRO_COLORS.violet },
});
