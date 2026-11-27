import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

export interface SectionHeaderProps {
  title: string;
  /** A small numbered badge before the title (checkout steps). Not spoken: the title is. */
  step?: number;
  /** Shows the action when given. */
  onActionPress?: () => void;
  /** Visible text of the action. Defaults to "See all". */
  actionLabel?: string;
  /** Spoken name of the action; defaults to "<actionLabel>: <title>" so it is never ambiguous. */
  actionAccessibilityLabel?: string;
}

/** A section title with an optional "See all" action (48dp target). */
export function SectionHeader({
  title,
  step,
  onActionPress,
  actionLabel = 'See all',
  actionAccessibilityLabel,
}: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.titleRow}>
        {step === undefined ? null : (
          <View
            style={styles.step}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.stepText}>{step}</Text>
          </View>
        )}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      {onActionPress ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={actionAccessibilityLabel ?? `${actionLabel}: ${title}`}
          // The label is one line tall; the slop grows the target to 48dp without adding
          // empty space between the heading and the row it names.
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          onPress={onActionPress}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
          <ChevronRight size={16} color={theme.colors.link} accessible={false} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: 24,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  step: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
  },
  stepText: { color: theme.colors.primary, fontSize: 12, fontWeight: theme.fontWeights.semibold },
  title: {
    // Grows into the row's free space: a title measured on its own comes out narrower than it
    // paints, and the tail of a longer heading ("Shop by brand") was clipped.
    flexGrow: 1,
    flexShrink: 1,
    color: theme.colors.foreground,
    ...theme.text.heading,
    fontSize: 19,
    lineHeight: 26,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: theme.spacing[3],
  },
  pressed: { opacity: 0.6 },
  actionText: {
    color: theme.colors.link,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
});
