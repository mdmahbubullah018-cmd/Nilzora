import {
  CHAT_IMAGE_MAX_BYTES,
  chatAttachmentUploadSchema,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
  type ChatAttachmentType,
  type ChatCsatResponse,
  type ChatMessageFeedback,
  type ChatMessagePage,
  type ChatMyFeedbackResponse,
  type ChatPinnedMessagesResponse,
  type ChatReactionResponse,
  type ChatReactionSummaryResponse,
  type ChatReportResponse,
  type ChatSearchResponse,
  type PostedChatMessage,
} from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMobileApiBaseUrl } from '@/auth/api';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { uploadPictureNative } from '@/uploads/native-upload';
import { queryKeys } from '@/query/query-keys';
import { useAuthorizedApi } from '@/query/use-authorized-api';
import { appendStoredMessage, postedToStored } from './optimistic-messages';

/*
 * Support chat, Phase 2
 * ---------------------
 * Pins, reactions, satisfaction, reporting, search and picture upload.
 *
 * Every call names only the conversation or the message; the access token the session
 * manager supplies is the identity, and the API decides whether this account may read or
 * write the row. A failure is a refusal from the server, never something the app decides.
 */

export function useSupportPins(conversationId: string | null) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.support.pins(userId, conversationId ?? 'none'),
    queryFn: ({ signal }) =>
      run<ChatPinnedMessagesResponse>((api, token) =>
        api.listChatPinnedMessages(token, conversationId ?? '', { signal }),
      ),
    enabled: userId !== null && conversationId !== null,
  });
}

export function useSupportReactions(conversationId: string | null) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.support.reactions(userId, conversationId ?? 'none'),
    queryFn: ({ signal }) =>
      run<ChatReactionSummaryResponse>((api, token) =>
        api.listChatReactionSummary(token, conversationId ?? '', { signal }),
      ),
    enabled: userId !== null && conversationId !== null,
  });
}

/** Adds or removes the caller's reaction, then re-reads the tallies for the thread. */
export function useToggleSupportReaction(conversationId: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      run<ChatReactionResponse>((api, token) =>
        api.toggleChatMessageReaction(token, conversationId, input.messageId, input.emoji),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.reactions(userId, conversationId),
      });
    },
  });
}

/** The customer's own verdicts on a thread's replies, so an answered prompt stays hidden. */
export function useSupportMyFeedback(conversationId: string | null, enabled: boolean) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: myFeedbackKey(userId, conversationId ?? 'none'),
    queryFn: ({ signal }) =>
      run<ChatMyFeedbackResponse>((api, token) =>
        api.listMyChatFeedback(token, conversationId ?? '', { signal }),
      ),
    enabled: enabled && userId !== null && conversationId !== null,
  });
}

function myFeedbackKey(userId: string | null, conversationId: string) {
  return [...queryKeys.support.all(userId), 'my-feedback', conversationId] as const;
}

/**
 * Rates one support reply helpful or not, separately from the conversation's CSAT. The answer is
 * written straight into the verdict list (so the prompt disappears at once) and the list is then
 * re-read, so the stored verdict, not the local guess, is what survives a reload.
 */
export function useSubmitMessageFeedback(conversationId: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      messageId: string;
      verdict: 'helpful' | 'not_helpful';
      comment?: string | undefined;
    }) =>
      run<ChatMessageFeedback>((api, token) =>
        api.submitChatMessageFeedback(token, input.messageId, {
          verdict: input.verdict,
          ...(input.comment === undefined ? {} : { comment: input.comment }),
        }),
      ),
    onSuccess: (saved) => {
      const key = myFeedbackKey(userId, conversationId);
      queryClient.setQueryData<ChatMyFeedbackResponse>(key, (current) => ({
        feedback: [
          ...(current?.feedback ?? []).filter((entry) => entry.messageId !== saved.messageId),
          { messageId: saved.messageId, verdict: saved.verdict },
        ],
      }));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Rates a resolved conversation. The API keeps the first answer and refuses an open one. */
export function useSubmitSupportRating(conversationId: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: number; comment?: string | undefined }) =>
      run<ChatCsatResponse>((api, token) => api.submitChatCsat(token, conversationId, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.conversation(userId, conversationId),
      });
    },
  });
}

/** Reports one message from the thread the customer is reading. */
export function useReportSupportMessage() {
  const run = useAuthorizedApi();
  return useMutation({
    mutationFn: (input: {
      messageId: string;
      reason: 'spam' | 'abuse' | 'personal_information' | 'other';
      details?: string | undefined;
    }) =>
      run<ChatReportResponse>((api, token) =>
        api.reportChatMessage(token, input.messageId, {
          reason: input.reason,
          details: input.details,
        }),
      ),
  });
}

/** Message-body search across the threads this account may read. */
export function useSearchSupportMessages(query: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const text = query.trim();
  return useQuery({
    queryKey: queryKeys.support.search(userId, text),
    queryFn: ({ signal }) =>
      run<ChatSearchResponse>((api, token) =>
        api.searchChatMessages(token, { q: text, limit: 30 }, { signal }),
      ),
    enabled: userId !== null && text.length >= 2,
  });
}

