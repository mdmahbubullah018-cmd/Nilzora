import type { ReactNode, Ref } from 'react';
import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { theme } from '@/theme';

export interface TextFieldProps extends Omit<
  TextInputProps,
  'style' | 'accessibilityLabel' | 'accessibilityHint' | 'placeholderTextColor'
> {
  label: string;
  /** Shown under the field and announced; replaces the hint while present. */
  error?: string;
  hint?: string;
  optional?: boolean;
  /** A control drawn inside the field, on the right (a password reveal toggle). */
  rightAccessory?: ReactNode;
  ref?: Ref<TextInputInstance>;
}

/**
 * Labelled text input. The input carries the label as its accessible name on both
 * platforms, and the error (or the hint) is read as the field's accessibility hint.
 *
 * The frame tracks focus itself, so the field the keyboard is in is always the one that looks
 * active — including after a validation error, where the highlight wins over the error colour
 * until the person leaves the field. Any onFocus/onBlur a screen passes still runs.
 */
export function TextField({
  label,
  error,
  hint,
  optional = false,
  editable = true,
  rightAccessory,
  ref,
  onFocus,
  onBlur,
  ...input
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const help = error ?? [hint, optional ? 'Optional.' : undefined].filter(Boolean).join(' ');
  return (
    <View style={styles.field}>
      {/* Hidden from screen readers: the input itself announces the label. */}
      <Text aria-hidden style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}> (optional)</Text> : null}
      </Text>
      <View
        style={[
          styles.inputRow,
          error && !focused ? styles.inputRowError : null,
          focused ? styles.inputRowFocused : null,
          editable ? null : styles.inputRowDisabled,
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={help || undefined}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          placeholderTextColor={theme.colors.mutedForeground}
          style={styles.input}
          {...input}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
        />
        {rightAccessory ? <View style={styles.accessory}>{rightAccessory}</View> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text aria-hidden style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.spacing[1] + 2 },
  label: { color: theme.colors.foreground, ...theme.text.bodyStrong },
  optional: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeights.regular },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.surface,
  },
  inputRowError: { borderColor: theme.colors.fieldError },
  inputRowFocused: { borderColor: theme.colors.primaryAction, borderWidth: 2 },
  inputRowDisabled: { backgroundColor: theme.colors.surfaceMuted },
  input: {
    flex: 1,
    // 48 + the 1px border either side fills the row's 52; a focused row's 2px border still
    // fits inside it, so the field does not jump when it gains focus.
    minHeight: 48,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: 16,
  },
  accessory: { paddingRight: theme.spacing[1] },
  error: { color: theme.colors.fieldError, ...theme.text.caption, lineHeight: 18 },
  hint: { color: theme.colors.mutedForeground, ...theme.text.caption, lineHeight: 18 },
});
