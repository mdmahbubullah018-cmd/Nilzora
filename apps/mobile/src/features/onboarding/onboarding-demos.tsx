import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { curves } from '@/components/motion-curves';
import { theme } from '@/theme';
import type { OnboardingCopy, OnboardingStepId } from './onboarding-copy';

/*
 * The five miniature screens.
 *
 * Each step shows the real screen it is talking about — a product card, a photo frame, the
 * colour-and-size picker, the add-to-cart bar, the cash-on-delivery summary — drawn small and
 * flat from the same theme tokens the app itself uses, so what a customer sees here is what
 * they get. A single pulsing "tap" ring marks the control the step is about, and on the photo
 * step it swipes instead.
 *
 * Everything is opacity/transform on the native driver, and with "reduce motion" on the
 * scenes hold still: the ring and the swipe are cues, not decoration, so they stop rather than
 * move slowly.
 */

const SCENE_HEIGHT = 176;

interface SceneProps {
  copy: OnboardingCopy;
  active: boolean;
  reduceMotion: boolean;
}

/** A soft ring that pulses over the control the step is about. */
function Tap({
  style,
  active,
  reduceMotion,
}: {
  style: object;
  active: boolean;
  reduceMotion: boolean;
}) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: curves.outCubic,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, pulse, reduceMotion]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View pointerEvents="none" style={[styles.tapWrap, style]} aria-hidden>
      <View style={styles.tapDot} />
      <Animated.View style={[styles.tapRing, { opacity, transform: [{ scale }] }]} />
    </View>
  );
}

function Scene({ children, testID }: { children: React.ReactNode; testID: string }) {
  return (
    <View testID={testID} style={styles.scene} aria-hidden>
      {children}
    </View>
  );
}

