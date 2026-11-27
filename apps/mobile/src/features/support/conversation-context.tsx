import type { ChatConversationDetail } from '@nilzora/contracts';
import { ChevronRight, Package } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProductVisual } from '@/features/catalog/product-visual';
import { theme } from '@/theme';

/*
 * What the open conversation is about, pinned under the header so it stays visible while the
 * customer scrolls the messages. One short row: the picture, the name, the variant that was
 * bought and the order it came from. It reads only the conversation that is open, so opening
 * another thread replaces it in the same frame instead of leaving stale context behind.
 */

export interface ConversationContextProps {
  detail: ChatConversationDetail | undefined;
}

/** The product and order a thread is about, or nothing at all when it is about neither. */
export function ConversationContext({ detail }: ConversationContextProps) {
  const router = useRouter();
  if (detail === undefined) return null;
  const { order, product } = detail;
  if (order === null && product === null) return null;

  const lines = order?.items ?? [];
  const [firstLine] = lines;
  const name = product?.name ?? firstLine?.name ?? `Order ${order?.number ?? ''}`;
  const variantLabel = product ? product.variantLabel : (firstLine?.variantLabel ?? null);
  const image = product ? product.image : (firstLine?.image ?? null);
  const secondLine = product === null ? lines[1] : null;
  const caption =
    order !== null
      ? [variantLabel, `Order ${order.number}`].filter((part) => part !== null).join(' · ')
      : (variantLabel ?? `${String(lines.length)} item${lines.length === 1 ? '' : 's'}`);

  const open = () => {
    if (product !== null) {
      router.push(`/product/${product.slug}`);
      return;
    }
    if (order !== null) router.push(`/order/${order.number}`);
  };
  const canOpen = product !== null || order !== null;

  return (
    <Pressable
      accessible
      accessibilityRole={canOpen ? 'button' : 'text'}
      accessibilityLabel={`About ${name}${caption === '' ? '' : `, ${caption}`}`}
      accessibilityHint={canOpen ? 'Opens what this conversation is about' : undefined}
      disabled={!canOpen}
      onPress={open}
      style={({ pressed }) => [styles.row, pressed && canOpen ? styles.pressed : null]}
    >
      <ProductVisual
        size="tile"
        imageUri={image?.thumbUrl ?? null}
        style={styles.thumb}
        categorySlug={null}
      />
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <View style={styles.captionRow}>
          <Package size={11} color={theme.colors.mutedForeground} accessible={false} />
          <Text numberOfLines={1} style={styles.caption}>
            {caption}
          </Text>
        </View>
      </View>
      {secondLine?.image ? (
        <ProductVisual size="tile" imageUri={secondLine.image.thumbUrl} style={styles.extraThumb} />
      ) : null}
      {canOpen ? (
        <ChevronRight size={16} color={theme.colors.mutedForeground} accessible={false} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 52,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 36, height: 36, borderRadius: theme.radii.sm },
  extraThumb: { width: 28, height: 28, borderRadius: theme.radii.sm },
  text: { flex: 1, minWidth: 0, gap: 1 },
  name: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  caption: { flex: 1, color: theme.colors.mutedForeground, fontSize: 11 },
});
