import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CHAT_QUICK_QUESTIONS } from '@nilzora/contracts';
import { theme } from '@/theme';

/*
 * The questions customers ask most, one tap away.
 *
 * The list itself comes from the shared contract, so the app and the website offer the same
 * options in the same words. A chip only *writes* the question into the message box; it never
 * sends it, so a tap cannot post a message the customer did not read first.
 */

export const QUICK_QUESTIONS: readonly { label: string; question: string }[] = CHAT_QUICK_QUESTIONS;

export function QuickQuestions({
  onPick,
  disabled = false,
}: {
  /** Writes the question into the composer. It is never sent from here. */
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>Common questions, tap to put it in the box</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {QUICK_QUESTIONS.map((entry) => (
          <Pressable
            key={entry.label}
            accessibilityRole="button"
            accessibilityLabel={entry.label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onPick(entry.question)}
            style={({ pressed }) => [
              styles.chip,
              disabled ? styles.disabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.chipText}>{entry.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[1] },
  hint: { color: theme.colors.mutedForeground, fontSize: 11 },
  row: { flexDirection: 'row', gap: theme.spacing[2], paddingVertical: 2 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[3],
  },
  chipText: { color: theme.colors.foreground, fontSize: 12, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
