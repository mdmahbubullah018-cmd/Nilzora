import type { StartChatConversationRequest } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { AppIcon, icons } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { describeApiError } from '@/lib/errors';
import { theme } from '@/theme';
import { dismissProductQuestion, type ProductQuestion } from './product-question';
import { conversationHref } from './routes';
import { useStartSupportConversation } from './use-support';

/**
 * The customer's first message about one product, written before the conversation exists.
 *
 * It mirrors the website's panel exactly: the product travels as `productId` (which the API
 * re-checks is a published product) plus the product name as the subject, and nothing is sent
 * until the customer presses Send. The database reuses the caller's live thread for the same
 * product, so tapping the action twice never opens a second conversation.
 */
export function ProductQuestionCard({ question }: { question: ProductQuestion }) {
  const router = useRouter();
  const start = useStartSupportConversation();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const message = body.trim();

  const send = async () => {
    if (message === '' || start.isPending) return;
    setError(null);
    const request: StartChatConversationRequest = {
      kind: 'customer_support',
      productId: question.productId,
      subject: question.productName,
      body: message,
    };
    try {
      const detail = await start.mutateAsync(request);
      dismissProductQuestion();
      router.replace(conversationHref(detail.conversation.id));
    } catch (failure) {
      setError(describeApiError(failure).message);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.avatar} accessible={false}>
          <AppIcon name="message" size="sm" color={theme.colors.primaryAction} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Ask about this product</Text>
          <Text style={styles.product} numberOfLines={2}>
            {question.productName}
          </Text>
        </View>
        <IconButton
          icon={icons.close}
          label="Dismiss this product question"
          onPress={dismissProductQuestion}
        />
      </View>
      <TextInput
        value={body}
        onChangeText={(next) => {
          setBody(next);
          setError(null);
        }}
        placeholder="Ask about size, stock, delivery…"
        placeholderTextColor={theme.colors.mutedForeground}
        accessibilityLabel={`Your question about ${question.productName}`}
        multiline
        maxLength={4000}
        textAlignVertical="top"
        style={styles.input}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        label="Send question"
        onPress={() => void send()}
        loading={start.isPending}
        disabled={message === ''}
        accessibilityHint="Sends your question to Nilzora support and opens the conversation"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  headText: { flex: 1, gap: 1 },
  title: { ...theme.text.subheading, color: theme.colors.foreground },
  product: { ...theme.text.caption, color: theme.colors.mutedForeground },
  input: {
    minHeight: 84,
    borderRadius: theme.radii.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.surfaceMuted,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    ...theme.text.body,
    color: theme.colors.foreground,
  },
  error: { ...theme.text.caption, color: theme.colors.fieldError },
});
