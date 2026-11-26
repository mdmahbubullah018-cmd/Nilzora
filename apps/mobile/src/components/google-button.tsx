import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/theme';

/*
 * "Continue with Google"
 * ----------------------
 * Google's sign-in branding has rules that matter more than the app's own palette: the mark
 * keeps its four colours on a white surface and is never recoloured to the brand. So the tile
 * below draws Google's own four-colour "G" as vector paths (nothing is downloaded, and there is
 * no image to blur or crop) next to a neutral label, and only the shape of the button — radius,
 * height, spacing — comes from Nilzora's design system.
 *
 * The provider itself is untouched: this is the same `signInWithGoogle()` the plain button used,
 * so the OAuth exchange, callback and session handling are exactly as before.
 */

const GOOGLE_BLUE = '#4285F4';
const GOOGLE_GREEN = '#34A853';
const GOOGLE_YELLOW = '#FBBC05';
const GOOGLE_RED = '#EA4335';

/** The four-colour Google "G", drawn at `size` square. */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
      <Path
        fill={GOOGLE_RED}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <Path
        fill={GOOGLE_BLUE}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <Path
        fill={GOOGLE_YELLOW}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"
      />
      <Path
        fill={GOOGLE_GREEN}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </Svg>
  );
}

export interface GoogleButtonProps {
  onPress: () => void;
  /** "Continue with Google" on the screens both ways in; "Sign up with Google" beside a form. */
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

/**
 * The Google sign-in control: a white surface with Google's own mark, a hairline border so it
 * reads as a button on the app's soft background, and the same 52dp height as the primary action.
 */
export function GoogleButton({
  onPress,
  label = 'Continue with Google',
  loading = false,
  disabled = false,
  accessibilityHint = 'Signs you in with your Google account',
}: GoogleButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !inactive ? styles.pressed : null,
        disabled && !loading ? styles.disabled : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
        ) : (
          <GoogleMark size={20} />
        )}
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: theme.spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.surface,
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  label: {
    ...theme.text.subheading,
    letterSpacing: 0.1,
    color: theme.colors.foreground,
  },
});
