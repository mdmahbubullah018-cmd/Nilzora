import type { ChatAttachment, ChatAttachmentType } from '@nilzora/contracts';
import {
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  CHAT_DOCUMENT_TYPES,
  CHAT_IMAGE_MAX_BYTES,
  chatMediaKindOf,
} from '@nilzora/contracts';
import {
  CircleAlert,
  FileText,
  Mic,
  Pause,
  Play,
  RotateCw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { theme } from '@/theme';
import { useChatMedia, useOpenChatDocument } from './chat-media';
import { useVoiceRecorder, voiceClock as clockOf, VOICE_MAX_LABEL } from './use-voice-recording';
import { claimVoiceAudio, releaseVoiceAudio } from './voice-playback';
import { VoiceWaveform } from './voice-waveform';
import { peaksOf, useWaveform } from './voice-waveforms';

/*
 * Media in a support conversation
 * -------------------------------
 * The recorder that replaces the composer's action row while a voice message is being made, and
 * the bubbles a thread uses to show what arrived: a picture, a file card, or an audio player
 * with real playback state.
 *
 * Every one of them is a view over the same upload the storefront and the admin workspace use —
 * the bytes go to `/api/v1/chat/conversations/<id>/attachments`, and the API decides whether this
 * account may attach to that thread. Nothing is recorded, picked or played without a deliberate
 * tap, and the microphone and its temporary file are released the moment the recorder closes.
 */

/**
 * One file the customer has chosen but not sent.
 *
 * Choosing a picture, a document or a recording only holds it: no upload is started, no
 * attachment row exists and no message is created. All of that happens when Send is pressed,
 * which is the single action the customer took.
 */
export interface SelectedAttachment {
  /** Local identity in this session, so one chip can be removed without touching the others. */
  localId: string;
  uri: string;
  name: string;
  contentType: ChatAttachmentType;
  byteSize: number;
  durationMs: number | null;
  /** Where this file is on its way to the server. Only an uploaded file has an id. */
  upload: FileUpload;
}

/** The state of one file's upload: waiting, on the wire, stored, or refused. */
export type FileUpload =
  | { status: 'ready' }
  | { status: 'uploading'; percent: number | null }
  | { status: 'uploaded'; id: string; fileName: string }
  | { status: 'failed'; message: string };

/** "1.4 MB" / "86 KB": a size in words, never a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** "PDF" / "DOCX" for a document chip, from its name. */
export function fileTypeLabel(name: string): string {
  return /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toUpperCase() ?? 'FILE';
}

/**
 * The files waiting to be sent, as a compact row of chips.
 *
 * A picture shows its own thumbnail; anything else shows its name and size in words. Removing one
 * leaves the rest alone, and "Clear all" empties the row — neither of which starts an upload,
 * because nothing has been uploaded yet.
 */
export function SelectedAttachmentRow({
  selected,
  onRemove,
  onClear,
  onRetry,
  disabled,
}: {
  selected: readonly SelectedAttachment[];
  onRemove: (localId: string) => void;
  onClear: () => void;
  /** Uploads one refused file again, on its own. */
  onRetry: (localId: string) => void;
  disabled: boolean;
}) {
  if (selected.length === 0) return null;
  return (
    <View style={styles.selectionRow}>
      <View style={styles.selectionHead}>
        <Text style={styles.selectionCount}>
          {selected.length} of {CHAT_ATTACHMENT_MAX_PER_MESSAGE} ready to send
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all selected files"
          disabled={disabled}
          onPress={onClear}
          hitSlop={8}
          style={({ pressed }) => [styles.clearAll, pressed ? styles.chipPressed : null]}
        >
          <Text style={styles.clearAllText}>Clear all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectionList}
        keyboardShouldPersistTaps="handled"
      >
        {selected.map((entry) => {
          const kind = chatMediaKindOf(entry.contentType);
          const { upload } = entry;
          return (
            <View
              key={entry.localId}
              style={[styles.selectionChip, upload.status === 'failed' ? styles.chipFailed : null]}
            >
              {kind === 'image' ? (
                <Image
                  source={{ uri: entry.uri }}
                  style={styles.selectionThumb}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={styles.selectionIcon}>
                  {kind === 'audio' ? (
                    <Mic size={14} color={theme.colors.mutedForeground} />
                  ) : (
                    <FileText size={14} color={theme.colors.mutedForeground} />
                  )}
                </View>
              )}
              <View style={styles.selectionText}>
                <Text style={styles.selectionName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.selectionMeta} numberOfLines={1}>
                  {entry.durationMs === null
                    ? `${kind === 'document' ? `${fileTypeLabel(entry.name)} · ` : ''}${formatBytes(entry.byteSize)}`
                    : `${String(Math.max(1, Math.round(entry.durationMs / 1000)))}s`}
                </Text>
                {upload.status === 'uploading' ? (
                  <View accessibilityLiveRegion="polite">
                    <View style={styles.chipTrack}>
                      <View
                        style={[styles.chipProgress, { width: `${upload.percent ?? 0}%` }]}
                        testID="chip-progress"
                      />
                    </View>
                    <Text style={styles.selectionMeta}>
                      {upload.percent === null
                        ? 'Uploading…'
                        : `Uploading ${String(upload.percent)}%`}
                    </Text>
                  </View>
                ) : null}
                {upload.status === 'uploaded' ? (
                  <Text style={styles.chipUploaded}>Uploaded</Text>
                ) : null}
                {upload.status === 'failed' ? (
                  <Text style={styles.chipError} numberOfLines={2} accessibilityLiveRegion="polite">
                    {upload.message}
                  </Text>
                ) : null}
              </View>
              {upload.status === 'failed' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Retry uploading ${entry.name}`}
                  disabled={disabled}
                  onPress={() => onRetry(entry.localId)}
                  hitSlop={8}
                  style={styles.selectionRemove}
                >
                  <RotateCw size={14} color={theme.colors.primaryAction} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entry.name}`}
                disabled={disabled || upload.status === 'uploading'}
                onPress={() => onRemove(entry.localId)}
                hitSlop={8}
                style={styles.selectionRemove}
              >
                <X size={12} color={theme.colors.mutedForeground} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** One finished take, held in memory until the customer sends it or throws it away. */
interface VoiceTake {
  uri: string;
  durationMs: number;
  contentType: string;
  byteSize: number;
  /** Input levels measured while recording (0–1); what the waveform is drawn from. */
  levels?: readonly number[];
}

/** How a voice take is getting on once the customer pressed Send. */
export interface VoiceSendState {
  busy: boolean;
  /** Real bytes sent so far, when the platform reports them. */
  percent: number | null;
  failure: string | null;
}

/**
 * The recorder. It owns the microphone for as long as it is mounted and hands back a recording;
 * the caller uploads it and decides when the bar closes.
 *
 * `autoStart` begins recording as the bar opens, which is the customer's own tap on the
 * microphone button: that tap is what asks for the permission, and nothing records before it. If
 * the permission is refused the bar says why and points at Settings.
 */
export function VoiceRecorderBar({
  onSend,
  onCancel,
  sending,
  autoStart = false,
}: {
  onSend: (recording: {
    uri: string;
    durationMs: number;
    contentType: string;
    byteSize: number;
    levels?: readonly number[];
  }) => void;
  onCancel: () => void;
  sending: VoiceSendState;
  autoStart?: boolean;
}) {
  const recorder = useVoiceRecorder();
  const [saving, setSaving] = useState(false);
  // Set once the take is stopped. The recording is played back from here, never uploaded
  // before the customer has heard it and pressed Send. A take the recorder ended itself at the
  // length ceiling arrives the same way.
  const [kept, setKept] = useState<VoiceTake | null>(null);
  const take = kept ?? recorder.finished;
  const startRecording = recorder.start;
  const started = useRef(false);

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void startRecording();
  }, [autoStart, startRecording]);

  const stopAndKeep = useCallback(async () => {
    setSaving(true);
    const recorded = await recorder.stop();
    setSaving(false);
    if (recorded !== null) setKept(recorded);
  }, [recorder]);

  if (take !== null) {
    return (
      <VoiceTakePreview
        take={take}
        sending={sending}
        onSend={() => onSend(take)}
        onDiscard={() => {
          // Stops playback, deletes the temporary file and closes the recorder.
          recorder.cancel();
          onCancel();
        }}
      />
    );
  }

  return (
    <View style={styles.recorder}>
      <View style={styles.recorderRow}>
        <View style={styles.recordingDot} />
        <Text style={styles.recorderClock}>
          {recorder.phase === 'recording'
            ? recorder.clock
            : recorder.phase === 'paused'
              ? 'Paused'
              : 'Ready'}
        </Text>
        <Text style={styles.recorderLimit}>max {VOICE_MAX_LABEL}</Text>
      </View>

      <View style={styles.recorderControls}>
        {recorder.phase === 'idle' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            onPress={() => void recorder.start()}
            style={styles.recorderPrimary}
          >
            <Mic size={18} color={theme.colors.primaryActionForeground} />
          </Pressable>
        ) : recorder.phase === 'recording' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pause recording"
            onPress={recorder.pause}
            style={styles.recorderSecondary}
          >
            <Pause size={18} color={theme.colors.foreground} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Resume recording"
            onPress={recorder.resume}
            style={styles.recorderSecondary}
          >
            <Play size={18} color={theme.colors.foreground} />
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop and keep the recording"
          onPress={() => void stopAndKeep()}
          disabled={recorder.phase === 'idle' || saving}
          style={[styles.recorderSecondary, recorder.phase === 'idle' ? styles.disabled : null]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.colors.foreground} />
          ) : (
            <Square size={16} color={theme.colors.foreground} />
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel the recording"
          onPress={() => {
            recorder.cancel();
            onCancel();
          }}
          style={styles.recorderSecondary}
        >
          <Trash2 size={16} color={theme.notice.danger.icon} />
        </Pressable>
      </View>

      {recorder.failure === null ? null : (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.failure}>{recorder.failure}</Text>
          {recorder.denied ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              accessibilityHint="Opens the phone settings where the microphone can be allowed"
              onPress={() => void Linking.openSettings().catch(() => undefined)}
              style={styles.settingsLink}
            >
              <Text style={styles.settingsLinkText}>Open settings</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * The stopped take, played back before anything is uploaded: play/pause, where the playback is,
 * and the two decisions that matter — send it, or throw it away. Nothing leaves the phone until
 * Send is pressed. Send is the one step: it uploads (with the real byte progress) and posts, and
 * if the upload fails the same button becomes a retry.
 */
function VoiceTakePreview({
  take,
  sending,
  onSend,
  onDiscard,
}: {
  take: VoiceTake;
  sending: VoiceSendState;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const { busy } = sending;
  const player = useAudioPlayer(take.uri, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const pauseSelf = useCallback(() => player.pause(), [player]);
  const peaks = peaksOf(take.levels ?? []);

  // A preview never outlives its card, and never lets the recorder keep the audio focus.
  useEffect(
    () => () => {
      releaseVoiceAudio(pauseSelf);
      player.pause();
    },
    [pauseSelf, player],
  );

  const total = status.duration > 0 ? Math.round(status.duration * 1000) : take.durationMs;
  const position = Math.round((status.currentTime ?? 0) * 1000);
  const fraction = total === 0 ? 0 : Math.min(1, position / total);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      releaseVoiceAudio(pauseSelf);
      return;
    }
    claimVoiceAudio(pauseSelf);
    player.play();
  };

  const failed = sending.failure !== null && !busy;

  return (
    <View style={styles.recorder} testID="voice-preview">
      <View style={styles.recorderRow}>
        <Mic size={14} color={theme.colors.primary} />
        <Text style={styles.recorderClock}>
          {position > 0 ? `${clockOf(position)} / ${clockOf(total)}` : clockOf(total)}
        </Text>
        <Text style={styles.recorderLimit}>
          {busy
            ? sending.percent === null
              ? 'Sending…'
              : `Sending ${String(sending.percent)}%`
            : 'Listen, then send'}
        </Text>
      </View>

      <View style={styles.recorderControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause the recording' : 'Play the recording'}
          accessibilityHint="Plays the voice message you just recorded, before it is sent"
          onPress={toggle}
          style={styles.recorderPrimary}
        >
          {status.playing ? (
            <Pause size={18} color={theme.colors.primaryActionForeground} />
          ) : (
            <Play size={18} color={theme.colors.primaryActionForeground} />
          )}
        </Pressable>

        <VoiceWaveform
          peaks={peaks.length > 0 ? peaks : null}
          progress={fraction}
          label="Position in the recording"
          onSeek={(at) => {
            if (total > 0) void player.seekTo((at * total) / 1000);
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard the recording"
          disabled={busy}
          onPress={onDiscard}
          style={[styles.recorderSecondary, busy ? styles.disabled : null]}
        >
          <Trash2 size={16} color={theme.notice.danger.icon} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={failed ? 'Retry sending the voice message' : 'Send the voice message'}
          accessibilityHint="Uploads the recording and sends it as a voice message"
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onSend}
          style={[styles.recorderPrimary, busy ? styles.disabled : null]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.primaryActionForeground} />
          ) : failed ? (
            <RotateCw size={16} color={theme.colors.primaryActionForeground} />
          ) : (
            <Send size={16} color={theme.colors.primaryActionForeground} />
          )}
        </Pressable>
      </View>

      {sending.failure === null ? null : (
        <Text style={styles.failure} accessibilityLiveRegion="polite">
          {sending.failure}
        </Text>
      )}
    </View>
  );
}

/** A voice message in the thread: play, pause, position, and the length it claims. */
export function VoiceMessageBubble({
  attachment,
  onLongPress,
}: {
  attachment: ChatAttachment;
  /** Press-and-hold anywhere on the bubble opens the message menu, like the text around it. */
  onLongPress?: () => void;
}) {
  const media = useChatMedia(attachment.id, 'full');
  const localUri = media.state.kind === 'ready' ? media.state.uri : null;
  const player = useAudioPlayer(localUri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const pauseSelf = useCallback(() => player.pause(), [player]);
  const peaks = useWaveform(attachment.id);
  // Leaving the thread (or unmounting the row) gives the audio slot back, so a later voice
  // note is never blocked by a player nobody can see.
  useEffect(() => {
    return () => releaseVoiceAudio(pauseSelf);
  }, [pauseSelf]);
  const total =
    status.duration > 0 ? Math.round(status.duration * 1000) : (attachment.durationMs ?? 0);
  const position = Math.round((status.currentTime ?? 0) * 1000);

  if (media.state.kind === 'failed') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try loading the voice message again"
        onPress={media.retry}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={styles.fileCard}
      >
        <RotateCw size={16} color={theme.colors.primaryAction} />
        <Text style={styles.fileName} numberOfLines={1}>
          Voice message didn’t load. Tap to try again.
        </Text>
      </Pressable>
    );
  }

  if (attachment.url === null) {
    return (
      <View style={styles.fileCard}>
        <Mic size={16} color={theme.colors.mutedForeground} />
        <Text style={styles.fileName} numberOfLines={1}>
          {attachment.fileName}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.audioCard} testID="voice-message">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause the voice message' : 'Play the voice message'}
        onPress={() => {
          if (localUri === null) {
            media.retry();
            return;
          }
          if (status.playing) {
            player.pause();
            releaseVoiceAudio(pauseSelf);
            return;
          }
          // One voice message at a time: starting this one pauses whatever was playing.
          claimVoiceAudio(pauseSelf);
          player.play();
        }}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        hitSlop={8}
        style={styles.audioButton}
      >
        {status.isBuffering ? (
          <ActivityIndicator size="small" color={theme.colors.foreground} />
        ) : status.playing ? (
          <Pause size={16} color={theme.colors.foreground} fill={theme.colors.foreground} />
        ) : (
          <Play size={16} color={theme.colors.foreground} fill={theme.colors.foreground} />
        )}
      </Pressable>
      <View style={styles.audioBody}>
        <VoiceWaveform
          peaks={peaks}
          progress={total === 0 ? 0 : Math.min(1, position / total)}
          disabled={localUri === null}
          label="Position in the voice message"
          onSeek={(at) => {
            if (localUri !== null && total > 0) void player.seekTo((at * total) / 1000);
          }}
          onLongPress={onLongPress}
          delayLongPress={LONG_PRESS_MS}
        />
        <Text style={styles.audioClock}>
          {position > 0 ? `${clockOf(position)} / ${clockOf(total)}` : clockOf(total)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Anything that is not a picture or a recording: a card that says what the file is, and opens it.
 *
 * Opening downloads the file with the account's own token (a private file has no public address)
 * and hands it to the platform: the share sheet on iOS, the folder chooser on Android. See
 * `open-chat-file.ts`. The outcome is said on the card instead of in a dialog.
 */
export function FileMessageCard({
  attachment,
  onLongPress,
}: {
  attachment: ChatAttachment;
  onLongPress?: () => void;
}) {
  const open = useOpenChatDocument();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const contents = (
    <>
      <View style={styles.fileIcon}>
        <FileText size={18} color={theme.colors.foreground} />
      </View>
      <View style={styles.fileCardText}>
        <Text style={styles.fileName} numberOfLines={1}>
          {attachment.fileName}
        </Text>
        <Text style={styles.fileMeta}>
          {fileTypeLabel(attachment.fileName)} · {formatBytes(attachment.byteSize)}
        </Text>
      </View>
      {attachment.url === null ? null : busy ? (
        <ActivityIndicator size="small" color={theme.colors.primaryAction} />
      ) : (
        <View style={styles.fileOpenPill}>
          <Text style={styles.fileOpen}>Open</Text>
        </View>
      )}
    </>
  );

  // A file whose URL the API could not resolve stays a plain label rather than a button that does
  // nothing.
  if (attachment.url === null) return <View style={styles.fileCard}>{contents}</View>;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${attachment.fileName}`}
        accessibilityHint="Downloads the file and opens it in another app"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        onPress={() => {
          setBusy(true);
          setNote(null);
          setFailed(false);
          void open(attachment).then((result) => {
            setBusy(false);
            if (result.kind === 'saved') {
              setNote('Saved to the folder you chose. Open it from your Files app.');
            } else if (result.kind === 'failed') {
              setNote(result.message);
              setFailed(true);
            }
          });
        }}
        style={({ pressed }) => [styles.fileCard, pressed ? styles.fileCardPressed : null]}
      >
        {contents}
      </Pressable>
      {note === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.fileNote, failed ? styles.fileNoteFailed : null]}
        >
          {note}
        </Text>
      )}
    </View>
  );
}

/** The label a message's own row shows for an attachment it could not render inline. */
export function AttachmentNotice({ message }: { message: string }) {
  return (
    <View style={styles.notice}>
      <CircleAlert size={12} color={theme.notice.danger.icon} />
      <Text style={styles.failure}>{message}</Text>
    </View>
  );
}

/** The kinds this app can show inline, so the bubble picks the right view. */
export function attachmentKindOf(attachment: ChatAttachment): 'image' | 'audio' | 'document' {
  const kind = chatMediaKindOf(attachment.contentType);
  if (kind === 'image') return 'image';
  if (kind === 'audio') return 'audio';
  return 'document';
}

/** The sizes the sheet advertises, from the shared contract rather than a local guess. */
export const MEDIA_LIMITS = {
  imageBytes: CHAT_IMAGE_MAX_BYTES,
  documentTypes: CHAT_DOCUMENT_TYPES,
} as const;

/** How long a press is held before it counts as the message menu rather than a tap. */
export const LONG_PRESS_MS = 350;

const styles = StyleSheet.create({
  selectionRow: { gap: 4, paddingBottom: 6 },
  selectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionCount: { color: theme.colors.mutedForeground, fontSize: 11 },
  clearAll: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 },
  clearAllText: { color: theme.colors.primaryAction, fontSize: 11, fontWeight: '600' },
  chipPressed: { opacity: 0.7 },
  selectionList: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  selectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    // The remove / retry buttons inside are full 44 dp targets, so the chip is at least that tall.
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    paddingLeft: 6,
    paddingVertical: 0,
  },
  selectionThumb: { width: 32, height: 32, borderRadius: 6 },
  selectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  selectionText: { flexShrink: 1, maxWidth: 120 },
  selectionName: { color: theme.colors.foreground, fontSize: 11, fontWeight: '500' },
  selectionMeta: { color: theme.colors.mutedForeground, fontSize: 10 },
  selectionRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  recorder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  recorderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.notice.danger.icon,
  },
  recorderClock: { ...theme.text.body, color: theme.colors.foreground },
  recorderLimit: {
    ...theme.text.caption,
    color: theme.colors.mutedForeground,
    marginLeft: 'auto',
    flexShrink: 1,
  },
  // `flexWrap` is the safety net at 320 dp: the controls drop to a second line before they could
  // run past the card. Every control keeps its full 44 dp size either way.
  recorderControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  recorderPrimary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  recorderSecondary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  disabled: { opacity: 0.4 },
  failure: { ...theme.text.caption, color: theme.notice.danger.icon, flexShrink: 1 },
  // A neutral player: no filled colour block, a thin-ringed play button and the waveform.
  audioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    width: 236,
    maxWidth: '100%',
    paddingVertical: 2,
  },
  audioButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  audioBody: { flex: 1, minWidth: 0 },
  audioClock: { ...theme.text.micro, color: theme.colors.mutedForeground, marginTop: -6 },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    width: 240,
    maxWidth: '100%',
    minHeight: theme.touchTarget + 8,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[1],
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  fileCardPressed: { backgroundColor: theme.colors.surfaceMuted },
  fileCardText: { flex: 1, minWidth: 0 },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  fileOpenPill: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  fileOpen: { ...theme.text.micro, color: theme.colors.foreground, fontWeight: '600' },
  fileNote: { ...theme.text.micro, color: theme.colors.mutedForeground, maxWidth: 240 },
  fileNoteFailed: { color: theme.colors.fieldError },
  settingsLink: { minHeight: 44, justifyContent: 'center' },
  settingsLinkText: { ...theme.text.caption, color: theme.colors.primaryAction, fontWeight: '600' },
  chipFailed: { borderColor: theme.colors.fieldError },
  chipTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
    marginTop: 2,
  },
  chipProgress: { height: 3, backgroundColor: theme.colors.primary },
  chipUploaded: { color: theme.colors.success, fontSize: 10 },
  chipError: { color: theme.colors.fieldError, fontSize: 10 },
  fileName: { ...theme.text.body, color: theme.colors.foreground, fontWeight: '600', fontSize: 14 },
  fileMeta: { ...theme.text.micro, color: theme.colors.mutedForeground },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surfaceMuted,
    maxWidth: '100%',
  },
  chipText: { ...theme.text.micro, color: theme.colors.foreground, flexShrink: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
});
