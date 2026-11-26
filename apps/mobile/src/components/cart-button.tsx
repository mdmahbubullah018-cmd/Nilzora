import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cartBadgeLabel } from '@/cart/cart-badge';
import { useCart } from '@/cart/cart-context';
import { theme } from '@/theme';
import { AppIcon } from './icon';

export interface CartButtonProps {
  /** The icon colour. A screen header uses the brand's primary. */
  color?: string;
}

/**
 * The cart shortcut in a screen header: a plain outline cart with the number of units as a
 * small pill on its corner. No tile, no tint behind it — the number is the only emphasis,
 * which keeps it in the same visual family as the tab bar's own cart.
 *
 * The spoken name carries the unit count, so a screen reader hears what the pill shows.
 */
export function CartButton({ color = theme.colors.primary }: CartButtonProps) {
  const router = useRouter();
  const { count } = useCart();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cartBadgeLabel(count)}
      accessibilityHint="Opens your cart"
      hitSlop={6}
      onPress={() => {
        router.navigate('/cart');
      }}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      {({ pressed }) => (
        <>
          <AppIcon
            name="cart"
            size="xl"
            color={pressed ? theme.colors.primaryActionHover : color}
            active={pressed}
          />
          {count > 0 ? (
            <View accessibilityElementsHidden style={styles.pill}>
              <Text style={styles.pillText} numberOfLines={1}>
                {count > 99 ? '99+' : String(count)}
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
  },
  pressed: { opacity: 0.7 },
  pill: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: theme.radii.full,
    // offerBadge (#E11D48) keeps white text at 4.7:1, the same pill the tab bar uses.
    backgroundColor: theme.colors.offerBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    color: theme.colors.offerBadgeForeground,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: theme.fontWeights.semibold,
  },
});
