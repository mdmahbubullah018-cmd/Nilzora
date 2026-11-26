import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { AppIcon, type IconName } from './icon';
import { useReduceMotion } from './use-reduce-motion';
import { useReduceTransparency } from './use-reduce-transparency';

/** Extra bottom padding a tab screen needs, so its last row clears the floating dock. */
export const TAB_BAR_SPACE = 74;

export interface TabBarItem {
  key: string;
  label: string;
  icon: IconName;
  /** Drawn when the tab is the current one (a filled heart, for example). */
  activeIcon?: IconName;
  /** A count bubble in the offer colour; hidden when zero or undefined. */
  badgeCount?: number;
  /** The spoken name while a badge shows; defaults to "<label>, <count> saved". */
  badgeLabel?: string;
}

export interface TabBarProps {
  items: readonly TabBarItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

/**
 * One tab. The current tab is marked the way the shop marks it everywhere else: the brand tint
 * on the glyph and its label, and one weight heavier on the label. The icon stays an outline in
 * both states — the tint is the signal, not a filled shape — so the bar keeps a single visual
 * weight and reads as quiet navigation over the page rather than a row of buttons.
 *
 * The only motion is a small press response on the glyph itself, skipped entirely when the
 * device asks for reduced motion.
 */
function TabItem({
  item,
  focused,
  reduceMotion,
  onPress,
}: {
  item: TabBarItem;
  focused: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const showBadge = item.badgeCount !== undefined && item.badgeCount > 0;
  const badgeCount = item.badgeCount ?? 0;
  const color = focused ? theme.colors.primaryAction : theme.glass.mutedForeground;
  // A quick, soft press response on every tab (including the current one): dip, then spring back.
  const tap = useState(() => new Animated.Value(1))[0];
  const press = (to: number) => {
    if (reduceMotion) return;
    Animated.spring(tap, {
      toValue: to,
      speed: 40,
      bounciness: to === 1 ? 10 : 0,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={
        showBadge ? (item.badgeLabel ?? `${item.label}, ${badgeCount} saved`) : item.label
      }
      onPress={onPress}
      onPressIn={() => {
        press(0.95);
      }}
      onPressOut={() => {
        press(1);
      }}
      style={({ pressed }) => [styles.item, pressed && !focused ? styles.itemPressed : null]}
    >
      <Animated.View style={[styles.itemInner, { transform: [{ scale: tap }] }]}>
        <View style={[styles.iconWrap, focused ? styles.iconWrapActive : null]}>
          <AppIcon
            name={focused && item.activeIcon !== undefined ? item.activeIcon : item.icon}
            size="md"
            color={color}
            active={focused}
          />
          {showBadge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {badgeCount > 99 ? '99+' : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.label, { color }, focused ? styles.labelActive : null]}
        >
          {item.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The floating dock: a slim rounded slab inset from both edges and lifted off the bottom, so the
 * page stays visible around it and the bar reads as a control over the content rather than a strip
 * attached to it. The surface is white glass with a hairline light edge and one soft shadow —
 * separation without a heavy card — and inside it only the current tab's glyph carries a tint,
 * with a heavier label weight. Every other tab is bare, so the bar stays quiet until it is read.
 *
 * The material is the "regular" glass variant from the Apple HIG: enough translucency that the
 * page shows through, enough fill that the icons and labels stay legible over any content. It is
 * dropped for an opaque surface when the device asks for reduced transparency, and the two small
 * animations are skipped when it asks for reduced motion.
 *
 * Deliberately free of router types: the layout maps its own navigation state onto `items`
 * and `onSelect`, which keeps this component testable in isolation.
 */
export function TabBar({ items, activeIndex, onSelect }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const reduceTransparency = useReduceTransparency();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, theme.spacing[2]) }]}
    >
      <View
        accessibilityRole="tablist"
        testID="tab-bar-surface"
        style={[styles.bar, reduceTransparency ? styles.barOpaque : null]}
      >
        {items.map((item, index) => (
          <TabItem
            key={item.key}
            item={item}
            focused={index === activeIndex}
            reduceMotion={reduceMotion}
            onPress={() => {
              onSelect(index);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Narrower than the screen and centred, so the dock reads as a floating control rather than
  // a full-width strip; the padding keeps it clear of the edges on every phone.
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: theme.spacing[4],
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 380,
    // Glass, without a dependency: a light translucent fill, a hairline of white at the edge
    // and the brand's floating shadow. Content underneath stays faintly visible.
    backgroundColor: theme.glass.tabBar,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.border,
    borderRadius: 20,
    padding: 4,
    gap: 2,
    ...theme.shadow.floating,
  },
  /** Reduced transparency: the same shape, filled solid, so nothing shows through the labels. */
  barOpaque: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  item: { flex: 1, minHeight: 44, borderRadius: 16 },
  itemPressed: { opacity: 0.72 },
  itemInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
    borderRadius: 16,
  },
  iconWrap: {
    width: 32,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  /** The one tinted shape in the bar, and only while its tab is the current one. */
  iconWrapActive: { backgroundColor: theme.glass.activePill },
  label: { ...theme.text.micro, fontSize: 10.5, lineHeight: 13, letterSpacing: 0.1 },
  labelActive: { fontWeight: theme.fontWeights.semibold },
  badge: {
    position: 'absolute',
    top: -5,
    right: -2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: theme.radii.full,
    // offerBadge (#E11D48), not the brighter brand.offer: 4.7:1 for white text.
    backgroundColor: theme.colors.offerBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: theme.colors.offerBadgeForeground,
    fontSize: 10,
    fontWeight: theme.fontWeights.semibold,
  },
});
