import type {
  ChatAttachment,
  ChatMessage,
  ChatReactionSummaryItem,
  ChatReplySummary,
} from '@nilzora/contracts';
import { ImageOff, RotateCw } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type HostInstance,
} from 'react-native';
import { theme } from '@/theme';
import type { ViewableImage } from './chat-image-viewer';
import { useChatMedia } from './chat-media';
import {
  FileMessageCard,
  LONG_PRESS_MS,
  VoiceMessageBubble,
  attachmentKindOf,
} from './media-sheet';
import type { MenuTarget } from './message-actions';
import { isReactable, isReplyable, quoteSnippet, visibleBody } from './message-model';
import type { OutgoingMessage } from './optimistic-messages';
import { safeImageName } from './chat-image-viewer';
import { ReactionCounts } from './support-extras';

/**
 * Whether an uploaded attachment's stored name is a picture. The API re-encodes every chat
 * picture as WebP and names it accordingly, so the extension is the reliable hint the composer
 * has for choosing a thumbnail preview over a file card.
 */
function isPictureName(fileName: string): boolean {
  return /\.(webp|jpe?g|png)$/i.test(fileName);
}

/** The time under a bubble, in the phone's own clock. */
export function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** The name above a received bubble; the shop's own automation has no profile to read one from. */
function senderCaption(message: ChatMessage): string | null {
  if (message.senderName !== null && message.senderName !== '') return message.senderName;
  if (message.kind === 'automated') return 'Nilzora Assistant';
  return null;
}

/** Who wrote the message being answered, in the words a customer uses for them. */
export function replyAuthor(reply: ChatReplySummary): string {
  if (reply.senderName !== null && reply.senderName !== '') return reply.senderName;
  if (reply.senderRole === 'customer') return 'You';
  if (reply.kind === 'automated') return 'Nilzora Assistant';
  return 'Nilzora team';
}

/** The leaf a reply quotes when the message being answered is already on screen. */
export function quoteOf(message: ChatMessage): ChatReplySummary {
  return {
    id: message.id,
    seq: message.seq,
    senderId: message.senderId,
    senderRole: message.senderRole,
    senderName: message.senderName,
    kind: message.kind,
    body: visibleBody(message),
    hasAttachment: message.attachments.length > 0,
    deleted: false,
  };
}

/**
 * A message that is not stored yet.
 *
 * It sits on the same side, in the same bubble, as the message it will become — so nothing
 * jumps when the server answers. Until then it says so, and if the send failed it says that too,
 * with a retry that re-uses the same client id (the server treats that id as the deduplication
 * key, so a retry after a lost answer cannot post twice).
 */
