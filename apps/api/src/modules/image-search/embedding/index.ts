import type { AppConfig } from '../../../config/env';
import { createHttpEmbeddingProvider } from './http-provider';
import { createLocalClipProvider } from './local-clip';
import type { ImageEmbeddingProvider } from './provider';

/** The provider configuration the API started with (never includes the key). */
export type ImageEmbeddingConfig = AppConfig['imageSearch']['provider'];

let shared: ImageEmbeddingProvider | null = null;
let sharedKey = '';

/**
 * One provider per process. The local model is ~90 MB of weights and several seconds of
 * start-up, so building a new one per request would be absurd; the key makes a changed
 * configuration (in tests) produce a fresh instance instead of silently reusing the old one.
 */
export function imageEmbeddingProvider(config: ImageEmbeddingConfig): ImageEmbeddingProvider {
  const key = `${config.id}|${config.model}|${config.modelVersion}|${config.dimensions}|${config.httpUrl ?? ''}`;
  if (shared !== null && sharedKey === key) return shared;

  shared =
    config.id === 'http' && config.httpUrl !== undefined
      ? createHttpEmbeddingProvider({
          url: config.httpUrl,
          apiKey: config.httpApiKey,
          model: config.model,
          modelVersion: config.modelVersion,
          dimensions: config.dimensions,
          timeoutMs: config.timeoutMs,
        })
      : createLocalClipProvider({
          cacheDir: config.cacheDir,
          model: config.model,
          modelVersion: config.modelVersion,
          timeoutMs: config.timeoutMs,
        });
  sharedKey = key;
  return shared;
}

/** Tests: drop the cached provider so each case starts clean. */
export function resetImageEmbeddingProvider(): void {
  shared = null;
  sharedKey = '';
}
