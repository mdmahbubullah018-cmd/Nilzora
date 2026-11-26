import { Star } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CartLineThumb } from '@/features/cart/cart-line-thumb';
import { theme } from '@/theme';
import { useDismissReviewPrompt, useReviewPrompt } from './review-hooks';
import { ReviewSheet } from './review-sheet';

/*
 * "How was it?" on the account screen
 * -----------------------------------
 * When the server has a delivered product this account has not reviewed (and has not been asked
 * to stop showing), one quiet sheet asks about it — the most recently delivered first. "Not now"
 * is recorded on the server, so the same product is not asked about again on any device. The
 * order page keeps offering the review either way. A failed request shows nothing: a prompt is
 * never worth an error message.
 */
export function ReviewPrompt() {
  const prompt = useReviewPrompt();
  const dismiss = useDismissReviewPrompt();
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const item = prompt.data?.item ?? null;
  const visible = item !== null && closedFor !== item.productId && !writing;

  if (item === null) return null;
  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={() => setClosedFor(item.productId)}
        title="How was your order?"
        testID="review-prompt"
        footer={
          <View style={styles.actions}>
            <Button
              label="Write a review"
              onPress={() => {
                setWriting(true);
              }}
            />
            <Button
              label="Not now"
              variant="secondary"
              loading={dismiss.isPending}
              onPress={() => {
                setClosedFor(item.productId);
                dismiss.mutate(item.productId);
              }}
            />
          </View>
        }
      >
        <View style={styles.product}>
          <CartLineThumb image={item.image} size={64} />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {item.productName}
            </Text>
            {item.variantLabel === null ? null : (
              <Text style={styles.variant} numberOfLines={1}>
                {item.variantLabel}
              </Text>
            )}
            <View style={styles.hint}>
              <Star size={14} color={theme.colors.warning} fill={theme.colors.warning} />
              <Text style={styles.hintText}>Delivered · order {item.orderNumber}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.lead}>
          You received this product. A short review helps other shoppers choose.
        </Text>
      </BottomSheet>
      <ReviewSheet
        product={writing ? item : null}
        onClose={() => {
          setWriting(false);
          setClosedFor(item.productId);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  product: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...theme.text.subheading, color: theme.colors.foreground },
  variant: { ...theme.text.caption, color: theme.colors.mutedForeground },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  hintText: { ...theme.text.caption, color: theme.colors.mutedForeground },
  lead: { ...theme.text.body, color: theme.colors.mutedForeground, marginTop: theme.spacing[3] },
  actions: { gap: theme.spacing[2] },
});
