import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { R2Config } from '../../config/env';
import { resolveR2Endpoint } from './r2-endpoint';

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

/** One stored object on its way back to an authorized caller. */
export interface ObjectStream {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
  /** Set when the request carried a Range header and the store honoured it. */
  contentRange: string | null;
  acceptRanges: string | null;
}

/**
 * Where media files live. The API only ever writes keys it generated itself; callers
 * treat a failed put as "not stored" and a failed delete as an orphan to be logged.
 */
export interface ObjectStore {
  put(object: StoredObject): Promise<void>;
  /** Deletes every key; keys that do not exist are not an error. Rejects if any delete failed. */
  deleteMany(keys: readonly string[]): Promise<void>;
  /**
   * Reads one object back, streamed. The key must come from a trusted source (the database),
   * never from a client. Answers null when the object does not exist. Optional only so a test
   * double that never streams media does not have to implement it; the real store always does,
   * and the chat media route refuses to serve anything when it is missing.
   */
  get?(key: string, options?: { range?: string | undefined }): Promise<ObjectStream | null>;
}

/** Uploaded files are never overwritten (their key holds a random id), so they cache forever. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * The one storage handle the API hands to every feature that owns pictures: the object store
 * plus the public origin that serves it. Built once at start-up (server.ts), so products,
 * categories, brands, banners, the media library, avatars, review photos and chat attachments
 * all write through the same client to the same bucket.
 */
export interface MediaStorage {
  objects: ObjectStore;
  /** Public origin (plus optional path) that serves the bucket, without a trailing slash. */
  publicBaseUrl: string;
}

/** The part of S3Client the store uses, so tests can pass a mock. */
export interface S3Like {
  send(command: PutObjectCommand | DeleteObjectCommand | GetObjectCommand): Promise<unknown>;
}

/**
 * The S3 client options for R2, kept apart from the client so they can be asserted without
 * a network call. `region: 'auto'` is what R2 expects; the endpoint comes from the account id
 * (see r2-endpoint.ts) and never from `publicBaseUrl`, which is a read-only public address.
 * Path-style addressing stays off, which is the virtual-hosted form R2 documents.
 */
export function r2ClientOptions(config: R2Config) {
  return {
    region: 'auto',
    endpoint: resolveR2Endpoint(config.accountId),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: false,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  } as const;
}

/**
 * Cloudflare R2 through its S3-compatible API. Checksums are sent only where an operation
 * requires them: R2 is not AWS, and the SDK's newer default checksums are not needed.
 */
export function createR2ObjectStore(config: R2Config, client?: S3Like): ObjectStore {
  const s3: S3Like = client ?? new S3Client(r2ClientOptions(config));

  return {
    async put({ key, body, contentType, cacheControl }) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
          ContentLength: body.length,
        }),
      );
    },

    async deleteMany(keys) {
      // One DeleteObject per key: it needs no request checksum, which R2 handles unevenly.
      const results = await Promise.allSettled(
        keys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))),
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0) {
        throw new AggregateError(
          failed.map((result) => result.reason as unknown),
          `${failed.length} of ${keys.length} object deletes failed`,
        );
      }
    },

    async get(key, options = {}) {
      try {
        const answer = (await s3.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ...(options.range === undefined ? {} : { Range: options.range }),
          }),
        )) as {
          Body?: unknown;
          ContentType?: string | undefined;
          ContentLength?: number | undefined;
          ContentRange?: string | undefined;
          AcceptRanges?: string | undefined;
        };
        // The SDK answers with a stream on Node; anything else means the object cannot be read.
        if (answer.Body === undefined || answer.Body === null) return null;
        return {
          body: answer.Body as Readable,
          contentType: answer.ContentType ?? null,
          contentLength: answer.ContentLength ?? null,
          contentRange: answer.ContentRange ?? null,
          acceptRanges: answer.AcceptRanges ?? 'bytes',
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
  };
}

/** R2 answers a missing key as NoSuchKey, or a bare 404 from some code paths. */
function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: unknown }).name;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/** In-memory store for tests and local experiments. */
export interface MemoryObjectStore extends ObjectStore {
  readonly objects: ReadonlyMap<string, StoredObject>;
}

export function createMemoryObjectStore(): MemoryObjectStore {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    put(object) {
      objects.set(object.key, object);
      return Promise.resolve();
    },
    deleteMany(keys) {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
    get(key) {
      const stored = objects.get(key);
      if (stored === undefined) return Promise.resolve(null);
      return Promise.resolve({
        body: Readable.from(stored.body),
        contentType: stored.contentType,
        contentLength: stored.body.length,
        contentRange: null,
        acceptRanges: 'bytes',
      });
    },
  };
}
