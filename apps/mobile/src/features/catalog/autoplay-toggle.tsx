import { Pause, Play } from 'lucide-react-native';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { theme } from '@/theme';

/** The smallest touch target for the control (dp). */
export const AUTOPLAY_TOGGLE_SIZE = 44;

/**
 * Pause / Play for an auto-advancing carousel (WCAG 2.2.2 Pause, Stop, Hide).
 *
 * A full 44 x 44 dp touch target with a smaller round badge drawn inside it, laid over the top
 * right corner of the banner, where the artwork carries no words. The label always says what a
 * press will do ("Pause collection slideshow" / "Play collection slideshow") and a press is
 * announced, because a screen reader does not re-read a label that changed under it.
 */
export function AutoplayToggle({
  paused,
  onToggle,
  subject,
  testID,
}: {
  paused: boolean;
  onToggle: () => void;
  /** What is being paused, in lower case: "collection slideshow". */
  subject: string;
  testID: string;
}) {
  const label = `${paused ? 'Play' : 'Pause'} ${subject}`;
  const Icon = paused ? Play : Pause;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        onToggle();
        // The state after this press: the opposite of what is showing now.
        AccessibilityInfo.announceForAccessibility(
          paused ? `Playing ${subject}` : `Paused ${subject}`,
        );
      }}
      style={styles.target}
      testID={testID}
    >
      {({ pressed }) => (
        // Transparent: the banner shows through. Legibility comes from pairing light and dark
        // instead of a filled disc — a white hairline ring inside a faint navy one, and a white
        // glyph over a soft navy halo — so one of the two always contrasts with the picture,
        // whether the artwork behind the corner is white or dark.
        <View style={[styles.badge, pressed ? styles.badgePressed : null]}>
          <View style={styles.ringLight} pointerEvents="none" />
          <View style={styles.glyph} pointerEvents="none">
            <Icon
              size={ICON}
              color={HALO}
              fill={HALO}
              strokeWidth={4.5}
              accessible={false}
              style={StyleSheet.absoluteFill}
            />
            <Icon
              size={ICON}
              color={theme.brand.onSolid}
              fill={theme.brand.onSolid}
              strokeWidth={2}
              accessible={false}
            />
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Navy at 45%: the halo that keeps the white glyph readable on a white banner. */
const HALO = 'rgba(15, 23, 42, 0.45)';
/** The glyph, two steps below the 13 the control first shipped with: a quiet detail. */
const ICON = 10;

const styles = StyleSheet.create({
  target: {
    position: 'absolute',
    top: 2,
    right: 2,
    zIndex: 2,
    width: AUTOPLAY_TOGGLE_SIZE,
    height: AUTOPLAY_TOGGLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    // 22dp: a detail of the artwork, not a second button. The 44dp press target around it is
    // untouched, so the control stays easy to hit on a phone.
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.28)',
  },
  // A light wash only while pressed, so the press is still felt.
  badgePressed: { backgroundColor: 'rgba(15, 23, 42, 0.3)' },
  ringLight: {
    position: 'absolute',
    top: 0.5,
    right: 0.5,
    bottom: 0.5,
    left: 0.5,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  glyph: { width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' },
});
