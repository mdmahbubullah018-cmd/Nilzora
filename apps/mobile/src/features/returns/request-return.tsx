import type { OrderDetail, OrderItem } from '@nilzora/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSignedInUserId } from '@/auth/session-context';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { QueryStateView } from '@/components/query-state';
import { Screen } from '@/components/screen';
import { describeApiError } from '@/lib/errors';
import { queryKeys, useAuthorizedApi } from '@/query';
import { theme } from '@/theme';
import { useReturnActions } from './use-returns';

/** Reasons the form offers; the API accepts any text of 3–120 characters. */
const REASONS = [
  'The item arrived damaged',
  'The item is not what I ordered',
  'The size or fit is wrong',
  'The item stopped working',
  'I changed my mind',
];

const NO_QUANTITIES: Record<number, number> = {};

function LineChoice({
  item,
  quantity,
  onChange,
}: {
  item: OrderItem;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <View style={styles.line}>
      <Text style={styles.value}>
        {`${item.productName}${item.variantLabel === null ? '' : ` · ${item.variantLabel}`}`}
      </Text>
      <Text style={styles.meta}>{`You bought ${String(item.quantity)} · SKU ${item.sku}`}</Text>
      <View style={styles.stepper}>
        <Button
          label="−"
          variant="secondary"
          disabled={quantity === 0}
          onPress={() => {
            onChange(Math.max(0, quantity - 1));
          }}
        />
        <Text style={styles.count}>{quantity === 0 ? 'None' : String(quantity)}</Text>
        <Button
          label="+"
          variant="secondary"
          disabled={quantity >= item.quantity}
          onPress={() => {
            onChange(Math.min(item.quantity, quantity + 1));
          }}
        />
      </View>
    </View>
  );
}

function RequestBody({ order }: { order: OrderDetail }) {
  const router = useRouter();
  const { request, requesting } = useReturnActions();
  const [quantities, setQuantities] = useState<Record<number, number>>(NO_QUANTITIES);
  const [reason, setReason] = useState(REASONS[0] ?? '');
  const [description, setDescription] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const items = order.items
    .map((item) => ({ orderItemId: item.orderItemId, quantity: quantities[item.orderItemId] ?? 0 }))
    .filter((item) => item.quantity > 0);

  const submit = () => {
    setFailure(null);
    if (items.length === 0) {
      setFailure('Choose how many units of at least one item you are sending back.');
      return;
    }
    void request({
      orderNumber: order.orderNumber,
      items,
      reason,
      ...(description.trim() === '' ? {} : { description: description.trim() }),
    })
      .then((saved) => {
        router.replace({
          pathname: '/returns/[returnId]',
          params: { returnId: saved.return.id },
        });
      })
      .catch((error: unknown) => {
        setFailure(describeApiError(error).message);
      });
  };

  return (
    <View style={styles.stack}>
      {failure === null ? null : (
        <Notice tone="danger" title="The request was not saved">
          {failure}
        </Notice>
      )}
      <Text style={styles.meta}>
        Tell us what is coming back and why. Nilzora reviews the request before anything is
        returned.
      </Text>
      <View style={styles.card}>
        {order.items.map((item) => (
          <LineChoice
            key={item.orderItemId}
            item={item}
            quantity={quantities[item.orderItemId] ?? 0}
            onChange={(quantity) => {
              setQuantities((current) => ({ ...current, [item.orderItemId]: quantity }));
            }}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Why are you sending it back?</Text>
        {REASONS.map((option) => (
          <Button
            key={option}
            label={option}
            variant={reason === option ? 'primary' : 'secondary'}
            onPress={() => {
              setReason(option);
            }}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Anything else we should know? (optional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
          accessibilityLabel="Anything else we should know"
          style={styles.input}
          placeholder="For example, which part is damaged"
          placeholderTextColor={theme.colors.mutedForeground}
        />
      </View>

      <Button label="Send the request" loading={requesting} onPress={submit} />
    </View>
  );
}

/**
 * The return form for one order. Eligibility is decided by the API when the request is sent,
 * so this screen never promises an outcome; it shows the API's own refusal instead.
 */
export function RequestReturnScreen({ orderNumber }: { orderNumber: string }) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const query = useQuery({
    queryKey: queryKeys.orders.detail(userId, orderNumber),
    queryFn: ({ signal }) => run((api, token) => api.getOrder(token, orderNumber, { signal })),
    enabled: userId !== null && orderNumber !== '',
  });

  return (
    <Screen title="Send something back">
      {query.data === undefined && query.status === 'error' ? (
        <QueryStateView
          state="error"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : query.data === undefined ? (
        <QueryStateView state="loading" />
      ) : (
        <RequestBody order={query.data.order} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing[3] },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: { gap: theme.spacing[1], paddingBottom: theme.spacing[2] },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
  },
  value: { color: theme.colors.foreground, fontSize: theme.text.body.fontSize },
  meta: { color: theme.colors.mutedForeground, fontSize: theme.text.body.fontSize },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  count: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
    minWidth: 48,
    textAlign: 'center',
  },
  input: {
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radii.md,
    color: theme.colors.foreground,
    fontSize: theme.text.body.fontSize,
    minHeight: 88,
    padding: theme.spacing[3],
    textAlignVertical: 'top',
  },
});
