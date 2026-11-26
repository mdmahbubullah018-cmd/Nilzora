import { StyleSheet, View } from 'react-native';
import { theme } from '@/theme';

/**
 * The dots under or over a carousel. Decorative: a screen reader reaches every page as its own
 * control, so the dots are hidden from it. Nothing is drawn for a single page.
 */
export function PagerDots({
  count,
  page,
  testIDPrefix,
  tone = 'default',
}: {
  count: number;
  page: number;
  testIDPrefix: string;
  /** `onArtwork` draws white dots for use over a picture; the default suits a plain surface. */
  tone?: 'default' | 'onArtwork';
}) {
  if (count < 2) return null;
  const onArtwork = tone === 'onArtwork';
  return (
    <View style={styles.dots} accessible={false} importantForAccessibility="no">
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          testID={`${testIDPrefix}-${String(index)}`}
          style={[
            styles.dot,
            onArtwork ? styles.dotOnArtwork : null,
            index === page ? styles.dotActive : null,
            index === page && onArtwork ? styles.dotActiveOnArtwork : null,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // A slim native page indicator: 4dp dots on a 4dp gap, the active page a short capsule.
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong },
  dotActive: { width: 18, backgroundColor: theme.colors.primary },
  dotOnArtwork: { backgroundColor: 'rgba(255, 255, 255, 0.55)' },
  dotActiveOnArtwork: { backgroundColor: '#FFFFFF' },
});
