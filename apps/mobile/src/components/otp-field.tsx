import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputInstance,
} from 'react-native';
import { theme } from '@/theme';

export interface OtpFieldProps {
  /** The digits entered so far (0–6 characters, never anything but 0-9). */
  value: string;
  onChange: (value: string) => void;
  /** Called once when the sixth digit is in place. Never used to submit automatically. */
  onComplete?: (code: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  /** The field is read-only while its form is submitting. */
  editable?: boolean;
  /** Digits in the code: the API accepts exactly six (see emailCodeSchema). */
  length?: number;
  /** Focuses the first box as soon as the field appears. */
  autoFocus?: boolean;
}

/**
 * The six-digit code from an email, in separate boxes.
 *
 * Typing moves to the next box, backspace on an empty box returns to the previous one, and a
 * pasted or autofilled code (six digits arriving at once, as Android's one-time-code autofill
 * does) is spread across the boxes instead of being dropped. Each box is its own text field
 * with a spoken name ("Digit 3 of 6"), which is how screen readers expect a grouped code to
 * behave; the group itself carries the label and any error.
 */
export function OtpField({
  value,
  onChange,
  onComplete,
  label = 'Verification code',
  error,
  hint,
  editable = true,
  length = 6,
  autoFocus = false,
}: OtpFieldProps) {
  const inputs = useRef<(TextInputInstance | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(autoFocus ? 0 : null);
  const digits = value.slice(0, length).split('');

  function focusBox(index: number) {
    const target = Math.max(0, Math.min(length - 1, index));
    inputs.current[target]?.focus();
  }

  /** Writes `next` and reports it once, so a screen never sees the same code twice. */
  function commit(next: string) {
    const code = next.slice(0, length);
    if (code !== value) onChange(code);
    if (code.length === length && value.length < length) onComplete?.(code);
  }

  function setDigit(index: number, text: string) {
    const onlyDigits = text.replace(/\D/g, '');
    const characters = digits.slice();

    if (onlyDigits === '') {
      // Clearing a box clears everything after it, so the remaining digits never shift into
      // the wrong boxes while the customer is still typing.
      commit(characters.slice(0, index).join(''));
      return;
    }

    // A whole code arriving at once is a paste or the keyboard's autofill: fill from the
    // first box. A shorter run continues from the box being typed in.
    const start = onlyDigits.length >= length ? 0 : index;
    for (let offset = 0; offset < onlyDigits.length && start + offset < length; offset += 1) {
      characters[start + offset] = onlyDigits[offset] ?? '';
    }
    commit(characters.join('').replace(/\s/g, ''));
    focusBox(start + onlyDigits.length);
  }

  function handleKeyPress(index: number, event: NativeSyntheticEvent<{ key: string }>) {
    if (event.nativeEvent.key !== 'Backspace' || !editable) return;
    if (digits[index]) return;
    if (index === 0) return;
    commit(digits.slice(0, index - 1).join(''));
    focusBox(index - 1);
  }

  return (
    <View style={styles.field}>
      <Text aria-hidden style={styles.label}>
        {label}
      </Text>
      {/* The boxes are the accessible elements; a label here would be ignored. */}
      <View style={styles.boxes}>
        {Array.from({ length }, (_, index) => {
          const digit = digits[index] ?? '';
          const isFocused = focused === index;
          return (
            <TextInput
              key={index}
              ref={(instance) => {
                inputs.current[index] = instance;
              }}
              accessibilityLabel={`${label}, digit ${String(index + 1)} of ${String(length)}`}
              accessibilityHint={
                index === 0
                  ? [hint, 'You can paste the whole code'].filter(Boolean).join(' ')
                  : undefined
              }
              accessibilityState={{ disabled: !editable }}
              editable={editable}
              // The keyboard's one-time-code autofill fills the focused box with all six.
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              textContentType={index === 0 ? 'oneTimeCode' : 'none'}
              autoFocus={autoFocus && index === 0}
              keyboardType="number-pad"
              maxLength={length}
              value={digit}
              selectTextOnFocus
              caretHidden
              hitSlop={BOX_HIT_SLOP}
              onFocus={() => {
                setFocused(index);
              }}
              onBlur={() => {
                setFocused((current) => (current === index ? null : current));
              }}
              onChangeText={(text) => {
                setDigit(index, text);
              }}
              onKeyPress={(event) => {
                handleKeyPress(index, event);
              }}
              style={[
                styles.box,
                isFocused ? styles.boxFocused : null,
                error ? styles.boxError : null,
                editable ? null : styles.boxDisabled,
                digit !== '' ? styles.boxFilled : null,
              ]}
            />
          );
        })}
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

const BOX_HEIGHT = 56;

/**
 * The boxes sit 4 dp apart, so extending each target by 2 dp a side reaches 44 dp on the
 * narrowest supported phone without ever overlapping its neighbour.
 */
const BOX_HIT_SLOP = { top: 8, bottom: 8, left: 2, right: 2 } as const;

const styles = StyleSheet.create({
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, ...theme.text.bodyStrong },
  boxes: { flexDirection: 'row', gap: theme.spacing[1] },
  box: {
    flex: 1,
    height: BOX_HEIGHT,
    minWidth: 34,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.surface,
    color: theme.colors.foreground,
    fontSize: 22,
    fontWeight: theme.fontWeights.semibold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  boxFocused: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
    backgroundColor: theme.colors.iconSurface,
  },
  boxFilled: { borderColor: theme.colors.primary },
  boxError: { borderColor: theme.colors.fieldError, backgroundColor: theme.notice.danger.surface },
  boxDisabled: { backgroundColor: theme.colors.surfaceMuted },
  error: { color: theme.colors.fieldError, ...theme.text.caption, lineHeight: 18 },
  hint: { color: theme.colors.mutedForeground, ...theme.text.caption, lineHeight: 18 },
});
