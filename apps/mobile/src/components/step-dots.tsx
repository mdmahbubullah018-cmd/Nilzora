import { StyleSheet, View } from 'react-native';
import { theme } from '@/theme';

export interface StepDotsProps {
  count: number;
  activeIndex: number;
  /** What the dots belong to, for the screen reader ("Onboarding page"). */
  label: string;
}

/**
 * A page indicator. It is one accessible element ("Onboarding page, 2 of 3") rather than an
 * unlabelled row of shapes, and the active dot is wider as well as darker, so the state is
 * not conveyed by colour alone.
 */
export function StepDots({ count, activeIndex, label }: StepDotsProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: count, now: activeIndex + 1 }}
      style={styles.row}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.dot, index === activeIndex ? styles.dotActive : null]} />
      ))}
    </View>
  );
}

/** The dots' height, so a row beside them can align. */
const STEP_DOTS_HEIGHT = 8;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, height: STEP_DOTS_HEIGHT },
  dot: {
    width: STEP_DOTS_HEIGHT,
    height: STEP_DOTS_HEIGHT,
    borderRadius: STEP_DOTS_HEIGHT / 2,
    backgroundColor: theme.colors.border,
  },
  dotActive: { width: 24, backgroundColor: theme.colors.primaryAction },
});
