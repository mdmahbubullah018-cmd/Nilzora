import {
  imageSearchResponseSchema,
  type ImageSearchResponse,
  type ImageSearchSort,
} from '@nilzora/contracts';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useState } from 'react';
import { getMobileApiBaseUrl } from '@/auth/api';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { uploadPictureNative, UploadTransferError } from '@/uploads/native-upload';
import { cropRect, outputSize, type CropGesture } from './image-crop';

/*
 * The mobile visual-search data path
 * ----------------------------------
 * Three small pieces, no screen knowledge:
 *
 *  - `preparePhoto` crops and compresses on the device with expo-image-manipulator, so the
 *    phone uploads a 1024 px JPEG instead of a 4 MB camera original.
 *  - `useVisualSearch` runs a search (or a "find similar") and keeps its state, so a screen
 *    can show the skeleton, the error and the result without repeating the plumbing.
 *  - `recordSearchClick` is best effort: a tap already navigated, so a failed log write must
 *    not surface.
 *
 * The picture travels as the request body with the app's native upload task — the same
 * transport every other upload in this app uses. It is the platform's own HTTP stack, so a
 * cached `file://` picture can be streamed straight from disk, and the API reads a raw
 * `image/jpeg` body on this route.
 */

export interface PreparedPhoto {
  uri: string;
  width: number;
  height: number;
  /** What the upload carries; always JPEG after preparation. */
  type: 'image/jpeg';
  name: string;
}

/** Crops the chosen picture to the frame and re-encodes it at 80% as a JPEG. */
export async function preparePhoto(input: {
  uri: string;
  image: { width: number; height: number };
  frameSize: number;
  gesture: CropGesture;
}): Promise<PreparedPhoto> {
  const rect = cropRect(input.image, input.frameSize, input.gesture);
  const size = outputSize(rect);
  const context = ImageManipulator.manipulate(input.uri)
    .crop({ originX: rect.originX, originY: rect.originY, width: rect.width, height: rect.height })
    .resize({ width: size.width, height: size.height });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return {
    uri: uploadUri(saved.uri),
    width: saved.width,
    height: saved.height,
    type: 'image/jpeg',
    name: 'search.jpg',
  };
}

/**
 * React Native's uploader opens the part with `uri` straight through to the file system, so it has
 * to carry a scheme. expo-image-manipulator returns a `file://` URL on Android today, but a bare
 * path is just as valid for `Image`, and a part without a scheme makes the whole request fail at
 * the transport layer rather than with the API's own refusal.
 */
function uploadUri(uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  return `file://${uri.startsWith('/') ? '' : '/'}${uri}`;
}

export interface VisualSearchState {
  status: 'idle' | 'searching' | 'ready' | 'error';
  result: ImageSearchResponse | null;
  error: string | null;
  /** True when retrying the same request makes sense (network, rate limit, server). */
  retryable: boolean;
}

const IDLE: VisualSearchState = { status: 'idle', result: null, error: null, retryable: false };

/** Sort and paging for the upload, which carries only the picture in its body. */
function searchQuery(input: { sort: ImageSearchSort; page: number }): string {
  const params = new URLSearchParams({
    sort: input.sort,
    page: String(input.page),
    pageSize: '24',
    client: 'android',
  });
  return `?${params.toString()}`;
}

const MESSAGE = {
  invalid: 'That photo could not be read. Try another one.',
  offline: 'You are offline. Reconnect and try again.',
  rate_limited: 'Too many image searches. Wait a moment, then try again.',
  disabled: 'Image search is not available at the moment.',
  preparing: 'Image search is still being prepared. Try again shortly.',
  unavailable: 'Image search could not answer. Check your connection and try again.',
  notConfigured: 'This app build has no API address, so image search cannot run.',
} as const;

export function useVisualSearch() {
  const api = useApi();
  const [state, setState] = useState<VisualSearchState>(IDLE);

  const messageFor = useCallback((error: unknown): { message: string; retryable: boolean } => {
    if (error instanceof ApiNotConfiguredError) {
      return { message: MESSAGE.notConfigured, retryable: false };
    }
    if (error instanceof UploadTransferError) {
      return { message: MESSAGE.offline, retryable: true };
    }
    const status = (error as { status?: number }).status ?? 0;
    const code = (error as { code?: string }).code ?? '';
    if (status === 429) return { message: MESSAGE.rate_limited, retryable: true };
    if (code === 'image_search_disabled') return { message: MESSAGE.disabled, retryable: false };
    if (code === 'image_search_unavailable') return { message: MESSAGE.preparing, retryable: true };
    if (code === 'image_invalid') return { message: MESSAGE.invalid, retryable: false };
    if (status === 0) return { message: MESSAGE.offline, retryable: true };
    return { message: MESSAGE.unavailable, retryable: true };
  }, []);

  const search = useCallback(
    async (photo: PreparedPhoto, options: { sort?: ImageSearchSort; page?: number } = {}) => {
      setState((current) => ({ ...current, status: 'searching', error: null }));
      try {
        const baseUrl = getMobileApiBaseUrl();
        if (baseUrl === null) throw new ApiNotConfiguredError();
        const result = await uploadPictureNative<ImageSearchResponse>({
          url: `${baseUrl}/api/v1/search/image${searchQuery({
            sort: options.sort ?? 'best_match',
            page: options.page ?? 1,
          })}`,
          accessToken: null,
          uri: photo.uri,
          contentType: photo.type,
          parse: (body) => {
            const parsed = imageSearchResponseSchema.safeParse(body);
            return parsed.success ? parsed.data : null;
          },
          onProgress: () => {},
          onSent: () => {},
        });
        setState({ status: 'ready', result, error: null, retryable: false });
        return result;
      } catch (error) {
        const failure = messageFor(error);
        setState({ status: 'error', result: null, error: failure.message, retryable: failure.retryable });
        return null;
      }
    },
    [messageFor],
  );

  const findSimilar = useCallback(
    async (productId: string, options: { sort?: ImageSearchSort; page?: number } = {}) => {
      setState((current) => ({ ...current, status: 'searching', error: null }));
      try {
        if (api === null) throw new ApiNotConfiguredError();
        const result = await api.findSimilarProducts(
          { productId },
          { sort: options.sort ?? 'best_match', page: options.page ?? 1, pageSize: 24, client: 'android' },
        );
        setState({ status: 'ready', result, error: null, retryable: false });
        return result;
      } catch (error) {
        const failure = messageFor(error);
        setState({ status: 'error', result: null, error: failure.message, retryable: failure.retryable });
        return null;
      }
    },
    [api, messageFor],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, search, findSimilar, reset };
}

/** Records which result was opened; never throws. */
export async function recordSearchClick(
  api: ReturnType<typeof useApi>,
  searchId: string | null,
  productId: string,
): Promise<void> {
  if (api === null || searchId === null) return;
  try {
    await api.recordImageSearchClick({ searchId, productId });
  } catch {
    // A click that was already followed by navigation is not worth an error to the shopper.
  }
}

/** Resolves a scanned QR code or barcode through the API. */
export async function resolveScanCode(
  api: ReturnType<typeof useApi>,
  value: string,
): Promise<
  { kind: 'product'; slug: string } | { kind: 'search'; query: string } | { kind: 'failed' }
> {
  if (api === null) return { kind: 'failed' };
  try {
    const answer = await api.resolveScan({ value });
    if (answer.kind === 'product' && answer.product !== null) {
      return { kind: 'product', slug: answer.product.slug };
    }
    if (answer.kind === 'search' && answer.query !== null) {
      return { kind: 'search', query: answer.query };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
