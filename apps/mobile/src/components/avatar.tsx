import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

const SIZES = { sm: 40, md: 56, lg: 64, xl: 96 } as const;

export type AvatarSize = keyof typeof SIZES;

/** Up to two initials from a name, for the placeholder avatar. */
export function initialsOf(name: string): string {
  const letters = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '');
  return letters.join('') || 'N';
}

/**
 * The generated-avatar tones for a light surface. An account always gets the same one, so a
 * customer is not a different colour on every screen, and the text stays above 4.5:1.
 */
const LIGHT_TONES = [
  { background: 'rgba(2, 132, 199, 0.12)', border: 'rgba(2, 132, 199, 0.3)', text: '#0369A1' },
  { background: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', text: '#6D28D9' },
  { background: 'rgba(34, 197, 94, 0.14)', border: 'rgba(34, 197, 94, 0.32)', text: '#15803D' },
  { background: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.34)', text: '#B45309' },
  { background: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.34)', text: '#0369A1' },
  { background: 'rgba(51, 65, 85, 0.12)', border: 'rgba(51, 65, 85, 0.28)', text: '#334155' },
] as const;

/** The tone for one account: the same seed always picks the same colour. */
export function avatarTone(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return LIGHT_TONES[hash % LIGHT_TONES.length] ?? LIGHT_TONES[0];
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  /** `navy` for the dark profile header, `light` for white surfaces. */
  tone?: 'navy' | 'light';
  /** The customer's picture (the API's thumbnail address); initials show without one. */
  pictureUrl?: string | null;
  /** The account the initials' colour comes from; the name is used when it is left out. */
  seed?: string | undefined;
}

/**
 * The customer's picture, or their initials in a disc when there is none or it cannot load.
 * Decorative: the name is always shown as text beside it, so a screen reader would only repeat
 * itself if this were announced.
 */
export function Avatar({
  name,
  size = 'md',
  tone = 'light',
  pictureUrl = null,
  seed,
}: AvatarProps) {
  const diameter = SIZES[size];
  // Remembers which address failed, so a new picture gets its own chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPicture = pictureUrl !== null && pictureUrl !== failedUrl;
  const generated = avatarTone(seed ?? name);
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[
        styles.disc,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
        },
        tone === 'navy'
          ? styles.navy
          : { backgroundColor: generated.background, borderColor: generated.border },
        tone === 'navy' ? null : styles.light,
      ]}
    >
      {showPicture ? (
        <Image
          testID="avatar-picture"
          source={{ uri: pictureUrl }}
          accessibilityIgnoresInvertColors
          onError={() => setFailedUrl(pictureUrl)}
          style={{ width: diameter, height: diameter, borderRadius: diameter / 2 }}
        />
      ) : (
        <Text
          style={[
            styles.initials,
            { fontSize: Math.round(diameter * 0.34) },
            tone === 'navy' ? styles.initialsNavy : { color: generated.text },
          ]}
        >
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  navy: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  light: {
    borderWidth: 1,
  },
  initials: { fontWeight: theme.fontWeights.semibold },
  initialsNavy: { color: theme.colors.sky },
});
