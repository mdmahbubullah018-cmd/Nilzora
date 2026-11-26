import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/*
 * The navy fade that keeps white type readable over a photograph, drawn as a real gradient.
 *
 * It is one SVG rectangle rather than a stack of translucent views: stacked bands leave visible
 * edges on a light picture at phone sizes, and a gradient has none at any size. The darkest stop
 * keeps white text above 4.5:1 even on a white photo, and the top of the run is fully
 * transparent, so the subject of the picture is never dimmed.
 */
const NAVY = '#0F172A';

/** [position, opacity] pairs, top to bottom of the fade, for each strength. */
export const PHOTO_SHADE_STOPS = {
  soft: [
    [0, 0],
    [0.35, 0.18],
    [0.7, 0.42],
    [1, 0.62],
  ],
  strong: [
    [0, 0],
    [0.2, 0.3],
    [0.55, 0.62],
    [1, 0.82],
  ],
  /**
   * For body text laid over ANY artwork, including a plain white one: it reaches 0.62 by 40% of
   * the way down, so white type anywhere in the lower 60% keeps 4.5:1 or better.
   */
  text: [
    [0, 0],
    [0.2, 0.3],
    [0.4, 0.62],
    [1, 0.84],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export type PhotoShadeStrength = keyof typeof PHOTO_SHADE_STOPS;

export interface PhotoShadeProps {
  /** How much of the bottom of the picture the fade covers. Defaults to the lower two thirds. */
  height?: ViewStyle['height'];
  /**
   * How hard the fade presses. `soft` suits a name and a count at the foot of a card; `strong`
   * is for a banner that carries a whole block of type over busy artwork; `text` guarantees
   * 4.5:1 for white type over any artwork, even a white one.
   */
  strength?: PhotoShadeStrength;
}

export function PhotoShade({ height = '45%', strength = 'soft' }: PhotoShadeProps) {
  // Each instance needs its own gradient id: two SVGs sharing one can pick up the other's stops
  // on some renderers. React's ids contain colons, which are not valid inside url().
  const gradientId = `photo-fade-${useId().replaceAll(':', '')}`;
  const stops = PHOTO_SHADE_STOPS[strength];
  return (
    <View pointerEvents="none" style={[styles.shade, { height }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={NAVY} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
