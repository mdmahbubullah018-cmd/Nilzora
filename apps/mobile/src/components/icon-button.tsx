import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: the icon alone is not a name for a screen reader. Include any count in it. */
  label: string;
  onPress: () => void;
  /** What the button does, read after the name. */
  hint?: string;
  /** Shows a count bubble in the offer colour; hidden when zero or undefined. */
  badgeCount?: number;
  /** A toggle-style control, such as the wishlist heart, reports its state. */
  selected?: boolean;
  /** Draws the icon filled (a saved heart) as well as tinted. */
  filled?: boolean;
  disabled?: boolean;
  /** Draws the shared glass surface behind the icon. */
  glass?: boolean;
  /**
   * A smaller visible control (36dp with a 20dp glyph) for a banner corner, where a full 48dp
   * button would compete with the artwork. The touch target is kept at 44dp with hit slop.
   */
  compact?: boolean;
  /**
   * Where the button sits. `surface` (the default) is a light bar or card. `onMedia` is a
   * photograph — a category or brand banner — where the surface becomes a navy wash with a
   * white icon, so it stays legible over a pale picture as well as a dark one.
   */
  tone?: 'surface' | 'onMedia';
}

/**
 * A square, 48dp icon control. Mobile has no hover, so the pressed state carries the feedback:
 * the icon turns primary and the target shrinks very slightly.
 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  hint,
  badgeCount,
  selected,
  filled = false,
  disabled = false,
  glass = false,
  compact = false,
  tone = 'surface',
}: IconButtonProps) {
  const showBadge = badgeCount !== undefined && badgeCount > 0;
  const onMedia = tone === 'onMedia';
  const color = onMedia
    ? theme.brand.onSolid
    : selected
      ? theme.colors.primaryAction
      : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        glass && !onMedia ? styles.glass : null,
        onMedia ? styles.media : null,
        pressed && !disabled ? (onMedia ? styles.mediaPressed : styles.pressed) : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {({ pressed }) => (
        <>
          <Icon
            size={compact ? theme.icon.size.md : theme.icon.size.lg}
            color={onMedia ? theme.brand.onSolid : pressed ? theme.colors.primaryAction : color}
            strokeWidth={
              onMedia
                ? theme.icon.stroke.idle
                : selected
                  ? theme.icon.stroke.active
                  : theme.icon.stroke.idle
            }
            fill={filled ? (pressed ? theme.colors.primaryAction : color) : 'none'}
          />
          {showBadge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {badgeCount > 99 ? '99+' : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  /** A banner corner: smaller on screen, still a comfortable target thanks to the hit slop. */
  buttonCompact: { width: 36, height: 36 },
  glass: {
    backgroundColor: theme.glass.surface,
    borderWidth: 1,
    borderColor: theme.glass.border,
  },
  /*
   * Over a photograph: the glyph alone. No wash, no ring and no shadow box — a soft dark halo
   * from `filter: dropShadow` is what keeps a white icon readable on a pale banner and a dark
   * one alike, which is the only thing a container was buying.
   */
  media: {
    filter: [
      {
        dropShadow: {
          color: 'rgba(15, 23, 42, 0.85)',
          // A 2dp blur: enough of a halo over a pale banner, invisible over a dark one.
          standardDeviation: 2,
          offsetX: 0,
          offsetY: 1,
        },
      },
    ],
  },
  mediaPressed: { transform: [{ scale: 0.94 }], opacity: 0.7 },
  pressed: { transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.5 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: theme.radii.full,
    // offerBadge (#E11D48), not the brighter brand.offer: 4.7:1 for white text.
    backgroundColor: theme.colors.offerBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: theme.colors.offerBadgeForeground,
    ...theme.text.micro,
    fontSize: 10,
    fontWeight: theme.fontWeights.semibold,
  },
});
