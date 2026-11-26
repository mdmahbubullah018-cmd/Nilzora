import type { ChatConversationDetail } from '@nilzora/contracts';
import { Star, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { usePendingReviews } from '@/features/reviews/review-hooks';
import { ReviewSheet } from '@/features/reviews/review-sheet';
import { theme } from '@/theme';

/*
 * A review invitation inside a support conversation
 * -------------------------------------------------
 * Only in a thread about one of the customer's own orders, only once that order is delivered,
 * and only for a product of that order the server lists as still unreviewed for this account
 * (`/me/reviews/pending`). A thread about a product narrows it to that product. Nothing here
 * decides eligibility; it never appears in a thread about anything else.
 */
export function ChatReviewCard({ detail }: { detail: ChatConversationDetail | undefined }) {
  const order = detail?.order ?? null;
  const delivered = order !== null && order.status === 'delivered';
  const pending = usePendingReviews(delivered);
  const [hidden, setHidden] = useState(false);
  const [writing, setWriting] = useState(false);
  if (!delivered || hidden) return null;
  const productId = detail?.product?.id ?? null;
  const item =
    pending.data?.items.find(
      (candidate) =>
        candidate.orderNumber === order.number &&
        (productId === null || candidate.productId === productId),
    ) ?? null;
  if (item === null) return null;

  return (
    <View style={styles.card} testID="chat-review-card">
      <Star size={16} color={theme.colors.warning} fill={theme.colors.warning} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          How was {item.productName}?
        </Text>
        <Text style={styles.meta}>Order {item.orderNumber} was delivered.</Text>
      </View>
      <Button label="Review" variant="secondary" onPress={() => setWriting(true)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide the review invitation"
        hitSlop={8}
        onPress={() => setHidden(true)}
        style={styles.close}
      >
        <X size={16} color={theme.colors.mutedForeground} />
      </Pressable>
      <ReviewSheet product={writing ? item : null} onClose={() => setWriting(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  text: { flex: 1, minWidth: 0 },
  title: { ...theme.text.caption, color: theme.colors.foreground, fontWeight: '600' },
  meta: { ...theme.text.micro, color: theme.colors.mutedForeground },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
