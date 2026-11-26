import type { OrderDetail, ReviewStatus } from '@nilzora/contracts';
import { CheckCircle2 } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { CartLineThumb } from '@/features/cart/cart-line-thumb';
import { useMyReview } from '@/features/reviews/review-hooks';
import { ReviewSheet } from '@/features/reviews/review-sheet';
import { theme } from '@/theme';
import { SectionCard } from './order-sections';

/*
 * "Review your items" on a delivered order
 * ----------------------------------------
 * One row per product the order delivered. Whether a product can be reviewed, and whether it
 * already was, is the server's answer for this account (`/me/products/:id/review`), read per
 * product: the row offers "Write a review" only when the server says the customer may, and shows
 * the saved review's state otherwise. Nothing is offered on an order that is not delivered.
 */

const REVIEW_STATE: Readonly<Record<ReviewStatus, string>> = {
  pending: 'Reviewed · being checked',
  approved: 'Reviewed · published',
  rejected: 'Reviewed · not published',
};

type Line = OrderDetail['items'][number];

export function OrderReviewsCard({ order }: { order: OrderDetail }) {
  const [writing, setWriting] = useState<Line | null>(null);
  if (order.status !== 'delivered') return null;
  // One row per product, even when the order held several variants of it: a review is per product.
  const seen = new Set<string>();
  const lines = order.items.filter((item) => {
    if (seen.has(item.productId)) return false;
    seen.add(item.productId);
    return true;
  });
  return (
    <SectionCard title="Review your items">
      <View style={styles.list}>
        {lines.map((line) => (
          <ReviewRow key={line.productId} line={line} onWrite={() => setWriting(line)} />
        ))}
      </View>
      <ReviewSheet product={writing} onClose={() => setWriting(null)} />
    </SectionCard>
  );
}

function ReviewRow({ line, onWrite }: { line: Line; onWrite: () => void }) {
  const mine = useMyReview(line.productId);
  const review = mine.data?.review ?? null;
  return (
    <View style={styles.row} testID={`review-row-${line.productId}`}>
      <CartLineThumb image={line.image} size={48} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {line.productName}
        </Text>
        {line.variantLabel === null ? null : (
          <Text style={styles.variant} numberOfLines={1}>
            {line.variantLabel}
          </Text>
        )}
        {review !== null ? (
          <View style={styles.done}>
            <CheckCircle2 size={14} color={theme.colors.success} />
            <Text style={styles.doneText}>{REVIEW_STATE[review.status]}</Text>
          </View>
        ) : null}
      </View>
      {review === null && mine.data?.eligible === true ? (
        <Button
          label="Write a review"
          variant="secondary"
          accessibilityHint={`Opens a form to review ${line.productName}`}
          onPress={onWrite}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: theme.spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...theme.text.body, color: theme.colors.foreground },
  variant: { ...theme.text.caption, color: theme.colors.mutedForeground },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  doneText: { ...theme.text.caption, color: theme.colors.mutedForeground },
});
