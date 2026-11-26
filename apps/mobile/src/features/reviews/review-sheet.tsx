import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys } from '@/query';
import { theme } from '@/theme';
import { useMyReview } from './review-hooks';
import { ReviewForm } from './review-form';

/*
 * Writing a review from an order or from the account prompt
 * ---------------------------------------------------------
 * The same form, validation and photo upload as the product page, in a sheet. The server decides
 * whether this account may review the product (a delivered purchase); the sheet only shows what
 * it answered. Once the review is saved the sheet says so and the prompt is re-read, so the same
 * product is never asked about twice.
 */
export function ReviewSheet({
  product,
  onClose,
}: {
  product: { productId: string; productName: string; variantLabel: string | null } | null;
  onClose: () => void;
}) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const close = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.prompt(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.pending(userId) });
    onClose();
  };
  return (
    <BottomSheet
      visible={product !== null}
      onClose={close}
      title="Write a review"
      testID="review-sheet"
    >
      {product === null ? null : <ReviewSheetBody product={product} onDone={close} />}
    </BottomSheet>
  );
}

function ReviewSheetBody({
  product,
  onDone,
}: {
  product: { productId: string; productName: string; variantLabel: string | null };
  onDone: () => void;
}) {
  const mine = useMyReview(product.productId);
  const saved = mine.data?.review ?? null;
  return (
    <View style={styles.body}>
      <View style={styles.product}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.productName}
        </Text>
        {product.variantLabel === null ? null : (
          <Text style={styles.variant} numberOfLines={1}>
            {product.variantLabel}
          </Text>
        )}
      </View>
      {saved !== null ? (
        <>
          <Notice tone="success" title="Thank you">
            Your review was sent. It appears on the product once the store has checked it.
          </Notice>
          <Button label="Done" onPress={onDone} />
        </>
      ) : mine.data !== undefined && !mine.data.eligible ? (
        <Notice tone="info">Only customers who received this product can review it.</Notice>
      ) : (
        <ReviewForm productId={product.productId} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: theme.spacing[3] },
  product: { gap: 2 },
  productName: { ...theme.text.subheading, color: theme.colors.foreground },
  variant: { ...theme.text.caption, color: theme.colors.mutedForeground },
});
