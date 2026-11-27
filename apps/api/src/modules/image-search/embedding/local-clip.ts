import { resolve } from 'node:path';
import sharp from 'sharp';
import { ImageEmbeddingError, normaliseVector, type ImageEmbeddingProvider } from './provider';

/*
 * The self-hosted CLIP image encoder
 * ----------------------------------
 * The picture is encoded by CLIP ViT-B/32 running locally through ONNX Runtime (the
 * `@huggingface/transformers` runtime fetches the model once and caches it). No API key, no
 * external service, no per-image cost, and the customer photograph never leaves the server.
 * Weights are the quantised vision tower (`q8`, about 90 MB), which is what makes this
 * practical on an ordinary API instance.
 *
 * Only the *vision* tower is loaded: Nilzora searches by image, so a text tower would be
 * weights nobody calls. The model returns 512 values, L2-normalised here so cosine similarity
 * is a plain dot product (see `embedding/provider.ts`).
 *
 * Preprocessing is written out rather than delegated to the model's image processor. That is
 * CLIP's own recipe — resize the shortest side to 224, centre crop 224x224, scale to [0,1] and
 * normalise with CLIP's channel mean and deviation — and doing it here means the decode runs
 * through sharp alone. The library's processor resizes through its own libvips call that fails
 * on some real product photographs ("parameter space not set"), and a pipeline that works on
 * nine pictures out of ten is not a pipeline.
 *
 * Inference is serialised. ONNX Runtime is happy to run several sessions at once, but each
 * concurrent call holds its own tensor buffer; on a small API instance that turns a burst of
 * searches into memory pressure for no throughput gain (the model itself is the bottleneck).
 */

export interface LocalClipOptions {
  /** Where the weights are cached. Defaults to <cwd>/.cache/transformers. */
  cacheDir?: string | undefined;
  /** The Hugging Face model id. Defaults to Xenova/clip-vit-base-patch32. */
  model?: string;
  modelVersion?: string;
  /** Per-image deadline. Defaults to 30 s (the first call also downloads the weights). */
  timeoutMs?: number;
  /** Injected in tests so no model is downloaded. */
  encoder?: ((image: Buffer) => Promise<Float32Array>) | undefined;
}

const DEFAULT_MODEL = 'Xenova/clip-vit-base-patch32';
const CLIP_DIMENSIONS = 512;
const CLIP_INPUT = 224;
/** CLIP's ImageNet statistics, exactly as the model card lists them. */
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const CLIP_DEVIATION = [0.26862954, 0.26130258, 0.27577711] as const;

type VisionModel = (inputs: Record<string, unknown>) => Promise<{
  image_embeds?: { data: ArrayLike<number> };
}>;

export function createLocalClipProvider(options: LocalClipOptions = {}): ImageEmbeddingProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const modelVersion = options.modelVersion ?? '1';
  const timeoutMs = options.timeoutMs ?? 30_000;
  const cacheDir = resolve(options.cacheDir ?? '.cache/transformers');

  let loading: Promise<VisionModel> | null = null;
  /** The tail of the queue: each embed waits for the one before it. */
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<VisionModel> {
    loading ??= (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = cacheDir;
      transformers.env.allowRemoteModels = true;
      return (await transformers.CLIPVisionModelWithProjection.from_pretrained(model, {
        dtype: 'q8',
      })) as unknown as VisionModel;
    })().catch((error: unknown) => {
      loading = null;
      throw new ImageEmbeddingError(
        `the local CLIP model could not be loaded${error instanceof Error ? `: ${error.name}` : ''}`,
        true,
        { cause: error },
      );
    });
    return loading;
  }

  /** The model's input tensor: one CHW float image, CLIP-normalised. */
  async function pixelValues(image: Buffer): Promise<unknown> {
    const { data, info } = await sharp(image, { failOn: 'error' })
      .rotate()
      .resize(CLIP_INPUT, CLIP_INPUT, { fit: 'cover', position: 'centre' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = CLIP_INPUT * CLIP_INPUT;
    const values = new Float32Array(3 * pixels);
    for (let index = 0; index < pixels; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const byte = data[index * info.channels + channel] ?? 0;
        values[channel * pixels + index] =
          (byte / 255 - (CLIP_MEAN[channel] ?? 0)) / (CLIP_DEVIATION[channel] ?? 1);
      }
    }
    const { Tensor } = await import('@huggingface/transformers');
    return new Tensor('float32', values, [1, 3, CLIP_INPUT, CLIP_INPUT]);
  }

  async function encode(image: Buffer): Promise<Float32Array> {
    if (options.encoder !== undefined) {
      return normaliseVector(await options.encoder(image), CLIP_DIMENSIONS);
    }
    const vision = await load();
    const pixel = await pixelValues(image);
    const output = await vision({ pixel_values: pixel });
    const values = output.image_embeds?.data;
    if (values === undefined) {
      throw new ImageEmbeddingError('the model did not return image embeddings', false);
    }
    return normaliseVector(values, CLIP_DIMENSIONS);
  }

  return {
    id: 'clip-local',
    model,
    modelVersion,
    dimensions: CLIP_DIMENSIONS,

    embed(image) {
      const run = queue.then(async () => {
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            encode(image),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new ImageEmbeddingError('embedding timed out', true)),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      });
      // Keep the chain alive even when this call rejects: the next picture must not inherit
      // the previous failure.
      queue = run.catch(() => undefined);
      return run;
    },

    async warmUp() {
      await load();
    },
  };
}
