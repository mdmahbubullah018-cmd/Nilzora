import type { ChatConversationSummary } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '@/components/card';
import { Logo } from '@/components/logo';
import { QueryState } from '@/components/query-state';
import { Screen } from '@/components/screen';
import { describeApiError } from '@/lib/errors';
import { useManualRefresh } from '@/query';
import { useAuthorizedApi } from '@/query/use-authorized-api';
import { theme } from '@/theme';
import { useProductQuestion } from './product-question';
import { NewConversationCard } from './new-conversation-card';
import { ProductQuestionCard } from './product-question-card';
import { previewText } from './message-model';
import { conversationHref } from './routes';
import { StatusPill, SUPPORT_STATUS_LABEL } from './status-pill';
import { useSearchSupportMessages } from './use-support-extras';
import { useSupportConversations } from './use-support';

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: ChatConversationSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${conversation.subject}, ${SUPPORT_STATUS_LABEL[conversation.status]}${
        conversation.unreadCount > 0 ? `, ${String(conversation.unreadCount)} unread` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar} accessible={false}>
        <MessageCircle size={18} color={theme.colors.primaryAction} strokeWidth={1.8} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          <Text style={styles.subject} numberOfLines={1}>
            {conversation.subject}
          </Text>
          {conversation.unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{conversation.unreadCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {previewText(conversation.lastMessagePreview)}
        </Text>
        <View style={styles.metaRow}>
          <StatusPill status={conversation.status} />
          <Text style={styles.meta} numberOfLines={1}>
            {when(conversation.lastMessageAt)}
            {conversation.orderNumber ? ` · Order ${conversation.orderNumber}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** The customer's support inbox. Render inside <SignedInGate>. */
export function SupportInboxScreen() {
  const router = useRouter();
  const query = useSupportConversations();
  const question = useProductQuestion();
  const { onRefresh } = useManualRefresh(query.refetch);
  const [search, setSearch] = useState('');
  const hits = useSearchSupportMessages(search);
  const run = useAuthorizedApi();
  /** Conversations fetched after the first page, in the order the API gave them. */
  const [older, setOlder] = useState<ChatConversationSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const totalPages = query.data?.totalPages ?? 1;

  const loadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = page + 1;
      const result = await run((api, token) =>
        api.listChatConversations(token, { page: next, pageSize: 30 }),
      );
      setOlder((current) => {
        const seen = new Set(current.map((conversation) => conversation.id));
        return [
          ...current,
          ...result.conversations.filter((conversation) => !seen.has(conversation.id)),
        ];
      });
      setPage(next);
    } catch (error) {
      setMoreError(describeApiError(error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page, run, totalPages]);

  const conversations = useMemo(() => {
    const first = query.data?.conversations ?? [];
    const seen = new Set(first.map((conversation) => conversation.id));
    return [...first, ...older.filter((conversation) => !seen.has(conversation.id))];
  }, [query.data, older]);

  return (
    <Screen
      title="Support"
      edges={['bottom']}
      onRefresh={onRefresh}

      testID="support-inbox"
    >
      {question === null ? <NewConversationCard /> : <ProductQuestionCard question={question} />}
      <View style={styles.brandRow}>
        <Logo size="sm" decorative />
        <Text style={styles.brandLine}>You are talking to the Nilzora team.</Text>
      </View>
      <Text style={styles.intro}>
        Ask about an order, a product or anything else. Replies appear here, and you will see them
        without reloading.
      </Text>
      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search your messages"
          placeholderTextColor={theme.colors.mutedForeground}
          accessibilityLabel="Search your messages"
          style={styles.searchInput}
        />
      </View>
      {search.trim().length >= 2 ? (
        <Card>
          {hits.isPending ? (
            <Text style={styles.searchNote}>Searching…</Text>
          ) : (hits.data?.hits.length ?? 0) === 0 ? (
            <Text style={styles.searchNote}>No message matches that word.</Text>
          ) : (
            (hits.data?.hits ?? []).map((hit) => (
              <Pressable
                key={hit.messageId}
                accessibilityRole="button"
                onPress={() => router.push(conversationHref(hit.conversationId))}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.subject} numberOfLines={1}>
                    {hit.conversationSubject}
                  </Text>
                  <Text style={styles.preview} numberOfLines={2}>
                    {hit.body}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </Card>
      ) : (
        <QueryState
          query={query}
          isEmpty={(data) => data.conversations.length === 0}
          empty={{
            icon: MessageCircle,
            title: 'No conversations yet',
            description: 'Start one above, or choose “Ask about this product” on any product page.',
          }}
        >
          {() => (
            <Card>
              {conversations.map((conversation, index) => (
                <View key={conversation.id}>
                  <ConversationRow
                    conversation={conversation}
                    onPress={() => router.push(conversationHref(conversation.id))}
                  />
                  {index < conversations.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
              {page < totalPages ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Load more conversations"
                  onPress={() => void loadMore()}
                  disabled={loadingMore}
                  style={({ pressed }) => [styles.more, pressed ? styles.rowPressed : null]}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <Text style={styles.moreText}>Load more conversations</Text>
                  )}
                </Pressable>
              ) : null}
            </Card>
          )}
        </QueryState>
      )}
      {query.isError ? (
        <Text style={styles.error}>{describeApiError(query.error).message}</Text>
      ) : null}
      {moreError === null ? null : <Text style={styles.error}>{moreError}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  brandLine: { ...theme.text.caption, color: theme.colors.mutedForeground },
  intro: {
    ...theme.text.body,
    color: theme.colors.mutedForeground,
    marginBottom: theme.spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  rowPressed: { backgroundColor: theme.colors.surfaceMuted },
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
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  subject: { ...theme.text.bodyStrong, color: theme.colors.foreground, flex: 1 },
  preview: { ...theme.text.body, color: theme.colors.mutedForeground },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginTop: 2 },
  meta: { ...theme.text.caption, color: theme.colors.mutedForeground, flexShrink: 1 },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
  },
  badgeText: { ...theme.text.micro, color: '#FFFFFF' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  more: { alignItems: 'center', paddingVertical: theme.spacing[3] },
  moreText: { ...theme.text.caption, color: theme.colors.primary },
  error: { ...theme.text.caption, color: theme.colors.fieldError, marginTop: theme.spacing[2] },
  searchRow: { marginBottom: theme.spacing[3] },
  searchInput: {
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    ...theme.text.body,
    color: theme.colors.foreground,
  },
  searchNote: {
    ...theme.text.caption,
    color: theme.colors.mutedForeground,
    padding: theme.spacing[4],
  },
});
