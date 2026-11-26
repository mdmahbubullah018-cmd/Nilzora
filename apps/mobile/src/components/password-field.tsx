import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { theme } from '@/theme';
import { AppIcon } from './icon';
import { TextField, type TextFieldProps } from './text-field';

export type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'rightAccessory'>;

/**
 * A password field with a show/hide control. It is a plain <TextField> underneath, so
 * autofill, content types, validation and errors behave exactly as they do elsewhere; the
 * toggle only flips `secureTextEntry` and announces the new state.
 */
export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? 'Hide password' : 'Show password';

  return (
    <TextField
      {...props}
      secureTextEntry={!revealed}
      textContentType={props.textContentType ?? 'password'}
      rightAccessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: revealed }}
          hitSlop={6}
          onPress={() => {
            setRevealed((current) => !current);
          }}
          style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
        >
          <AppIcon
            name={revealed ? 'hide' : 'show'}
            size="md"
            color={theme.colors.mutedForeground}
          />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
});
