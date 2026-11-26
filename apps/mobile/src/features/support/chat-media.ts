import type { ChatAttachment } from '@nilzora/contracts';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';
import { useAuthorizedApi } from '@/query/use-authorized-api';
import { openChatDocument, type OpenChatFileResult } from './open-chat-file';

/*
 * Private chat media, on the device
 * ---------------------------------
 * Support attachments are private: the API answers a message with its own authorized path, and
 * the bytes are served only to a signed-in account that may read that conversation. React
 * Native's image and audio components cannot attach a bearer token to a plain URI, and putting
 * a token in a URL would leak it into logs and caches.
 *
 * So a file is fetched once with the session's own token, written to this app's private cache
 * directory, and rendered from that local path. The map below keeps one entry per attachment
 * variant so re-opening a conversation does not download the same picture again; the operating
 * system may clear the cache at any time, and a missing file is simply fetched again.
 *
 * Nothing is stored outside the app's cache, no token is persisted, and a failure is a state a
 * bubble can show and retry rather than a blank frame.
 */

/** Extensions let the platform pick a codec or a decoder from the file it is handed. */
function extensionFor(contentType: string): string {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  return known[type] ?? 'bin';
}

/** One downloaded variant, remembered for the life of the process. */
const ready = new Map<string, string>();

type Run = ReturnType<typeof useAuthorizedApi>;

/** Downloads one variant with the account's token into the cache and answers its local path. */
async function downloadToCache(
  run: Run,
  attachmentId: string,
  variant: 'full' | 'thumb',
): Promise<string> {
  return run(async (api, token) => {
    const downloaded = await api.chatAttachmentMedia(token, attachmentId, variant);
    const target = new File(
      Paths.cache,
      `chat-${attachmentId}-${variant}.${extensionFor(downloaded.contentType)}`,
    );
    if (target.exists) target.delete();
    target.create();
    await target.write(downloaded.bytes);
    return target.uri;
  });
}

/**
 * The local path of a picture, fetched when it is not already in the cache. Used by the message
 * menu's "View picture", which opens the full-size file from outside any bubble.
 */
export function useChatMediaUri(): (attachmentId: string) => Promise<string> {
  const run = useAuthorizedApi();
  return useCallback(
    async (attachmentId: string) => {
      const key = `${attachmentId}:full`;
      const cached = ready.get(key);
      if (cached !== undefined && new File(cached).exists) return cached;
      const uri = await downloadToCache(run, attachmentId, 'full');
      ready.set(key, uri);
      return uri;
    },
    [run],
  );
}

export type ChatMediaState =
  { kind: 'loading' } | { kind: 'ready'; uri: string } | { kind: 'failed' };

export interface ChatMedia {
  state: ChatMediaState;
  /** Tries again after a failure (or after the cache was cleared). */
  retry: () => void;
}

export function useChatMedia(
  attachmentId: string,
  variant: 'full' | 'thumb' = 'full',
  enabled = true,
): ChatMedia {
  const run = useAuthorizedApi();
  const key = `${attachmentId}:${variant}`;
  const [state, setState] = useState<ChatMediaState>(() => {
    const cached = ready.get(key);
    return cached === undefined ? { kind: 'loading' } : { kind: 'ready', uri: cached };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const cached = ready.get(key);
    if (cached !== undefined && new File(cached).exists) return;
    if (cached !== undefined) ready.delete(key);

    let cancelled = false;
    void (async () => {
      try {
        const file = await downloadToCache(run, attachmentId, variant);
        if (cancelled) return;
        ready.set(key, file);
        setState({ kind: 'ready', uri: file });
      } catch {
        if (!cancelled) setState({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachmentId, attempt, enabled, key, run, variant]);

  const retry = useCallback(() => {
    ready.delete(key);
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, [key]);

  return { state, retry };
}

/**
 * Downloads a document with the account's own token and hands it to the platform (share sheet on
 * iOS, the viewer app on Android with a save-to-folder fallback). See `open-chat-file.ts`.
 */
export function useOpenChatDocument(): (attachment: ChatAttachment) => Promise<OpenChatFileResult> {
  const run = useAuthorizedApi();
  return useCallback(
    (attachment: ChatAttachment) =>
      openChatDocument(attachment, () =>
        run((api, token) => api.chatAttachmentMedia(token, attachment.id, 'full')),
      ),
    [run],
  );
}