/**
 * Posts a message with the pictures it carries, in one call. Using this instead of the plain
 * send keeps the message and its upload atomic: either both are stored or neither is.
 *
 * As with `useSendSupportMessage`, the stored message is merged into the cached page instead of
 * triggering a full thread refetch.
 */
export function usePostSupportMessage(conversationId: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      clientMessageId: string;
      body?: string | undefined;
      attachmentIds?: string[] | undefined;
      replyToId?: string | null | undefined;
    }) =>
      run<PostedChatMessage>((api, token) =>
        api.postChatMessage(token, {
          conversationId,
          clientMessageId: input.clientMessageId,
          body: input.body,
          attachmentIds: input.attachmentIds,
          replyToId: input.replyToId,
        }),
      ),
    onSuccess: (result) => {
      queryClient.setQueryData<ChatMessagePage>(
        queryKeys.support.messages(userId, conversationId),
        (page) => appendStoredMessage(page, postedToStored(result)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.conversations(userId) });
    },
  });
}

/** Discards an upload the customer decided not to send. */
export function useDiscardSupportAttachment() {
  const run = useAuthorizedApi();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      run((api, token) => api.discardChatAttachment(token, attachmentId)),
  });
}

export interface PickedPicture {
  uri: string;
  name: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
}

/** One file of any allowed kind, ready to upload. */
export interface PickedMedia {
  uri: string;
  name: string;
  contentType: ChatAttachmentType;
  byteSize: number;
  /** A recording's length, so the message shows it before the audio loads. */
  durationMs?: number;
}

export interface UploadedAttachment {
  id: string;
  fileName: string;
}

/**
 * What the picker may hand over. The app uploads pictures through the picture picker, so its
 * ceiling is the picture one (CHAT_IMAGE_MAX_BYTES), not the larger document ceiling: a 15 MB
 * photo would be re-encoded on the server anyway, and refusing it on the phone saves the whole
 * transfer.
 */
export const SUPPORT_PICTURE_MAX_BYTES = CHAT_IMAGE_MAX_BYTES;

/** The same ceiling for the message a person reads, so it cannot drift from the check. */
export const SUPPORT_PICTURE_MAX_LABEL = `${Math.round(SUPPORT_PICTURE_MAX_BYTES / (1024 * 1024))} MB`;

/**
 * Uploads one file — picture, document or voice recording — to the conversation's own
 * attachment slot and answers its id, which is then posted with the message. The API generates
 * the object key, so the app cannot aim an upload at another thread, and it checks the bytes
 * against the type they claim; this hook only refuses what the contract already forbids.
 *
 * The transfer goes through the platform upload task, so the progress the screen shows is the
 * native layer's real byte count rather than a guess.
 */
export function useUploadSupportMedia(conversationId: string) {
  const { manager } = useSession();
  return useMutation({
    mutationFn: async (
      input: PickedMedia & {
        signal?: AbortSignal | undefined;
        onProgress?: (percent: number) => void;
      },
    ): Promise<UploadedAttachment> => {
      const kind = chatMediaKindOf(input.contentType);
      if (kind === null) throw new Error('That file type cannot be sent.');
      const limit = chatMediaMaxBytes(kind);
      if (input.byteSize > limit) {
        throw new Error(`That file is larger than ${chatMediaMaxLabel(kind)}.`);
      }
      const baseUrl = getMobileApiBaseUrl();
      if (baseUrl === null || manager === null) {
        throw new Error('Nilzora cannot be reached right now.');
      }
      const accessToken = await manager.authorized((token) => Promise.resolve(token));

      const query = new URLSearchParams({ fileName: input.name });
      if (kind === 'audio' && input.durationMs !== undefined) {
        query.set('durationMs', String(Math.max(1, Math.round(input.durationMs))));
      }

      return uploadPictureNative<UploadedAttachment>({
        url: `${baseUrl}/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/attachments?${query.toString()}`,
        accessToken,
        uri: input.uri,
        contentType: input.contentType,
        parse: (body) => {
          const parsed = chatAttachmentUploadSchema.safeParse(body);
          return parsed.success ? { id: parsed.data.id, fileName: parsed.data.fileName } : null;
        },
        onProgress: (progress) => input.onProgress?.(progress.percent),
        onSent: () => input.onProgress?.(100),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  });
}

/** The picture-only form of the upload, kept for the review and avatar flows. */
export function useUploadSupportAttachment(conversationId: string) {
  const upload = useUploadSupportMedia(conversationId);
  return {
    ...upload,
    mutate: (
      input: PickedPicture & {
        signal?: AbortSignal | undefined;
        onProgress?: (percent: number) => void;
      },
      options?: Parameters<typeof upload.mutate>[1],
    ) => upload.mutate(input, options),
    isPending: upload.isPending,
  };
}
