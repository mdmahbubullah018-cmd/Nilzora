import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/**
 * The round back control on its own, for a screen that puts something else beside it (the
 * Search screen puts the search field there). `ScreenHeader` wraps this with a title.
 */
export function BackButton({
  onPress,
  label = 'Go back',
}: {
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      android_ripple={{ color: 'rgba(2, 132, 199, 0.14)', borderless: true }}
      style={({ pressed }) => [styles.back, pressed ? styles.backPressed : null]}
    >
      <ChevronLeft size={24} color={theme.colors.link} strokeWidth={2} accessible={false} />
    </Pressable>
  );
}

/**
 * The back control and title for a screen that has no navigation bar of its own.
 *
 * Stack screens get this from the native header (back + title, see app/_layout.tsx). The tab
 * screens sit outside that navigator, so a tab that still needs a way back — the wishlist,
 * which is reached both from the bar and from an account shortcut — draws the same pair here:
 * a 44dp round control on the left holding the same chevron, and the screen's name beside it.
 *
 * `onBack` is the caller's business: a screen with history pops it, and one opened directly
 * (a deep link to the tab) falls back to a route that exists.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  /** An optional control at the far end of the row. */
  right?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <BackButton onPress={onBack} />
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {right === undefined ? null : <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: theme.touchTarget,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    // Negative inset so the 44dp target lines its glyph up with the title's left edge.
    marginLeft: -theme.spacing[2],
  },
  backPressed: { backgroundColor: theme.colors.surfaceMuted },
  title: { flex: 1, color: theme.colors.foreground, ...theme.text.title },
  right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
});
