import { CHAT_MESSAGE_MAX_LENGTH } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { MessageCirclePlus, Package } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card } from '@/components/card';
import { describeApiError } from '@/lib/errors';
import { useOnline } from '@/network/connectivity';
import { theme } from '@/theme';
import { conversationHref } from './routes';
import { QuickQuestions } from './quick-questions';
import { useRecentOrdersForSupport, useStartSupportConversation } from './use-support';

/*
 * Starting a conversation from the Support screen
 * -----------------------------------------------
 * A question can be general or about one of the customer's own recent orders. The orders are
 * read only when the composer opens, and the API checks that a named order belongs to this
 * account before the thread starts, so the picker is a convenience and never the control.
 */

export function NewConversationCard() {
  const router = useRouter();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const orders = useRecentOrdersForSupport(open);
  const start = useStartSupportConversation();

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new conversation"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.launcher, pressed ? styles.pressed : null]}
      >
        <MessageCirclePlus
          size={18}
          color={theme.colors.primaryActionForeground}
          strokeWidth={2}
          accessible={false}
        />
        <Text style={styles.launcherText}>Start a new conversation</Text>
      </Pressable>
    );
  }

  const text = body.trim();
  const submit = () => {
    if (text === '' || start.isPending) return;
    start.mutate(
      orderNumber === null
        ? { kind: 'customer_support', body: text }
        : { kind: 'order_support', orderNumber, body: text },
      {
        onSuccess: (detail) => {
          setBody('');
          setOrderNumber(null);
          setOpen(false);
          router.push(conversationHref(detail.conversation.id));
        },
      },
    );
  };

  const recent = orders.data?.orders ?? [];

  return (
    <View style={styles.wrap}>
      <Card>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.heading}>
            New conversation
          </Text>
          <Text style={styles.label}>What is it about?</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="radiogroup"
          >
            <TopicChip
              label="A general question"
              selected={orderNumber === null}
              onPress={() => setOrderNumber(null)}
            />
            {recent.map((order) => (
              <TopicChip
                key={order.orderNumber}
                label={`Order ${order.orderNumber}`}
                selected={orderNumber === order.orderNumber}
                onPress={() => setOrderNumber(order.orderNumber)}
                withIcon
              />
            ))}
          </ScrollView>
          {orders.isPending ? <Text style={styles.note}>Loading your recent orders…</Text> : null}
          {body.trim() === '' ? (
            <QuickQuestions disabled={start.isPending} onPick={(question) => setBody(question)} />
          ) : null}
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={
              orderNumber === null ? 'How can we help?' : `Your question about order ${orderNumber}`
            }
            placeholderTextColor={theme.colors.mutedForeground}
            accessibilityLabel="Your message"
            multiline
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            style={styles.input}
          />
          {start.isError ? (
            <Text style={styles.error}>{describeApiError(start.error).message}</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => {
                setOpen(false);
                start.reset();
              }}
              style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send and open the conversation"
              accessibilityState={{
                disabled: text === '' || start.isPending || !online,
                busy: start.isPending,
              }}
              disabled={text === '' || start.isPending || !online}
              onPress={submit}
              style={({ pressed }) => [
                styles.primary,
                text === '' ? styles.disabled : null,
                pressed ? styles.pressed : null,
              ]}
            >
              {start.isPending ? (
                <ActivityIndicator color={theme.colors.primaryActionForeground} />
              ) : (
                <Text style={styles.primaryText}>Send</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Card>
    </View>
  );
}

function TopicChip({
  label,
  selected,
  onPress,
  withIcon = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  withIcon?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      {withIcon ? (
        <Package
          size={14}
          color={selected ? theme.colors.primaryAction : theme.colors.mutedForeground}
          accessible={false}
        />
      ) : null}
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  launcher: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.primaryAction,
    marginBottom: theme.spacing[4],
  },
  launcherText: { ...theme.text.bodyStrong, color: theme.colors.primaryActionForeground },
  pressed: { opacity: 0.85 },
  wrap: { marginBottom: theme.spacing[4] },
  body: { padding: theme.spacing[4], gap: theme.spacing[3] },
  heading: { ...theme.text.subheading, color: theme.colors.foreground },
  label: { ...theme.text.caption, color: theme.colors.mutedForeground },
  chips: { gap: theme.spacing[2], paddingRight: theme.spacing[2] },
  chip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipSelected: {
    borderColor: theme.colors.primaryAction,
    backgroundColor: theme.colors.iconSurface,
  },
  chipText: { ...theme.text.caption, color: theme.colors.foreground },
  chipTextSelected: { color: theme.colors.primaryAction },
  note: { ...theme.text.caption, color: theme.colors.mutedForeground },
  input: {
    minHeight: 88,
    textAlignVertical: 'top',
    borderRadius: theme.radii.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    ...theme.text.body,
    color: theme.colors.foreground,
  },
  error: { ...theme.text.caption, color: theme.colors.fieldError },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing[2] },
  secondary: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.input,
  },
  secondaryText: { ...theme.text.bodyStrong, color: theme.colors.mutedForeground },
  primary: {
    minHeight: theme.touchTarget,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[5],
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.primaryAction,
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...theme.text.bodyStrong, color: theme.colors.primaryActionForeground },
});