/** The product card the shop is built from: picture, name, price, colours. */
function MiniCard({ copy, highlightColours }: { copy: OnboardingCopy; highlightColours: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardImage}>
        <View style={styles.tee} />
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {copy.demo.product}
      </Text>
      <Text style={styles.cardPrice}>{copy.demo.price}</Text>
      <View style={styles.swatchRow}>
        {[theme.brand.navy, '#1E3A8A', theme.brand.soft].map((colour, index) => (
          <View
            key={colour}
            style={[
              styles.swatch,
              { backgroundColor: colour },
              highlightColours && index === 1 ? styles.swatchChosen : null,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function BrowseScene({ copy, active, reduceMotion }: SceneProps) {
  return (
    <Scene testID="onboarding-demo-browse">
      <View style={styles.searchBar}>
        <View style={styles.searchDot} />
        <Text style={styles.searchText}>{copy.demo.search}</Text>
      </View>
      <View style={styles.chipRow}>
        {['Fashion', 'Home', 'Beauty'].map((chip, index) => (
          <View key={chip} style={[styles.chip, index === 0 ? styles.chipActive : null]}>
            <Text style={[styles.chipText, index === 0 ? styles.chipTextActive : null]}>
              {chip}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.cardRow}>
        <MiniCard copy={copy} highlightColours={false} />
        <View style={styles.cardGhost} />
      </View>
      <Tap style={styles.tapOnFirstChip} active={active} reduceMotion={reduceMotion} />
    </Scene>
  );
}

function PhotosScene({ active, reduceMotion }: SceneProps) {
  const [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active || reduceMotion) {
      slide.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(slide, {
          toValue: 1,
          duration: 900,
          easing: curves.inOutSine,
          useNativeDriver: true,
        }),
        Animated.delay(500),
        Animated.timing(slide, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, reduceMotion, slide]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, -46] });
  return (
    <Scene testID="onboarding-demo-photos">
      <View style={styles.photoFrame}>
        <Animated.View style={[styles.photoStrip, { transform: [{ translateX }] }]}>
          <View style={[styles.photo, styles.photoFirst]}>
            <View style={styles.tee} />
          </View>
          <View style={[styles.photo, styles.photoSecond]}>
            <View style={[styles.tee, styles.teeAlt]} />
          </View>
        </Animated.View>
        <View style={styles.photoDots}>
          <View style={[styles.photoDot, styles.photoDotActive]} />
          <View style={styles.photoDot} />
          <View style={styles.photoDot} />
        </View>
      </View>
      <Tap style={styles.tapOnPhoto} active={active} reduceMotion={reduceMotion} />
    </Scene>
  );
}

function VariantsScene({ copy, active, reduceMotion }: SceneProps) {
  return (
    <Scene testID="onboarding-demo-variants">
      <Text style={styles.sceneLabel}>{copy.demo.colour}</Text>
      <View style={styles.swatchRow}>
        {[theme.brand.navy, '#1E3A8A', theme.brand.soft].map((colour, index) => (
          <View
            key={colour}
            style={[
              styles.swatch,
              styles.swatchLarge,
              { backgroundColor: colour },
              index === 1 ? styles.swatchChosen : null,
            ]}
          />
        ))}
      </View>
      <Text style={styles.sceneLabel}>{copy.demo.size}</Text>
      <View style={styles.sizeRow}>
        {['S', 'M', 'L', 'XL'].map((size) => (
          <View key={size} style={[styles.sizeChip, size === 'M' ? styles.sizeChipActive : null]}>
            <Text style={[styles.sizeText, size === 'M' ? styles.sizeTextActive : null]}>
              {size}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.cardPrice}>{copy.demo.price}</Text>
      <Tap style={styles.tapOnSize} active={active} reduceMotion={reduceMotion} />
    </Scene>
  );
}

function CartScene({ copy, active, reduceMotion }: SceneProps) {
  const [pop] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active || reduceMotion) {
      pop.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(pop, {
          toValue: 1.18,
          duration: 240,
          easing: curves.outCubic,
          useNativeDriver: true,
        }),
        Animated.timing(pop, {
          toValue: 1,
          duration: 320,
          easing: curves.outCubic,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, pop, reduceMotion]);

  return (
    <Scene testID="onboarding-demo-cart">
      <View style={styles.cardRow}>
        <MiniCard copy={copy} highlightColours />
      </View>
      <View style={styles.cartBar}>
        <Text style={styles.cartBarText}>{copy.demo.addToCart}</Text>
        <Animated.View style={[styles.cartBadge, { transform: [{ scale: pop }] }]}>
          <Text style={styles.cartBadgeText}>1</Text>
        </Animated.View>
      </View>
      <Tap style={styles.tapOnCartBar} active={active} reduceMotion={reduceMotion} />
    </Scene>
  );
}

function OrderScene({ copy, active, reduceMotion }: SceneProps) {
  return (
    <Scene testID="onboarding-demo-order">
      <View style={styles.sheet}>
        <View style={styles.sheetRow}>
          <Text style={styles.sheetLabel}>{copy.demo.address}</Text>
          <View style={styles.sheetLine} />
        </View>
        <View style={[styles.sheetRow, styles.sheetRowCod]}>
          <View style={styles.radioOn}>
            <View style={styles.radioDot} />
          </View>
          <Text style={styles.sheetValue}>{copy.demo.cod}</Text>
        </View>
        <View style={styles.sheetRow}>
          <Text style={styles.sheetLabel}>{copy.demo.total}</Text>
          <Text style={styles.sheetValue}>{copy.demo.price}</Text>
        </View>
      </View>
      <View style={styles.cartBar}>
        <Text style={styles.cartBarText}>{copy.demo.placeOrder}</Text>
      </View>
      <Tap style={styles.tapOnCartBar} active={active} reduceMotion={reduceMotion} />
    </Scene>
  );
}

export interface StepDemoProps extends SceneProps {
  step: OnboardingStepId;
}

/** The miniature screen for one step. */
export function StepDemo({ step, copy, active, reduceMotion }: StepDemoProps) {
  switch (step) {
    case 'browse':
      return <BrowseScene copy={copy} active={active} reduceMotion={reduceMotion} />;
    case 'photos':
      return <PhotosScene copy={copy} active={active} reduceMotion={reduceMotion} />;
    case 'variants':
      return <VariantsScene copy={copy} active={active} reduceMotion={reduceMotion} />;
    case 'cart':
      return <CartScene copy={copy} active={active} reduceMotion={reduceMotion} />;
    case 'order':
      return <OrderScene copy={copy} active={active} reduceMotion={reduceMotion} />;
  }
}

const styles = StyleSheet.create({
  scene: {
    height: SCENE_HEIGHT,
    alignSelf: 'stretch',
    borderRadius: theme.radii.card,
    backgroundColor: theme.brand.onSolid,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    height: 30,
    paddingHorizontal: theme.spacing[3],
    borderRadius: 999,
    backgroundColor: theme.brand.soft,
  },
  searchDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.brand.muted },
  searchText: { ...theme.text.caption, color: theme.colors.mutedForeground },
  chipRow: { flexDirection: 'row', gap: theme.spacing[2] },
  chip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.brand.soft,
  },
  chipActive: { backgroundColor: theme.colors.accentSurfaceDeep },
  chipText: { ...theme.text.micro, color: theme.colors.mutedForeground },
  chipTextActive: { color: theme.colors.foreground },
  cardRow: { flexDirection: 'row', gap: theme.spacing[2], flex: 1 },
  card: {
    flex: 1,
    borderRadius: theme.radii.input,
    backgroundColor: theme.brand.onSolid,
    borderWidth: 1,
    borderColor: theme.brand.soft,
    padding: theme.spacing[2],
    gap: 3,
  },
  cardGhost: {
    flex: 1,
    borderRadius: theme.radii.input,
    backgroundColor: theme.brand.soft,
  },
  cardImage: {
    height: 52,
    borderRadius: theme.radii.input / 1.6,
    backgroundColor: theme.colors.iconSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tee: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.brand.primary,
  },
  teeAlt: { borderColor: theme.brand.violet },
  cardName: { ...theme.text.micro, color: theme.colors.foreground },
  cardPrice: { ...theme.text.bodyStrong, color: theme.colors.foreground },
  swatchRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.brand.muted,
  },
  swatchLarge: { width: 22, height: 22, borderRadius: 11 },
  swatchChosen: { borderWidth: 2, borderColor: theme.brand.primary },
  sceneLabel: { ...theme.text.micro, color: theme.colors.mutedForeground },
  sizeRow: { flexDirection: 'row', gap: theme.spacing[2] },
  sizeChip: {
    minWidth: 34,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: theme.radii.input,
    borderWidth: 1,
    borderColor: theme.brand.muted,
  },
  sizeChipActive: { backgroundColor: theme.brand.primary, borderColor: theme.brand.primary },
  sizeText: { ...theme.text.caption, color: theme.colors.foreground },
  sizeTextActive: { color: theme.brand.onSolid },
  photoFrame: {
    flex: 1,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.iconSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoStrip: { flexDirection: 'row', gap: theme.spacing[3], alignItems: 'center' },
  photo: {
    width: 74,
    height: 90,
    borderRadius: theme.radii.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFirst: { backgroundColor: theme.brand.onSolid },
  photoSecond: { backgroundColor: theme.colors.accentSurface },
  photoDots: { position: 'absolute', bottom: 8, flexDirection: 'row', gap: 4 },
  photoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.brand.muted },
  photoDotActive: { width: 12, backgroundColor: theme.brand.primary },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    height: 40,
    borderRadius: 999,
    backgroundColor: theme.brand.primary,
  },
  cartBarText: { ...theme.text.subheading, color: theme.brand.onSolid },
  cartBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: theme.brand.onSolid,
  },
  cartBadgeText: {
    ...theme.text.micro,
    color: theme.brand.primary,
    fontWeight: theme.fontWeights.bold,
  },
  sheet: {
    flex: 1,
    borderRadius: theme.radii.input,
    backgroundColor: theme.brand.soft,
    padding: theme.spacing[2],
    gap: theme.spacing[2],
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  sheetRowCod: {
    backgroundColor: theme.colors.accentSurface,
    borderRadius: theme.radii.input / 1.6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
  },
  sheetLabel: { ...theme.text.micro, color: theme.colors.mutedForeground, width: 56 },
  sheetLine: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.brand.muted },
  sheetValue: { ...theme.text.caption, color: theme.colors.foreground },
  radioOn: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: theme.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.brand.primary },
  tapWrap: {
    position: 'absolute',
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.brand.violet,
    borderWidth: 2,
    borderColor: theme.brand.onSolid,
  },
  tapRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.brand.violet,
  },
  tapOnFirstChip: { top: 44, left: 30 },
  tapOnPhoto: { top: 74, left: 128 },
  tapOnSize: { top: 108, left: 66 },
  tapOnCartBar: { bottom: 18, right: 46 },
});
