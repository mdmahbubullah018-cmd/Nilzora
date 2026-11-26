import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { theme } from '@/theme';

/*
 * The pale blue wash behind the account and sign-in headers.
 *
 * A real gradient rather than a stack of translucent discs: a disc leaves a visible edge on a
 * surface this light, while a gradient has none at any size. It runs from near-white at the top
 * left to the soft blue the cards use at the bottom right, so the header reads as one lit
 * surface — the light counterpart of the navy panels the store used to open its account pages
 * with. It is purely decorative and cannot take a touch.
 */
export interface SoftWashProps {
  /** Extra style for the layer, e.g. a radius that differs from the parent's. */
  style?: ViewStyle;
}

export function SoftWash({ style }: SoftWashProps) {
  // Each instance needs its own gradient id: two SVGs sharing one can pick up the other's stops
  // on some renderers. React's ids contain colons, which are not valid inside url().
  const gradientId = `soft-wash-${useId().replaceAll(':', '')}`;
  const stops: readonly (readonly [number, string])[] = [
    [0, theme.colors.surface],
    [0.55, theme.colors.accentSurface],
    [1, theme.colors.accentSurfaceDeep],
  ];
  return (
    <View pointerEvents="none" style={[styles.wash, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {stops.map(([offset, color]) => (
              <Stop key={offset} offset={offset} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
