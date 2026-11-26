import type {
  ChatMessage,
  ChatPinnedMessage,
  ChatReactionSummaryItem,
  ChatReportReason,
} from '@nilzora/contracts';
import { chatReactionLabel } from '@nilzora/contracts';
import * as ImagePicker from 'expo-image-picker';
import { Check, CircleAlert, ImagePlus, Pin, Send, Star, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '@/theme';
import { describeApiError } from '@/lib/errors';
import {
  SUPPORT_PICTURE_MAX_BYTES,
  SUPPORT_PICTURE_MAX_LABEL,
  useReportSupportMessage,
  useSubmitMessageFeedback,
  useSubmitSupportRating,
  useUploadSupportAttachment,
  type PickedPicture,
} from './use-support-extras';

/*
 * The pieces of the conversation screen
 * -------------------------------------
 * Pinned strip, reaction bar, satisfaction card, picture picker and the report sheet. They
 * are separate so the thread keeps one piece of state each and every one of them can report
 * a refusal without taking the composer down with it.
 */

/** The pinned messages of a thread, shown above it. Nothing renders when there are none. */
/** "0:07" for a pinned recording's length. */
function pinnedClock(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * One pinned message as a single line. A pinned file is named instead of left blank, and never
 * shows an object key or a storage address — the strip reads the safe summary the API sends.
 */
function pinnedLabel(pin: ChatPinnedMessage): string {
  const attachment = pin.attachment;
  if (attachment === null || attachment === undefined) {
    return pin.body ?? 'A message that has since been removed.';
  }
  const text = pin.body?.trim() ?? '';
  const { fileName, contentType, durationMs } = attachment;
  let described: string;
  if (contentType.startsWith('image/')) described = `Photo · ${fileName}`;
  else if (contentType.startsWith('audio/'))
    described =
      durationMs === null || durationMs === undefined
        ? `Voice message · ${fileName}`
        : `Voice message · ${pinnedClock(durationMs)}`;
  else if (contentType === 'application/pdf') described = `PDF · ${fileName}`;
  else described = `File · ${fileName}`;
  return text === '' ? described : `${described} — ${text}`;
}

/**
 * The quiet "Was this helpful?" row under the last support reply of a finished conversation.
 * Whether it shows at all is decided by the screen (see `feedbackTargetId`): only a resolved or
 * closed thread asks, only about the last real support reply, and never again once the customer
 * has answered. The API re-checks the rules before it stores anything. Yes and No are the whole
 * interface: this app has no free-text note.
 */
export function MessageFeedback({
  message,
  conversationId,
  onRated,
}: {
  message: ChatMessage;
  conversationId: string;
  /** Called with the message id once the verdict is stored. */
  onRated: (messageId: string) => void;
}) {
  const submit = useSubmitMessageFeedback(conversationId);
  const [done, setDone] = useState<'helpful' | 'not_helpful' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rate = (verdict: 'helpful' | 'not_helpful') => {
    if (submit.isPending) return;
    setFailure(null);
    submit.mutate(
      { messageId: message.id, verdict },
      {
        onSuccess: () => {
          setDone(verdict);
          onRated(message.id);
        },
        onError: (error) => setFailure(describeApiError(error).message),
      },
    );
  };

  return (
    <View style={styles.feedbackRow} testID="message-feedback">
      {done === null ? (
        <>
          <Text style={styles.feedbackAsk}>Was this helpful?</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark this reply helpful"
            disabled={submit.isPending}
            onPress={() => rate('helpful')}
            style={styles.feedbackButton}
          >
            <Text style={styles.feedbackYes}>👍 Yes</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark this reply not helpful"
            disabled={submit.isPending}
            onPress={() => rate('not_helpful')}
            style={styles.feedbackButton}
          >
            <Text style={styles.feedbackNo}>👎 No</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.feedbackThanks}>Thanks — your feedback helps us improve.</Text>
      )}
      {failure === null ? null : <Text style={styles.feedbackError}>{failure}</Text>}
    </View>
  );
}

export function PinnedStrip({ pins }: { pins: readonly ChatPinnedMessage[] }) {
  if (pins.length === 0) return null;
  return (
    <View style={styles.pinned}>
      <View style={styles.pinnedTitleRow}>
        <Pin size={12} color={theme.notice.warning.foreground} />
        <Text style={styles.pinnedTitle}>Pinned</Text>
      </View>
      {pins.map((pin) => (
        <Text key={pin.id} style={styles.pinnedBody} numberOfLines={2}>
          {pinnedLabel(pin)}
        </Text>
      ))}
    </View>
  );
}

/**
 * The tally under a bubble: every reaction anyone used on it, with its count; the customer's own
 * is filled in. Tapping a chip adds or removes the customer's reaction of that kind. Choosing a
 * different reaction is done from the long-press menu, which offers all eight.
 */
export function ReactionCounts({
  message,
  summary,
  mine,
  disabled,
  onToggle,
}: {
  message: ChatMessage;
  summary: readonly ChatReactionSummaryItem[];
  /** True when the customer wrote the message, so the tally sits on the bubble's side. */
  mine: boolean;
  disabled: boolean;
  onToggle: (message: ChatMessage, emoji: string) => void;
}) {
  const items = summary.filter((item) => item.messageId === message.id && item.count > 0);
  if (items.length === 0) return null;
  return (
    <View
      style={[styles.reactionRow, mine ? styles.reactionRowMine : null]}
      testID="reaction-counts"
    >
      {items.map((item) => (
        <Pressable
          key={item.emoji}
          accessibilityRole="button"
          accessibilityLabel={`${chatReactionLabel(item.emoji)}: ${String(item.count)}`}
          accessibilityState={{ selected: item.mine, disabled }}
          disabled={disabled}
          onPress={() => onToggle(message, item.emoji)}
          style={[styles.reactionButton, item.mine ? styles.reactionButtonMine : null]}
        >
          <Text style={item.mine ? styles.reactionTextMine : styles.reactionText}>
            {item.emoji} {item.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The satisfaction card.
 *
 * It only appears for a resolved thread the customer has not rated, which is the point the
 * API accepts a rating at. A second rating is refused by the database rather than
 * overwriting the first, so the card also disappears once the thread carries a rating.
 */
export function RatingCard({
  conversationId,
  rating,
}: {
  conversationId: string;
  rating: number | null;
}) {
  const submit = useSubmitSupportRating(conversationId);
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  if (done !== null) {
    return (
      <View style={[styles.card, styles.cardSuccess]}>
        <Check size={14} color={theme.colors.success} />
        <Text style={styles.cardText}>Thank you — your rating was saved.</Text>
      </View>
    );
  }
  if (rating !== null) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>How did we do?</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${String(value)} out of 5`}
            disabled={submit.isPending}
            onPress={() => {
              setFailure(null);
              submit.mutate(
                { rating: value, comment: comment.trim() === '' ? undefined : comment.trim() },
                {
                  onSuccess: () => setDone(value),
                  onError: (error) => setFailure(describeApiError(error).message),
                },
              );
            }}
            hitSlop={6}
            style={styles.star}
          >
            <Star size={20} color={theme.colors.warning} />
          </Pressable>
        ))}
        {submit.isPending ? <ActivityIndicator size="small" /> : null}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Anything to add (optional)"
        placeholderTextColor={theme.colors.mutedForeground}
        maxLength={500}
        accessibilityLabel="Comment about the conversation"
        style={styles.commentInput}
      />
      {failure === null ? null : <Text style={styles.failure}>{failure}</Text>}
    </View>
  );
}

/** The picture waiting to be sent, with the real upload progress. */
export interface PendingPicture {
  id: string;
  fileName: string;
}

export function AttachmentButton({
  conversationId,
  pending,
  onUploaded,
  onCleared,
  disabled,
}: {
  conversationId: string;
  pending: PendingPicture | null;
  onUploaded: (attachment: PendingPicture) => void;
  onCleared: () => void;
  disabled: boolean;
}) {
  const upload = useUploadSupportAttachment(conversationId);
  const [percent, setPercent] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const pick = useCallback(async () => {
    setFailure(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setFailure('Nilzora needs permission to open your photos.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (asset === undefined) return;

    const contentType: PickedPicture['contentType'] =
      asset.mimeType === 'image/png'
        ? 'image/png'
        : asset.mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg';
    if (asset.fileSize !== undefined && asset.fileSize > SUPPORT_PICTURE_MAX_BYTES) {
      setFailure(`That picture is larger than ${SUPPORT_PICTURE_MAX_LABEL}.`);
      return;
    }

    setPercent(0);
    upload.mutate(
      {
        uri: asset.uri,
        name: asset.fileName ?? `photo-${String(Date.now())}.jpg`,
        contentType,
        byteSize: asset.fileSize ?? 0,
        onProgress: setPercent,
      },
      {
        onSuccess: (uploaded) => {
          setPercent(0);
          onUploaded(uploaded);
        },
        onError: (error) => {
          setPercent(0);
          setFailure(describeApiError(error).message);
        },
      },
    );
  }, [onUploaded, upload]);

  return (
    <View style={styles.attachRow}>
      {pending === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a picture"
          onPress={() => void pick()}
          disabled={disabled || upload.isPending}
          hitSlop={8}
          style={styles.attachButton}
        >
          {upload.isPending ? (
            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
          ) : (
            <ImagePlus size={18} color={theme.colors.mutedForeground} />
          )}
        </Pressable>
      ) : (
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {pending.fileName}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove the picture"
            onPress={onCleared}
            hitSlop={8}
          >
            <X size={12} color={theme.colors.foreground} />
          </Pressable>
        </View>
      )}
      {upload.isPending ? <Text style={styles.attachProgress}>{percent}%</Text> : null}
      {failure === null ? null : <Text style={styles.failure}>{failure}</Text>}
    </View>
  );
}

const REASONS: { reason: ChatReportReason; label: string }[] = [
  { reason: 'spam', label: 'Spam' },
  { reason: 'abuse', label: 'Abuse' },
  { reason: 'personal_information', label: 'Personal information' },
  { reason: 'other', label: 'Something else' },
];

/** Asks for a reason, then reports the message. The API keeps one report per account. */
export function useReportMessage() {
  const report = useReportSupportMessage();
  const ask = useCallback(
    (messageId: string) => {
      Alert.alert('Report this message', 'What is wrong with it?', [
        ...REASONS.map((item) => ({
          text: item.label,
          onPress: () => {
            report.mutate(
              { messageId, reason: item.reason },
              {
                onSuccess: () => Alert.alert('Reported', 'Our team will look at this message.'),
                onError: (error) =>
                  Alert.alert('Could not report', describeApiError(error).message),
              },
            );
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [report],
  );
  return ask;
}

/** A one-line error with an icon, for a refused action. */
export function FailureNote({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <View style={styles.failureRow}>
      <CircleAlert size={12} color={theme.colors.fieldError} />
      <Text style={styles.failure}>{message}</Text>
    </View>
  );
}

/** The send button, reused by the composer for a text send and a picture send. */
export function SendButton({
  disabled,
  busy,
  onPress,
}: {
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send message"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.send,
        (disabled || busy) && styles.sendDisabled,
        pressed && styles.sendPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.primaryActionForeground} />
      ) : (
        <Send size={18} color={theme.colors.primaryActionForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pinned: {
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.radii.card,
    backgroundColor: theme.notice.warning.surface,
    gap: 2,
  },
  pinnedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pinnedTitle: { ...theme.text.micro, color: theme.notice.warning.foreground },
  pinnedBody: { ...theme.text.caption, color: theme.colors.foreground },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.spacing[1],
    marginTop: 2,
  },
  reactionRowMine: { justifyContent: 'flex-end' },
  feedbackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing[1],
    marginTop: 2,
  },
  feedbackAsk: { ...theme.text.micro, color: theme.colors.mutedForeground },
  feedbackButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  feedbackYes: { ...theme.text.micro, color: theme.colors.primary },
  feedbackNo: { ...theme.text.micro, color: theme.colors.fieldError },
  feedbackThanks: { ...theme.text.micro, color: theme.colors.mutedForeground },
  feedbackError: { ...theme.text.micro, color: theme.colors.fieldError, width: '100%' },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // A full 44 dp target: the chip itself is the touch area, so it never relies on hitSlop.
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  reactionButtonMine: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.infoSurface,
  },
  reactionTextMine: { color: theme.colors.foreground, fontSize: 11, fontWeight: '600' },
  reactionText: { ...theme.text.micro, color: theme.colors.mutedForeground },
  card: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
    gap: theme.spacing[2],
  },
  cardSuccess: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  cardTitle: { ...theme.text.caption, color: theme.colors.foreground },
  cardText: { ...theme.text.caption, color: theme.colors.foreground },
  stars: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  // A full 44 dp target around the 20 dp star; five of them are 220 dp wide with the gaps.
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  commentInput: {
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    ...theme.text.caption,
    color: theme.colors.foreground,
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: 4,
  },
  attachButton: { padding: 4 },
  attachProgress: { ...theme.text.micro, color: theme.colors.mutedForeground },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    maxWidth: '70%',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surfaceMuted,
  },
  chipText: { ...theme.text.micro, color: theme.colors.foreground, flexShrink: 1 },
  failureRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  failure: { ...theme.text.micro, color: theme.colors.fieldError, flexShrink: 1 },
  send: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendPressed: { backgroundColor: theme.colors.primaryActionHover },
});