export function OutgoingBubble({
  message,
  onRetry,
}: {
  message: OutgoingMessage;
  onRetry: (message: OutgoingMessage) => void;
}) {
  const failed = message.status === 'failed';
  // Media sits on a neutral surface, never inside the blue fill (see Bubble).
  const media = message.attachments.length > 0;
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowMine, styles.bubbleRowFirst]}>
      <View
        style={[
          styles.bubbleColumn,
          styles.bubble,
          media ? styles.bubbleMedia : styles.bubbleMine,
          styles.bubbleOutgoing,
        ]}
      >
        {message.attachments.map((file) =>
          file.localUri !== null && isPictureName(file.fileName) ? (
            <Image
              key={file.id}
              source={{ uri: file.localUri }}
              style={styles.bubbleImage}
              resizeMode="cover"
              accessible={false}
            />
          ) : (
            <View key={file.id} style={styles.outgoingFile}>
              <Text style={styles.outgoingFileName} numberOfLines={1}>
                {file.fileName}
              </Text>
            </View>
          ),
        )}
        {message.body === '' ? null : (
          <Text
            style={[styles.bubbleText, media ? styles.bubbleTextTheirs : styles.bubbleTextMine]}
          >
            {message.body}
          </Text>
        )}
        <View style={styles.outgoingFooter}>
          <Text
            style={[styles.bubbleTime, media ? styles.bubbleTimeTheirs : styles.bubbleTimeMine]}
          >
            {clock(message.createdAt)}
          </Text>
          {failed ? null : (
            <Text
              style={[styles.outgoingState, media ? styles.bubbleTimeTheirs : null]}
              accessibilityLiveRegion="polite"
            >
              Sending…
            </Text>
          )}
        </View>
        {failed ? (
          <View style={styles.outgoingFailure} accessibilityLiveRegion="polite">
            <Text style={styles.outgoingFailureText} numberOfLines={3}>
              Not sent. {message.failure ?? 'Check your connection.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry sending this message"
              onPress={() => onRetry(message)}
              hitSlop={8}
              style={({ pressed }) => [styles.retryPill, pressed ? styles.retryPillPressed : null]}
            >
              <Text style={styles.retryPillText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A picture in a thread. A stored URL can still fail — the object may be gone, or the bucket
 * unreachable — so a failed load says so and can be tried again, rather than leaving an empty
 * frame that looks like a rendering bug.
 */
function MessagePicture({
  attachment,
  onOpen,
  onLongPress,
}: {
  attachment: ChatAttachment;
  onOpen: (uri: string) => void;
  onLongPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const media = useChatMedia(attachment.id, attachment.thumbnailUrl === null ? 'full' : 'thumb');

  if (failed || media.state.kind === 'failed') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${safeImageName(attachment.fileName)}, try loading the picture again`}
        onPress={() => {
          setFailed(false);
          media.retry();
        }}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={({ pressed }) => [styles.pictureRetry, pressed ? styles.bubbleImagePressed : null]}
      >
        <ImageOff size={16} color={theme.colors.mutedForeground} accessible={false} />
        <View style={styles.pictureRetryText}>
          <Text style={styles.pictureRetryTitle}>Picture didn’t load</Text>
          <Text style={styles.pictureRetryHint}>Tap to try again</Text>
        </View>
        <RotateCw size={14} color={theme.colors.primaryAction} accessible={false} />
      </Pressable>
    );
  }

  if (media.state.kind === 'loading') {
    return (
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={[styles.bubbleImage, styles.pictureLoading]}
        accessible={false}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${safeImageName(attachment.fileName)}, open the picture`}
      onPress={() => onOpen(media.state.kind === 'ready' ? media.state.uri : '')}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => [pressed ? styles.bubbleImagePressed : null]}
    >
      <Image
        source={{ uri: media.state.uri }}
        accessibilityLabel={safeImageName(attachment.fileName)}
        style={styles.bubbleImage}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
}

/**
 * One stored message.
 *
 * Received messages name the person who wrote them (support staff have names, the shop's own
 * automation does not) and carry their attachments above the text, so a picture is never
 * separated from the sentence that explains it. Timestamps sit inside the bubble on its lighter
 * edge, where they stay readable on both the filled and the outlined surface.
 *
 * Press-and-hold anywhere on the bubble opens the message menu. A nested control (a picture, a
 * voice player, a file card, the quote) takes the touch before the bubble can, so each one passes
 * the same handler to its own long press; otherwise holding a media bubble would do nothing.
 */
export function Bubble({
  message,
  firstOfGroup,
  reactions,
  reactionsBusy,
  onOpenImage,
  onJump,
  onOpenMenu,
  onToggleReaction,
}: {
  message: ChatMessage;
  firstOfGroup: boolean;
  reactions: readonly ChatReactionSummaryItem[];
  reactionsBusy: boolean;
  onOpenImage: (image: ViewableImage) => void;
  onJump: (messageId: string) => void;
  onOpenMenu: (target: MenuTarget) => void;
  onToggleReaction: (message: ChatMessage, emoji: string) => void;
}) {
  const bubbleRef = useRef<HostInstance>(null);
  const mine = message.senderRole === 'customer';
  const menuEnabled = isReactable(message) || isReplyable(message);

  const openMenu = useCallback(
    (_event?: GestureResponderEvent) => {
      if (!menuEnabled) return;
      bubbleRef.current?.measureInWindow((x, y, width, height) => {
        onOpenMenu({ message, anchor: { x, y, width, height }, mine });
      });
    },
    [menuEnabled, message, mine, onOpenMenu],
  );

  if (message.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemLine}>{message.body}</Text>
      </View>
    );
  }

  const caption = mine || !firstOfGroup ? null : senderCaption(message);
  // Pictures, voice messages and files sit on a neutral surface with a thin border on both sides
  // of the thread: a blue fill behind a waveform or a file card reads as a heavy block.
  const media = message.attachments.length > 0;
  const filled = mine && !media;
  const text = visibleBody(message);
  const quote = message.replyTo ?? null;
  // A bubble with controls inside it leaves them reachable for a screen reader; a plain text
  // bubble is one element that offers the menu as a custom action.
  const hasControls = message.attachments.length > 0 || quote !== null;

  return (
    <View
      style={[
        styles.bubbleRow,
        mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
        firstOfGroup ? styles.bubbleRowFirst : null,
      ]}
    >
      <View style={styles.bubbleColumn}>
        <Pressable
          ref={bubbleRef}
          testID={`message-${message.id}`}
          onLongPress={openMenu}
          delayLongPress={LONG_PRESS_MS}
          disabled={!menuEnabled}
          accessible={!hasControls}
          accessibilityLabel={
            hasControls
              ? undefined
              : `Message from ${caption ?? (mine ? 'you' : 'Nilzora')}: ${text ?? ''}`
          }
          accessibilityHint={
            menuEnabled ? 'Press and hold for reactions, reply and more' : undefined
          }
          accessibilityActions={
            menuEnabled ? [{ name: 'longpress', label: 'Message options' }] : []
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') openMenu();
          }}
          style={[
            styles.bubble,
            filled ? styles.bubbleMine : media ? styles.bubbleMedia : styles.bubbleTheirs,
            media && mine ? styles.bubbleMediaMine : null,
          ]}
        >
          {caption === null ? null : (
            <Text style={styles.bubbleSender} numberOfLines={1}>
              {caption}
            </Text>
          )}
          {quote === null ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Go to the message from ${replyAuthor(quote)}`}
              onPress={() => onJump(quote.id)}
              onLongPress={openMenu}
              delayLongPress={LONG_PRESS_MS}
              disabled={quote.deleted}
              style={({ pressed }) => [styles.quote, pressed ? styles.quotePressed : null]}
            >
              <Text style={styles.quoteWho} numberOfLines={1}>
                {replyAuthor(quote)}
              </Text>
              <Text style={styles.quoteText} numberOfLines={1}>
                {quoteSnippet(quote)}
              </Text>
            </Pressable>
          )}
          {message.attachments.map((attachment) => {
            const kind = attachmentKindOf(attachment);
            if (kind === 'image') {
              return attachment.thumbnailUrl === null && attachment.url === null ? (
                <FileMessageCard
                  key={attachment.id}
                  attachment={attachment}
                  onLongPress={openMenu}
                />
              ) : (
                <MessagePicture
                  key={attachment.id}
                  attachment={attachment}
                  onLongPress={openMenu}
                  onOpen={(uri) => {
                    onOpenImage({ url: uri, name: attachment.fileName });
                  }}
                />
              );
            }
            if (kind === 'audio') {
              return (
                <VoiceMessageBubble
                  key={attachment.id}
                  attachment={attachment}
                  onLongPress={openMenu}
                />
              );
            }
            return (
              <FileMessageCard key={attachment.id} attachment={attachment} onLongPress={openMenu} />
            );
          })}
          {text === null ? null : (
            <Text
              style={[styles.bubbleText, filled ? styles.bubbleTextMine : styles.bubbleTextTheirs]}
            >
              {text}
            </Text>
          )}
          <View style={[styles.bubbleFooter, mine ? styles.bubbleFooterMine : null]}>
            <Text
              style={[styles.bubbleTime, filled ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}
            >
              {clock(message.createdAt)}
            </Text>
            {/* A stored message really is sent: it was committed before it was drawn. */}
            {mine ? (
              <Text
                style={[
                  styles.bubbleTime,
                  filled ? styles.bubbleTimeMine : styles.bubbleTimeTheirs,
                ]}
                accessibilityLabel="Sent"
                testID="message-sent"
              >
                Sent
              </Text>
            ) : null}
          </View>
        </Pressable>
        {isReactable(message) ? (
          <ReactionCounts
            message={message}
            summary={reactions}
            mine={mine}
            disabled={reactionsBusy}
            onToggle={onToggleReaction}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleImage: {
    width: 220,
    height: 165,
    borderRadius: theme.radii.sm,
    marginBottom: theme.spacing[1],
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  bubbleImagePressed: { opacity: 0.9 },
  pictureRetry: {
    width: 220,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[1],
    borderRadius: theme.radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  pictureRetryText: { flex: 1, gap: 1 },
  pictureRetryTitle: { ...theme.text.caption, color: theme.colors.foreground },
  pictureRetryHint: { ...theme.text.micro, color: theme.colors.mutedForeground },
  pictureLoading: { alignItems: 'center', justifyContent: 'center' },
  bubbleRow: { flexDirection: 'row', marginTop: 2 },
  bubbleRowFirst: { marginTop: theme.spacing[2] },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubbleColumn: { maxWidth: '82%' },
  bubble: {
    borderRadius: theme.radii.card,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  bubbleMine: { backgroundColor: theme.colors.primaryAction, borderBottomRightRadius: 6 },
  /** A message the server has not confirmed yet: visibly still in flight. */
  bubbleOutgoing: { opacity: 0.92 },
  bubbleTheirs: {
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleMedia: {
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleMediaMine: { borderBottomLeftRadius: theme.radii.card, borderBottomRightRadius: 6 },
  bubbleSender: {
    ...theme.text.micro,
    color: theme.colors.primary,
    marginBottom: 2,
  },
  bubbleText: { ...theme.text.body, fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: theme.colors.primaryActionForeground },
  bubbleTextTheirs: { color: theme.colors.foreground },
  bubbleTime: { ...theme.text.micro, textAlign: 'right' },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 3,
  },
  bubbleFooterMine: { justifyContent: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.78)' },
  bubbleTimeTheirs: { color: theme.colors.mutedForeground },
  outgoingFile: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
    marginBottom: theme.spacing[1],
  },
  outgoingFileName: { ...theme.text.caption, color: theme.colors.foreground },
  outgoingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing[2],
  },
  outgoingState: { ...theme.text.micro, color: 'rgba(255,255,255,0.78)' },
  outgoingFailure: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
    paddingTop: theme.spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.25)',
  },
  outgoingFailureText: { ...theme.text.micro, color: '#FFFFFF', lineHeight: 15 },
  retryPill: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.full,
    backgroundColor: '#FFFFFF',
  },
  retryPillPressed: { opacity: 0.8 },
  retryPillText: {
    ...theme.text.micro,
    color: theme.colors.primaryActionHover,
    fontWeight: theme.fontWeights.semibold,
  },
  systemRow: { alignItems: 'center', paddingVertical: theme.spacing[1] },
  systemLine: {
    ...theme.text.caption,
    color: theme.colors.mutedForeground,
    textAlign: 'center',
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  quotePressed: { opacity: 0.7 },
  quoteWho: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
  },
  quoteText: { color: theme.colors.mutedForeground, fontSize: 11 },
});
