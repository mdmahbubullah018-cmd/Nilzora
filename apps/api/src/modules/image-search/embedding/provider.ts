import { createHash } from 'node:crypto';

/*
 * The embedding provider boundary
 * ------------------------------
 * Everything above this interface (the indexer, the search route, the admin screens) knows
 * only: a model name, a version, a width, and "turn these bytes into a unit vector". That is
 * what keeps the hosted and the self-hosted options interchangeable, and what guarantees the
 * stored model name always describes the vectors beside it.
 */

/** What a provider declares about itself; stored with every vector it produces. */
export interface EmbeddingModelInfo {
  /** Short provider id, for logs and the admin screen: "clip-local", "http". */
  readonly id: string;
  /** The model's own name, e.g. Xenova/clip-vit-base-patch32. */
  readonly model: string;
  /** Bumped when the weights or preprocessing change; vectors of two versions never mix. */
  readonly modelVersion: string;
  readonly dimensions: number;
}

export interface ImageEmbeddingProvider extends EmbeddingModelInfo {
  /**
   * One unit-length vector for one image. Throws `ImageEmbeddingError`; `retryable` says
   * whether the caller should try the same picture again later.
   */
  embed(image: Buffer): Promise<Float32Array>;
  /** Loads weights now instead of on the first picture (the worker calls it at start-up). */
  warmUp?(): Promise<void>;
  close?(): Promise<void>;
}

export class ImageEmbeddingError extends Error {
  override readonly name = 'ImageEmbeddingError';
  /** A timeout, a 5xx or a 429 is worth retrying; a rejected image is not. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.retryable = retryable;
  }
}

/** The content hash that identifies an image in the embedding cache. */
export function imageContentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * L2 normalisation, so cosine similarity is a dot product and every stored vector is
 * comparable to every other one. A zero vector (a broken model output) is rejected rather
 * than stored: it would match everything equally badly.
 */
export function normaliseVector(values: ArrayLike<number>, dimensions: number): Float32Array {
  if (values.length !== dimensions) {
    throw new ImageEmbeddingError(
      `the model returned ${values.length} values, expected ${dimensions}`,
      false,
    );
  }
  const out = new Float32Array(dimensions);
  let sumSquares = 0;
  for (let index = 0; index < dimensions; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) {
      throw new ImageEmbeddingError('the model returned a non-finite value', false);
    }
    out[index] = value;
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm < 1e-12) {
    throw new ImageEmbeddingError('the model returned a zero vector', false);
  }
  for (let index = 0; index < dimensions; index += 1) out[index] = (out[index] ?? 0) / norm;
  return out;
}

/** pgvector's text form: "[0.1,0.2,...]" — what the SQL functions receive. */
export function vectorLiteral(vector: Float32Array): string {
  let text = '[';
  for (let index = 0; index < vector.length; index += 1) {
    if (index > 0) text += ',';
    text += (vector[index] ?? 0).toFixed(7);
  }
  return `${text}]`;
}

/** Parses the text form back (used by the evaluation script and tests). */
export function parseVector(text: string): Float32Array {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner === '') return new Float32Array(0);
  return Float32Array.from(inner.split(',').map((value) => Number(value)));
}
