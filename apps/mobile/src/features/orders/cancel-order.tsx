import { ApiError } from '@nilzora/api-client';
import type { OrderResponse } from '@nilzora/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSignedInUserId } from '@/auth/session-context';
import { Button } from '@/components/button';
import { useOnline } from '@/network/connectivity';
import { Notice } from '@/components/notice';
import { TextField } from '@/components/text-field';
import { describeApiError, isTransientError } from '@/lib/errors';
import { queryKeys, useAuthorizedApi } from '@/query';
import { theme } from '@/theme';
import { SectionCard } from './order-sections';

/** Longest cancellation reason the API accepts. */
export const CANCEL_REASON_MAX_LENGTH = 300;

export const CANCEL_MESSAGES = {
  refused: 'This order can no longer be cancelled. It may already be confirmed or on its way.',
  gone: 'This order could not be found.',
  unconfirmed: 'We could not confirm the cancellation. Check your connection and try again.',
} as const;

/**
 * How a cancellation attempt ended. The server decides whether an order can be cancelled;
 * the app only reports what it said.
 *
 * - `cancelled`: the order is cancelled (the cache already shows it).
 * - `refused`: the order has moved on or is gone; it was reloaded so the screen is current.
 * - `retry`: no answer (connection, timeout, server fault): the cancellation may or may not
 *   have been saved, so the customer can send it again (the API answers a repeat harmlessly).
 * - `failed`: something that trying again will not fix (session ended, account suspended).
 */
export type CancelOutcome =
  | { kind: 'cancelled' }
  | { kind: 'refused'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'failed'; message: string };

/** The request is sent as often as asked: after no answer, only the server knows what it saved. */
function maybeSaved(error: unknown): boolean {
  return (
    isTransientError(error) || (error instanceof ApiError && error.code === 'invalid_response')
  );
}

/** Cancels one of the signed-in customer's orders and keeps the cached order and history current. */
export function useCancelOrder(orderNumber: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (reason: string) =>
      run((api, accessToken) =>
        api.cancelOrder(accessToken, orderNumber, reason === '' ? {} : { reason }),
      ),
    // The outcome is handled when the call resolves and nothing reads the finished mutation
    // later, so it is dropped as soon as the screen lets go of it. The default is to keep it
    // for five minutes with a timer that outlives the screen (and a test run).
    gcTime: 0,
  });
  const { mutateAsync } = mutation;

  const cancel = useCallback(
    async (reason: string): Promise<CancelOutcome> => {
      const detailKey = queryKeys.orders.detail(userId, orderNumber);
      const everything = { queryKey: queryKeys.orders.all(userId) };
      try {
        const response = await mutateAsync(reason.trim());
        // Show the cancelled order at once, then bring the history (and this order) up to date.
        queryClient.setQueryData(detailKey, response);
        void queryClient.invalidateQueries(everything);
        return { kind: 'cancelled' };
      } catch (error) {
        if (maybeSaved(error)) return { kind: 'retry', message: CANCEL_MESSAGES.unconfirmed };
        if (error instanceof ApiError && error.code === 'order_not_cancellable') {
          await queryClient.invalidateQueries(everything);
          // A repeat of a cancellation that was saved earlier lands here too.
          const order = queryClient.getQueryData<OrderResponse>(detailKey)?.order;
          if (order?.status === 'cancelled') return { kind: 'cancelled' };
          return { kind: 'refused', message: CANCEL_MESSAGES.refused };
        }
        if (error instanceof ApiError && error.status === 404) {
          await queryClient.invalidateQueries(everything);
          return { kind: 'refused', message: CANCEL_MESSAGES.gone };
        }
        return { kind: 'failed', message: describeApiError(error).message };
      }
    },
    [mutateAsync, orderNumber, queryClient, userId],
  );

  return { cancel, pending: mutation.isPending };
}

/** The "Changed your mind?" card with the button that opens the confirmation. */
export function CancelOrderSection({ onPress }: { onPress: () => void }) {
  return (
    <SectionCard title="Changed your mind?">
      <Text style={styles.muted}>
        You can cancel while the order is awaiting confirmation. Nothing is charged.
      </Text>
      <Button
        label="Cancel order"
        variant="danger"
        accessibilityHint="Asks you to confirm before cancelling"
        onPress={onPress}
      />
    </SectionCard>
  );
}

export interface CancelOrderDialogProps {
  orderNumber: string;
  /** True while the cancellation is being sent; the dialog cannot be dismissed meanwhile. */
  pending: boolean;
  /** A fixed message about the last attempt, shown above the form. */
  error: string | null;
  onConfirm: (reason: string) => void;
  onDismiss: () => void;
}

/**
 * Confirmation before cancelling: an optional reason (up to 300 characters), a clear
 * destructive action, and a way back. Cancelling is never one tap.
 */
export function CancelOrderDialog({
  orderNumber,
  pending,
  error,
  onConfirm,
  onDismiss,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState('');
  // Cancelling is confirmed by the server, so it needs a connection.
  const online = useOnline();
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!pending) onDismiss();
      }}
    >
      <View style={styles.backdrop} accessibilityViewIsModal>
        <SafeAreaView edges={['top', 'bottom']} style={styles.frame}>
          <KeyboardAvoidingView
            style={styles.frame}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.dialog}>
                <Text accessibilityRole="header" style={styles.title}>
                  Cancel order {orderNumber}?
                </Text>
                <Text style={styles.muted}>
                  You can cancel only while the order is awaiting confirmation. This cannot be
                  undone.
                </Text>
                {error ? <Notice tone="danger">{error}</Notice> : null}
                <TextField
                  label="Reason"
                  optional
                  hint={`Helps us improve. Up to ${CANCEL_REASON_MAX_LENGTH} characters.`}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={CANCEL_REASON_MAX_LENGTH}
                  multiline
                  textAlignVertical="top"
                  editable={!pending}
                />
                <View style={styles.actions}>
                  <Button
                    label="Yes, cancel order"
                    variant="danger"
                    loading={pending}
                    disabled={!online}
                    accessibilityHint={
                      online ? undefined : 'You are offline. Connect to cancel this order.'
                    }
                    onPress={() => onConfirm(reason)}
                  />
                  <Button
                    label="Keep order"
                    variant="secondary"
                    disabled={pending}
                    onPress={onDismiss}
                  />
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  muted: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)' },
  frame: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing[5] },
  dialog: {
    gap: theme.spacing[4],
    padding: theme.spacing[5],
    borderRadius: theme.radii.xl,
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 19,
    fontWeight: theme.fontWeights.semibold,
  },
  actions: { gap: theme.spacing[3] },
});
