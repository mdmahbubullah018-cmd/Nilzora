import type { ChatAttachment, ChatMessage, ChatReplySummary } from '@nilzora/contracts';
import {
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import * as Clipboard from 'expo-clipboard';
import { Headset, WifiOff } from 'lucide-react-native';
import { LogoMark } from '@/components/logo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenFrame } from '@/components/screen';
import { describeApiError } from '@/lib/errors';
import { describeUploadError } from '@/uploads/use-upload';
import { pickSupportDocument } from '@/uploads/pick-document';
import { useOnline } from '@/network/connectivity';
import { theme } from '@/theme';
import { AttachSheet, ComposerAction } from './chat-composer';
import { ChatReviewCard } from './chat-review-card';
import { ConversationContext } from './conversation-context';
import {
  AttachmentNotice,
  SelectedAttachmentRow,
  VoiceRecorderBar,
  attachmentKindOf,
  type FileUpload,
  type SelectedAttachment,
  type VoiceSendState,
} from './media-sheet';
import { pickChatImages, type ChatImageSource } from './pick-chat-image';
import { useChatMediaUri, useOpenChatDocument } from './chat-media';
import { ChatImageViewer, type ViewableImage } from './chat-image-viewer';
import { MessageActionOverlay, type MenuTarget } from './message-actions';
import { Bubble, OutgoingBubble, quoteOf, replyAuthor } from './message-bubble';
import { feedbackTargetId, isReplyable, quoteSnippet } from './message-model';
import {
  FailureNote,
  MessageFeedback,
  PinnedStrip,
  RatingCard,
  SendButton,
  useReportMessage,
} from './support-extras';
import {
  useSupportPins,
  useSupportReactions,
  useDiscardSupportAttachment,
  usePostSupportMessage,
  useSupportMyFeedback,
  useToggleSupportReaction,
  useUploadSupportMedia,
  type PickedMedia,
} from './use-support-extras';
import {
  useOlderSupportMessages,
  newClientMessageId,
  useMarkSupportRead,
  useSendSupportMessage,
  useSetSupportStatus,
  useSupportConversation,
  useSupportMessages,
} from './use-support';
import { StatusPill } from './status-pill';
import { SwipeToReply } from './swipe-to-reply';
import { rememberWaveform } from './voice-waveforms';
import { useSupportSocket } from './use-support-socket';
import {
  removeOutgoing,
  timelineRows,
  updateOutgoing,
  type OutgoingAttachment,
  type OutgoingMessage,
  type TimelineRow,
} from './optimistic-messages';

/** The day a message belongs to, for the dividers between days in a long thread. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** When a row happened, whichever kind it is. */
function rowTime(row: TimelineRow): string {
  return row.message.createdAt;
}

/** Who wrote a row, so consecutive messages from one sender group together. */
function rowSender(row: TimelineRow): string {
  return row.kind === 'outgoing' ? 'customer' : (row.message.senderId ?? row.message.senderRole);
}

/** The first attachment of a kind on a message, for the menu's "View picture" / "Open file". */
function firstAttachment(
  message: ChatMessage,
  kinds: readonly ReturnType<typeof attachmentKindOf>[],
): ChatAttachment | undefined {
  return message.attachments.find((attachment) => kinds.includes(attachmentKindOf(attachment)));
}

const NO_VOICE_SEND: VoiceSendState = { busy: false, percent: null, failure: null };

/**
 * One conversation. Render inside <SignedInGate>; the id comes from the route and is the
 * only thing this screen says about which thread it wants — the API decides whether this
 * account may read it.
 *
 * The composer has one attach button (photo library, camera, files, in a sheet), the message
 * field, and one round button that is the microphone while there is nothing to send and Send once
 * there is. Pressing and holding a message opens its reaction bar and action list. There is no
 * call interface: the chat has no real-time voice channel, so nothing here pretends otherwise.
 */
export function SupportConversationScreen({ conversationId }: { conversationId: string }) {
  const online = useOnline();
  const conversation = useSupportConversation(conversationId);
  const messages = useSupportMessages(conversationId);
  const send = useSendSupportMessage(conversationId);
  /** The message the next send answers, or null for a plain one. */
  const [replyTarget, setReplyTarget] = useState<ChatReplySummary | null>(null);
  const post = usePostSupportMessage(conversationId);
  const discard = useDiscardSupportAttachment();
  const pins = useSupportPins(conversationId);
  const reactions = useSupportReactions(conversationId);
  const toggleReaction = useToggleSupportReaction(conversationId);
  const markRead = useMarkSupportRead();
  const socket = useSupportSocket(conversationId);
  const report = useReportMessage();
  const loadOlderPage = useOlderSupportMessages();
  const setStatus = useSetSupportStatus(conversationId);
  const fetchPictureUri = useChatMediaUri();
  const openDocument = useOpenChatDocument();

  const [draft, setDraft] = useState('');
  /** Files chosen but not sent; each carries its own upload state. */
  const [selected, setSelected] = useState<SelectedAttachment[]>([]);
  /** The picture opened from a bubble, shown full screen until dismissed. */
  const [viewer, setViewer] = useState<ViewableImage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceSend, setVoiceSend] = useState<VoiceSendState>(NO_VOICE_SEND);
  /** "Uploading 2 of 3" while Send is working, null otherwise. */
  const [sendingMedia, setSendingMedia] = useState<string | null>(null);
  const [mediaFailure, setMediaFailure] = useState<string | null>(null);
  const uploadMedia = useUploadSupportMedia(conversationId);
  const [failure, setFailure] = useState<string | null>(null);
  /** Messages the customer just sent: shown at once, reconciled when the API answers. */
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** The message whose reaction bar and action list are open. */
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [reactionFailure, setReactionFailure] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  /** Set the instant a reaction starts, so two quick taps cannot both be sent. */
  const reactingRef = useRef(false);
  /** One upload pipeline at a time: Send, a retry and a voice send share it. */
  const busyRef = useRef(false);
  /** A short confirmation or refusal that does not deserve a dialog. */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The reply the customer just rated, kept on screen so it can say thanks. */
  const [ratedId, setRatedId] = useState<string | null>(null);
  const listRef = useRef<FlatList<TimelineRow>>(null);
  /** True while the thread is scrolled to the newest message. */
  const atBottomRef = useRef(true);
  /**
   * True while the reader's finger (or its momentum) is moving the list. A long thread renders
   * its rows in chunks, so the content keeps growing after it opens and the list fires scroll
   * events of its own; only the reader's scrolling may decide that they left the newest message.
   */
  const dragRef = useRef(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (followTimer.current !== null) clearTimeout(followTimer.current);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const judgeScroll = useCallback(
    ({
      contentOffset,
      contentSize,
      layoutMeasurement,
    }: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    }) => {
      // Within a screenful of the end counts as "reading the newest message".
      atBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
    },
    [],
  );
  const lastMarkedRef = useRef(0);
  const markReadRef = useRef(markRead.mutate);

  useEffect(() => {
    markReadRef.current = markRead.mutate;
  }, [markRead.mutate]);

  const newestSeq = messages.data?.messages.at(-1)?.seq ?? null;
  useEffect(() => {
    if (newestSeq === null || newestSeq <= lastMarkedRef.current) return;
    lastMarkedRef.current = newestSeq;
    markReadRef.current({ conversationId, seq: newestSeq });
  }, [conversationId, newestSeq]);

  // Newer first from the API; the thread reads oldest first, with anything loaded earlier
  // in front of the current page. Memoised on the query's own array, so `loadOlder` keeps a
  // stable identity between renders instead of rebuilding its dependencies every time.
  const page = messages.data?.messages;
  const rows = useMemo(() => [...older, ...(page ?? [])], [older, page]);
  /** Everything the timeline draws, in order: stored messages first, then local ones. */
  const timeline = useMemo(() => timelineRows(rows, outgoing), [outgoing, rows]);

  const subjectStatus = conversation.data?.conversation.status ?? null;
  const asksForFeedback = subjectStatus === 'resolved' || subjectStatus === 'closed';
  const myFeedback = useSupportMyFeedback(conversationId, asksForFeedback);
  /** The one reply that may ask "Was this helpful?", or null (see `feedbackTargetId`). */
  const feedbackId = useMemo(
    () =>
      myFeedback.isSuccess
        ? feedbackTargetId(
            conversation.data?.conversation ?? null,
            rows,
            new Set(myFeedback.data.feedback.map((entry) => entry.messageId)),
          )
        : null,
    [conversation.data, myFeedback.data, myFeedback.isSuccess, rows],
  );

  /** How many more files this message can take. */
  const slots = CHAT_ATTACHMENT_MAX_PER_MESSAGE - selected.length;

  /**
   * Adds a chosen file to the row above the composer.
   *
   * This is the whole of "selection": the file stays on the device, the same ceiling the API
   * enforces is checked here so the customer hears about it immediately, and nothing is uploaded.
   */
  const addSelected = useCallback(
    (input: {
      uri: string;
      name: string;
      contentType: PickedMedia['contentType'];
      byteSize: number;
      durationMs?: number;
    }) => {
      const kind = chatMediaKindOf(input.contentType);
      if (kind === null) {
        setMediaFailure('That file type cannot be sent.');
        return;
      }
      if (input.byteSize > chatMediaMaxBytes(kind)) {
        setMediaFailure(`${input.name} is larger than ${chatMediaMaxLabel(kind)}.`);
        return;
      }
      if (input.byteSize <= 0) {
        setMediaFailure(`${input.name} is empty.`);
        return;
      }
      setSelected((current) => {
        if (current.length >= CHAT_ATTACHMENT_MAX_PER_MESSAGE) {
          setMediaFailure(
            `A message carries at most ${String(CHAT_ATTACHMENT_MAX_PER_MESSAGE)} files.`,
          );
          return current;
        }
        setMediaFailure(null);
        return [
          ...current,
          {
            localId: newClientMessageId(),
            uri: input.uri,
            name: input.name,
            contentType: input.contentType,
            byteSize: input.byteSize,
            durationMs: input.durationMs ?? null,
            upload: { status: 'ready' },
          },
        ];
      });
    },
    [],
  );

  const patchFile = useCallback((localId: string, upload: FileUpload) => {
    setSelected((current) =>
      current.map((file) => (file.localId === localId ? { ...file, upload } : file)),
    );
  }, []);

  /** Throws away an upload the customer decided against. Best effort: the server sweeps orphans. */
  const discardUpload = useCallback(
    (file: SelectedAttachment) => {
      if (file.upload.status === 'uploaded') discard.mutate(file.upload.id);
    },
    [discard],
  );

  /**
   * Opens the photo library or the camera. Pictures go straight into the row above the composer,
   * where each one is a preview chip that can be removed on its own.
   */
  const choosePicture = useCallback(
    async (source: ChatImageSource) => {
      setMediaFailure(null);
      if (slots <= 0) {
        setMediaFailure(
          `A message carries at most ${String(CHAT_ATTACHMENT_MAX_PER_MESSAGE)} files.`,
        );
        return;
      }
      const picked = await pickChatImages(source, slots);
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'refused') {
        setMediaFailure(picked.message);
        return;
      }
      for (const image of picked.images) addSelected(image);
    },
    [addSelected, slots],
  );

  /** Points the composer at one message, which is what makes the next send a reply. */
  const openReply = useCallback((message: ChatMessage) => {
    setReplyTarget(quoteOf(message));
  }, []);

  // The thread has no scroll-to-index here, and a stored message may sit on a page that is not
  // loaded: the quote names the author and the first line instead, which is what the reader needs.
  const jumpToMessage = useCallback((messageId: string) => {
    void messageId;
  }, []);

  const chooseDocument = useCallback(() => {
    setMediaFailure(null);
    if (slots <= 0) {
      setMediaFailure(
        `A message carries at most ${String(CHAT_ATTACHMENT_MAX_PER_MESSAGE)} files.`,
      );
      return;
    }
    void (async () => {
      const picked = await pickSupportDocument();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'refused') {
        setMediaFailure(picked.message);
        return;
      }
      addSelected(picked.document);
    })();
  }, [addSelected, slots]);

  const loadOlder = useCallback(async () => {
    const oldest = rows[0];
    if (oldest === undefined || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await loadOlderPage(conversationId, oldest.seq);
      setOlder((current) => [...result, ...current]);
    } catch {
      setFailure('Earlier messages could not be loaded.');
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadOlderPage, loadingOlder, rows]);

  /**
   * Sends one local message, by id. Used both by the first attempt and by "Retry": the id is the
   * server's deduplication key, so pressing retry after a lost answer cannot post twice. The files
   * are already uploaded by now, so a retry only repeats the post and never uploads again.
   */
  const deliver = useCallback(
    async (message: OutgoingMessage) => {
      setFailure(null);
      setOutgoing((current) =>
        updateOutgoing(current, message.clientMessageId, { status: 'sending', failure: null }),
      );
      try {
        const replyToId = message.reply === null ? null : message.reply.id;
        const attachmentIds = message.attachments.map((file) => file.id);
        if (attachmentIds.length === 0) {
          await send.mutateAsync({
            clientMessageId: message.clientMessageId,
            body: message.body,
            replyToId,
          });
        } else {
          await post.mutateAsync({
            clientMessageId: message.clientMessageId,
            body: message.body === '' ? undefined : message.body,
            attachmentIds,
            replyToId,
          });
        }
        setOutgoing((current) => removeOutgoing(current, message.clientMessageId));
      } catch (error) {
        setOutgoing((current) =>
          updateOutgoing(current, message.clientMessageId, {
            status: 'failed',
            failure: describeApiError(error).message,
          }),
        );
      }
    },
    [post, send],
  );

  /**
   * Uploads one chosen file, reporting real byte progress on its chip. Answers the stored file,
   * or the sentence to show when it failed; a failure leaves the chip in place with its own Retry.
   */
  const uploadFile = useCallback(
    async (file: SelectedAttachment): Promise<OutgoingAttachment | string> => {
      patchFile(file.localId, { status: 'uploading', percent: null });
      try {
        const stored = await uploadMedia.mutateAsync({
          uri: file.uri,
          name: file.name,
          contentType: file.contentType,
          byteSize: file.byteSize,
          durationMs: file.durationMs ?? undefined,
          onProgress: (percent) => patchFile(file.localId, { status: 'uploading', percent }),
        });
        patchFile(file.localId, { status: 'uploaded', id: stored.id, fileName: stored.fileName });
        return { id: stored.id, fileName: stored.fileName, localUri: file.uri };
      } catch (error) {
        const message = describeUploadError(error).message;
        patchFile(file.localId, { status: 'failed', message });
        return message;
      }
    },
    [patchFile, uploadMedia],
  );

  /** Puts a finished upload on screen as a local message and sends it. */
  const sendUploaded = useCallback(
    (attachments: OutgoingAttachment[], body: string) => {
      const message: OutgoingMessage = {
        clientMessageId: newClientMessageId(),
        body,
        createdAt: new Date().toISOString(),
        attachments,
        reply: replyTarget,
        baseSeq: rows.at(-1)?.seq ?? 0,
        status: 'sending',
        failure: null,
      };
      setOutgoing((current) => [...current, message]);
      setReplyTarget(null);
      socket.notifyStoppedTyping();
      return deliver(message);
    },
    [deliver, replyTarget, rows, socket],
  );

  /**
   * The single Send action. Files are still local at this point, so this is where they go up: one
   * request each, in the order they were chosen, and only when every one of them has an id does
   * the message itself get posted with all of those ids.
   *
   * A file that already uploaded is never uploaded again. A failure keeps the draft and every
   * chip, marks the one that failed with its own Retry, and leaves the earlier uploads in place so
   * pressing Send again only sends what is missing.
   */
  const submit = useCallback(() => {
    const body = draft.trim();
    if ((body === '' && selected.length === 0) || busyRef.current) return;
    if (send.isPending || post.isPending) return;
    const files = selected;
    busyRef.current = true;
    setMediaFailure(null);
    void (async () => {
      try {
        const attachments: OutgoingAttachment[] = [];
        for (const [index, file] of files.entries()) {
          if (file.upload.status === 'uploaded') {
            attachments.push({
              id: file.upload.id,
              fileName: file.upload.fileName,
              localUri: file.uri,
            });
            continue;
          }
          setSendingMedia(`Uploading ${String(index + 1)} of ${String(files.length)}…`);
          const stored = await uploadFile(file);
          // The failed chip says why and has its own Retry; the draft and the rest stay put.
          if (typeof stored === 'string') return;
          attachments.push(stored);
        }
        setSendingMedia(null);
        setDraft('');
        setSelected([]);
        // The post has its own state and its own Retry; the upload pipeline is free again.
        void sendUploaded(attachments, body);
      } finally {
        setSendingMedia(null);
        busyRef.current = false;
      }
    })();
  }, [draft, post.isPending, selected, send.isPending, sendUploaded, uploadFile]);

  /** Uploads one file that failed, on its own, without sending anything. */
  const retryFile = useCallback(
    (localId: string) => {
      const file = selected.find((entry) => entry.localId === localId);
      if (file === undefined || busyRef.current) return;
      busyRef.current = true;
      setMediaFailure(null);
      void uploadFile(file).finally(() => {
        busyRef.current = false;
      });
    },
    [selected, uploadFile],
  );

  /**
   * The voice message's one-step send: upload with its length and real byte progress, then post.
   * A failed upload leaves the take in the player with a retry; a failed post becomes a local
   * message with its own Retry, which re-posts the same client id without uploading again.
   */
  const sendVoice = useCallback(
    (recording: {
      uri: string;
      durationMs: number;
      contentType: string;
      byteSize: number;
      levels?: readonly number[];
    }) => {
      if (busyRef.current || voiceSend.busy) return;
      busyRef.current = true;
      setVoiceSend({ busy: true, percent: null, failure: null });
      void (async () => {
        try {
          const stored = await uploadMedia.mutateAsync({
            uri: recording.uri,
            name: `voice-${String(Date.now())}.m4a`,
            contentType: recording.contentType as PickedMedia['contentType'],
            byteSize: recording.byteSize,
            durationMs: recording.durationMs,
            onProgress: (percent) => setVoiceSend({ busy: true, percent, failure: null }),
          });
          // The levels measured while recording draw this message's waveform on this phone.
          void rememberWaveform(stored.id, recording.levels ?? []);
          setVoiceSend(NO_VOICE_SEND);
          setVoiceOpen(false);
          void sendUploaded([{ id: stored.id, fileName: stored.fileName, localUri: null }], '');
        } catch (error) {
          setVoiceSend({ busy: false, percent: null, failure: describeUploadError(error).message });
        } finally {
          busyRef.current = false;
        }
      })();
    },
    [sendUploaded, uploadMedia, voiceSend.busy],
  );

  const retry = useCallback(
    (message: OutgoingMessage) => {
      void deliver(message);
    },
    [deliver],
  );

  // ---- the long-press menu -------------------------------------------------------------

  const closeMenu = useCallback(() => {
    setMenu(null);
    setReactionFailure(null);
  }, []);

  /**
   * Adds, changes or removes the customer's reaction. The server keeps one per account per
   * message and toggles the same emoji off, so this only says which emoji was tapped. A second
   * tap while the first is still saving is ignored.
   */
  const react = useCallback(
    (message: ChatMessage, emoji: string) => {
      if (reactingRef.current) return;
      reactingRef.current = true;
      setReacting(true);
      setReactionFailure(null);
      toggleReaction.mutate(
        { messageId: message.id, emoji },
        {
          onSuccess: () => closeMenu(),
          onError: (error) => {
            const text = describeApiError(error).message;
            setReactionFailure(text);
            say(`Could not react. ${text}`);
          },
          onSettled: () => {
            reactingRef.current = false;
            setReacting(false);
          },
        },
      );
    },
    [closeMenu, say, toggleReaction],
  );

  const copyText = useCallback(
    (text: string) => {
      closeMenu();
      void Clipboard.setStringAsync(text).then(
        () => say('Copied'),
        () => say('Could not copy this message.'),
      );
    },
    [closeMenu, say],
  );

  const viewPicture = useCallback(
    (message: ChatMessage) => {
      const picture = firstAttachment(message, ['image']);
      closeMenu();
      if (picture === undefined) return;
      void fetchPictureUri(picture.id).then(
        (uri) => setViewer({ url: uri, name: picture.fileName }),
        () => say('The picture could not be opened. Try again.'),
      );
    },
    [closeMenu, fetchPictureUri, say],
  );

  const openFile = useCallback(
    (message: ChatMessage) => {
      const file = firstAttachment(message, ['document', 'audio']);
      closeMenu();
      if (file === undefined) return;
      say('Preparing the file…');
      void openDocument(file).then((result) => {
        if (result.kind === 'saved') say('Saved to the folder you chose.');
        else if (result.kind === 'failed') say(result.message);
        else setToast(null);
      });
    },
    [closeMenu, openDocument, say],
  );

  const reportMessage = useCallback(
    (message: ChatMessage) => {
      closeMenu();
      report(message.id);
    },
    [closeMenu, report],
  );

  const replyFromMenu = useCallback(
    (message: ChatMessage) => {
      closeMenu();
      openReply(message);
    },
    [closeMenu, openReply],
  );

  /** A tap on a reaction count under a bubble: the customer's own, added or taken back. */
  const reactFromCount = useCallback(
    (message: ChatMessage, emoji: string) => react(message, emoji),
    [react],
  );

  const reactionSummary = reactions.data?.reactions;
  const myEmoji =
    menu === null
      ? null
      : (reactionSummary?.find((item) => item.messageId === menu.message.id && item.mine)?.emoji ??
        null);

  const subject = conversation.data?.conversation.subject ?? 'Conversation';
  const canReply = conversation.data?.viewer.canReply ?? true;
  const rating = conversation.data?.conversation.csatRating ?? null;
  // Who holds the thread, so a customer can tell an automatic answer from a person's.
  const assigneeId = conversation.data?.conversation.assigneeId ?? null;
  const assigneeName =
    assigneeId === null
      ? null
      : (conversation.data?.participants.find((person) => person.userId === assigneeId)?.name ??
        'A teammate');
  const takeover =
    assigneeId !== null
      ? `${assigneeName ?? 'A teammate'} is handling this`
      : subjectStatus === 'pending'
        ? 'Waiting for a teammate'
        : null;
  const busySending = send.isPending || post.isPending;
  const uploading = sendingMedia !== null || selected.some((f) => f.upload.status === 'uploading');
  /** The round button on the right is Send once there is something to send, the microphone before. */
  const showSend = draft.trim() !== '' || selected.length > 0;
  const statusText =
    socket.connection === 'live'
      ? socket.typingName !== null
        ? `${socket.typingName} is typing…`
        : 'Nilzora support · Live'
      : socket.connection === 'connecting'
        ? 'Connecting…'
        : 'Offline — your message still sends';
  const listExtra = useMemo(
    () => ({ reactionSummary, reacting, feedbackId, ratedId }),
    [feedbackId, ratedId, reactionSummary, reacting],
  );

  return (
    <ScreenFrame edges={['bottom']} liftForKeyboard>
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <LogoMark size={24} decorative />
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
              {subject}
            </Text>
            {subjectStatus === null ? null : <StatusPill status={subjectStatus} />}
          </View>
          <View style={styles.statusRow}>
            {socket.connection === 'offline' ? (
              <WifiOff size={11} color={theme.colors.mutedForeground} accessible={false} />
            ) : (
              <View
                style={[
                  styles.statusDot,
                  socket.connection === 'live' ? styles.statusDotLive : styles.statusDotWaiting,
                ]}
              />
            )}
            <Text style={styles.status} numberOfLines={1}>
              {statusText}
            </Text>
          </View>
          {takeover === null ? null : (
            <Text style={styles.takeover} numberOfLines={1}>
              {takeover}
            </Text>
          )}
        </View>
      </View>

      <PinnedStrip pins={pins.data?.messages ?? []} />

      {/* Pinned: which product and order this thread is about, however far they scroll. */}
      <ConversationContext detail={conversation.data} />
      <ChatReviewCard detail={conversation.data} />

      {messages.isError ? (
        <Text style={styles.error}>{describeApiError(messages.error).message}</Text>
      ) : messages.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={timeline}
          extraData={listExtra}
          keyExtractor={(item) => item.key}
          renderItem={({ item, index }) => {
            const previous = index === 0 ? undefined : timeline[index - 1];
            const newDay =
              previous === undefined || dayLabel(rowTime(previous)) !== dayLabel(rowTime(item));
            const firstOfGroup =
              newDay || previous === undefined || rowSender(previous) !== rowSender(item);
            return (
              <View>
                {newDay ? (
                  <Text style={styles.dayDivider} accessibilityRole="text">
                    {dayLabel(rowTime(item))}
                  </Text>
                ) : null}
                {item.kind === 'stored' ? (
                  <SwipeToReply
                    enabled={isReplyable(item.message)}
                    onReply={() => openReply(item.message)}
                  >
                    <Bubble
                      message={item.message}
                      firstOfGroup={firstOfGroup}
                      reactions={reactionSummary ?? []}
                      reactionsBusy={reacting}
                      onOpenImage={setViewer}
                      onJump={jumpToMessage}
                      onOpenMenu={(target) => {
                        setReactionFailure(null);
                        setMenu(target);
                      }}
                      onToggleReaction={reactFromCount}
                    />
                  </SwipeToReply>
                ) : (
                  <OutgoingBubble message={item.message} onRetry={retry} />
                )}
                {item.kind === 'stored' &&
                (item.message.id === feedbackId || item.message.id === ratedId) ? (
                  <MessageFeedback
                    message={item.message}
                    conversationId={conversationId}
                    onRated={setRatedId}
                  />
                ) : null}
              </View>
            );
          }}
          contentContainerStyle={styles.list}
          onScrollBeginDrag={() => {
            dragRef.current = true;
          }}
          onMomentumScrollBegin={() => {
            dragRef.current = true;
          }}
          onMomentumScrollEnd={(event) => {
            judgeScroll(event.nativeEvent);
            dragRef.current = false;
          }}
          onScrollEndDrag={(event) => {
            judgeScroll(event.nativeEvent);
            // A fling continues as momentum, which sets the flag again.
            dragRef.current = false;
          }}
          onScroll={(event) => {
            if (dragRef.current) judgeScroll(event.nativeEvent);
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            // Follow new content until the reader scrolls away from the newest message, so a
            // thread opens at its end however many rows are still being laid out, and scrolling
            // back through history is never yanked to the bottom.
            if (!atBottomRef.current) return;
            listRef.current?.scrollToEnd({ animated: false });
            // Rows that were not laid out yet only had an estimated height, so the first jump can
            // stop short of the real end; once they have been measured, jump again.
            if (followTimer.current !== null) clearTimeout(followTimer.current);
            followTimer.current = setTimeout(() => {
              if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
            }, 350);
          }}
          keyboardShouldPersistTaps="handled"
          onLayout={() => {
            // The list gets shorter when the keyboard opens (the frame lifts the composer). A
            // reader who was at the newest message stays there instead of having it slide under
            // the composer.
            if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          ListHeaderComponent={
            timeline.length === 0 ? undefined : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadOlder()}
                disabled={loadingOlder}
                style={styles.older}
              >
                <Text style={styles.olderText}>
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </Text>
              </Pressable>
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon} accessible={false}>
                <Headset size={26} color={theme.colors.primaryAction} strokeWidth={1.6} />
              </View>
              <Text style={styles.emptyTitle}>Say hello</Text>
              <Text style={styles.emptyBody}>
                Ask about an order, a delivery or a return. A real person from Nilzora replies here.
              </Text>
            </View>
          }
        />
      )}

      {subjectStatus === 'resolved' || subjectStatus === 'closed' ? (
        <RatingCard conversationId={conversationId} rating={rating} />
      ) : null}

      {failure === null ? null : (
        <View style={styles.retryRow}>
          <FailureNote message={failure} />
        </View>
      )}

      {toast === null ? null : (
        <View style={styles.toast} accessibilityLiveRegion="polite" testID="chat-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {subjectStatus === 'resolved' ? (
        <Text style={styles.resolvedNote}>
          Our team marked this resolved. Reply here if you still need help.
        </Text>
      ) : null}

      {canReply && subjectStatus !== 'closed' ? (
        <View style={styles.composer}>
          <AttachSheet
            visible={attachOpen}
            slots={Math.max(0, slots)}
            onClose={() => setAttachOpen(false)}
            onPickLibrary={() => void choosePicture('library')}
            onPickCamera={() => void choosePicture('camera')}
            onPickFile={chooseDocument}
          />
          {voiceOpen ? (
            <VoiceRecorderBar
              autoStart
              sending={voiceSend}
              onCancel={() => {
                setVoiceOpen(false);
                setVoiceSend(NO_VOICE_SEND);
              }}
              onSend={sendVoice}
            />
          ) : null}

          <SelectedAttachmentRow
            selected={selected}
            disabled={sendingMedia !== null}
            onRemove={(localId) => {
              const file = selected.find((entry) => entry.localId === localId);
              if (file !== undefined) discardUpload(file);
              setSelected((current) => current.filter((entry) => entry.localId !== localId));
            }}
            onClear={() => {
              for (const file of selected) discardUpload(file);
              setSelected([]);
            }}
            onRetry={retryFile}
          />
          {sendingMedia === null ? null : (
            <Text style={styles.uploadNote} accessibilityLiveRegion="polite">
              {sendingMedia}
            </Text>
          )}
          {mediaFailure === null ? null : <AttachmentNotice message={mediaFailure} />}

          {replyTarget === null ? null : (
            <View style={styles.replyBar}>
              <View style={styles.replyBarText}>
                <Text style={styles.replyBarWho} numberOfLines={1}>
                  Answering {replyAuthor(replyTarget)}
                </Text>
                <Text style={styles.replyBarSnippet} numberOfLines={1}>
                  {quoteSnippet(replyTarget)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop answering this message"
                onPress={() => setReplyTarget(null)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.replyBarClose,
                  pressed ? styles.replyBarClosePressed : null,
                ]}
              >
                <Text style={styles.replyBarCloseText}>✕</Text>
              </Pressable>
            </View>
          )}

          {voiceOpen ? null : (
            <View style={styles.inputRow}>
              <ComposerAction
                icon="attach"
                label="Attach"
                hint="Opens the photo library, the camera or your files"
                disabled={busySending || uploading}
                onPress={() => {
                  setMediaFailure(null);
                  setAttachOpen(true);
                }}
              />
              <TextInput
                value={draft}
                onChangeText={(value) => {
                  setDraft(value);
                  if (value.trim() !== '') socket.notifyTyping();
                }}
                placeholder="Write a message…"
                placeholderTextColor={theme.colors.mutedForeground}
                multiline
                maxLength={4000}
                accessibilityLabel="Message"
                style={styles.input}
              />
              {showSend ? (
                <SendButton disabled={uploading || !online} busy={busySending} onPress={submit} />
              ) : (
                <ComposerAction
                  icon="mic"
                  label="Record a voice message"
                  hint="Starts recording a voice note. This is not a phone call"
                  disabled={busySending || uploading}
                  onPress={() => {
                    setMediaFailure(null);
                    setVoiceSend(NO_VOICE_SEND);
                    setVoiceOpen(true);
                  }}
                />
              )}
            </View>
          )}
        </View>
      ) : subjectStatus === 'closed' ? (
        <View style={styles.closedPanel}>
          <Text style={styles.closedText}>
            This conversation is closed. Reopen it to write again, or start a new one from Support.
          </Text>
          {setStatus.isError ? (
            <Text style={styles.error}>{describeApiError(setStatus.error).message}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reopen this conversation"
            accessibilityState={{ disabled: setStatus.isPending, busy: setStatus.isPending }}
            disabled={setStatus.isPending}
            onPress={() => setStatus.mutate('open')}
            style={({ pressed }) => [styles.reopen, pressed ? styles.reopenPressed : null]}
          >
            {setStatus.isPending ? (
              <ActivityIndicator color={theme.colors.primaryActionForeground} />
            ) : (
              <Text style={styles.reopenText}>Reopen conversation</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Text style={styles.closed}>
          You can read this conversation, but it no longer takes replies.
        </Text>
      )}

      <MessageActionOverlay
        target={menu}
        myEmoji={myEmoji}
        reacting={reacting}
        failure={reactionFailure}
        onReact={react}
        onReply={replyFromMenu}
        onCopy={copyText}
        onReport={reportMessage}
        onViewPicture={viewPicture}
        onOpenFile={openFile}
        onClose={closeMenu}
      />
      <ChatImageViewer image={viewer} onClose={() => setViewer(null)} />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  headerText: { flex: 1, gap: 2 },
  title: { ...theme.text.subheading, color: theme.colors.foreground, flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusDotLive: { backgroundColor: theme.colors.success },
  statusDotWaiting: { backgroundColor: theme.colors.warning },
  status: { ...theme.text.caption, color: theme.colors.mutedForeground, flexShrink: 1 },
  takeover: { ...theme.text.micro, color: theme.colors.primary },
  loading: { paddingVertical: theme.spacing[8], alignItems: 'center' },
  older: { alignItems: 'center', paddingVertical: theme.spacing[2] },
  olderText: { ...theme.text.micro, color: theme.colors.primary },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1],
  },
  toast: {
    alignSelf: 'center',
    maxWidth: '90%',
    marginBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.foreground,
  },
  toastText: { ...theme.text.caption, color: theme.colors.surface },
  list: { padding: theme.spacing[4], paddingBottom: theme.spacing[3], flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[10],
  },
  emptyIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
    marginBottom: theme.spacing[1],
  },
  emptyTitle: { ...theme.text.subheading, color: theme.colors.foreground },
  emptyBody: {
    ...theme.text.body,
    color: theme.colors.mutedForeground,
    textAlign: 'center',
  },
  dayDivider: {
    ...theme.text.micro,
    color: theme.colors.mutedForeground,
    textAlign: 'center',
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  composer: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    backgroundColor: theme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  replyBarText: { flex: 1 },
  replyBarWho: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
  replyBarSnippet: { color: theme.colors.mutedForeground, fontSize: 12 },
  replyBarClose: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBarClosePressed: { opacity: 0.7 },
  replyBarCloseText: { color: theme.colors.mutedForeground, fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing[2] },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    ...theme.text.body,
    fontSize: 15,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  uploadNote: { ...theme.text.caption, color: theme.colors.mutedForeground },
  error: {
    ...theme.text.caption,
    color: theme.colors.fieldError,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1],
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  resolvedNote: {
    ...theme.text.caption,
    color: theme.colors.mutedForeground,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    textAlign: 'center',
  },
  closedPanel: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  closedText: { ...theme.text.body, color: theme.colors.mutedForeground, textAlign: 'center' },
  reopen: {
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.primaryAction,
  },
  reopenPressed: { opacity: 0.85 },
  reopenText: { ...theme.text.bodyStrong, color: theme.colors.primaryActionForeground },
  closed: {
    ...theme.text.caption,
    color: theme.colors.mutedForeground,
    padding: theme.spacing[4],
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
