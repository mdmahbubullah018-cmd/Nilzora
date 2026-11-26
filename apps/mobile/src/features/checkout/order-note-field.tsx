import { StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/theme';
import { MAX_NOTE_LENGTH } from './order-failure';

export interface OrderNoteFieldProps {
  value: string;
  onChangeText: (next: string) => void;
  error?: string;
  editable: boolean;
}

/**
 * The optional note for the order (for example, a good time to call), up to 500 characters
 * with a running count. The count is visible only: announcing it on every keystroke would
 * drown the typing.
 */
export function OrderNoteField({ value, onChangeText, error, editable }: OrderNoteFieldProps) {
  return (
    <View style={styles.field}>
      {/* Hidden from screen readers: the input itself announces the label. */}
      <Text aria-hidden style={styles.label}>
        Note for the order <Text style={styles.optional}>(optional)</Text>
      </Text>
      <TextInput
        accessibilityLabel="Note for the order"
        accessibilityHint={error ?? 'Optional. For example, a good time to call.'}
        accessibilityState={{ disabled: !editable }}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline
        numberOfLines={3}
        maxLength={MAX_NOTE_LENGTH}
        textAlignVertical="top"
        placeholder="For example, a good time to call"
        placeholderTextColor={theme.colors.mutedForeground}
        style={[styles.input, error ? styles.inputError : null]}
      />
      <View style={styles.footer}>
        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : (
          <View />
        )}
        <Text
          accessibilityLabel={`${value.length} of ${MAX_NOTE_LENGTH} characters used`}
          style={styles.counter}
        >
          {value.length}/{MAX_NOTE_LENGTH}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.spacing[1] + 2 },
  label: { color: theme.colors.foreground, fontSize: 14, fontWeight: theme.fontWeights.medium },
  optional: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeights.regular },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: 16,
  },
  inputError: { borderColor: theme.colors.fieldError, borderWidth: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing[3] },
  error: { flex: 1, color: theme.colors.fieldError, fontSize: 13, lineHeight: 18 },
  counter: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
