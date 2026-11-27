import { ImageEmbeddingError, normaliseVector, type ImageEmbeddingProvider } from './provider';

/*
 * A hosted embedding provider
 * ---------------------------
 * For a deployment that would rather call a managed CLIP/SigLIP endpoint than run ONNX
 * locally. The contract is deliberately tiny and boring: POST the image bytes as base64,
 * receive `{ embedding: number[] }` (or the OpenAI-style `{ data: [{ embedding: [] }] }`).
 * Anything else is a 502 with no detail beyond the status, because the response body belongs
 * to the provider, not to us.
 *
 * Configuration is server-only: the URL and the key never reach a browser or the app.
 */

export interface HttpEmbeddingOptions {
  url: string;
  apiKey?: string | undefined;
  model: string;
  modelVersion: string;
  dimensions: number;
  timeoutMs?: number;
}

interface EmbeddingBody {
  embedding?: unknown;
  data?: unknown;
}

function readEmbedding(body: EmbeddingBody): number[] | null {
  if (Array.isArray(body.embedding)) return body.embedding.map(Number);
  const first = Array.isArray(body.data)
    ? (body.data[0] as { embedding?: unknown } | undefined)
    : undefined;
  if (first !== undefined && Array.isArray(first.embedding)) return first.embedding.map(Number);
  return null;
}

export function createHttpEmbeddingProvider(options: HttpEmbeddingOptions): ImageEmbeddingProvider {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    id: 'http',
    model: options.model,
    modelVersion: options.modelVersion,
    dimensions: options.dimensions,

    async embed(image) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
          },
          body: JSON.stringify({ model: options.model, image: image.toString('base64') }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ImageEmbeddingError(
            `the embedding service answered ${response.status}`,
            response.status === 429 || response.status >= 500,
          );
        }
        const body = (await response.json()) as EmbeddingBody;
        const values = readEmbedding(body);
        if (values === null) {
          throw new ImageEmbeddingError('the embedding service returned no embedding', false);
        }
        return normaliseVector(values, options.dimensions);
      } catch (error) {
        if (error instanceof ImageEmbeddingError) throw error;
        if (controller.signal.aborted) {
          throw new ImageEmbeddingError('the embedding service timed out', true, { cause: error });
        }
        throw new ImageEmbeddingError('the embedding service could not be reached', true, {
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
