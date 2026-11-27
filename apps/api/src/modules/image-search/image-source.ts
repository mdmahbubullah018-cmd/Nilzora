import type { MediaStorage } from '../media/routes';
import type { Readable } from 'node:stream';

/*
 * Getting the bytes of a catalogue picture
 * ----------------------------------------
 * Two kinds of stored picture are indexed, and they are read differently on purpose:
 *
 *  - A product picture is stored under its base key, with the rendered variants beside it
 *    (`<key>/full.webp`, `<key>/thumb.webp`). It is read straight out of the bucket through
 *    the server's own credential: no network request to a public host, no chance of a
 *    customer-visible URL being used as a proxy.
 *  - A variant's picture is a URL the admin typed into the product form. It is only accepted
 *    when it points at this store's own public media origin, so the indexer can never be
 *    pointed at an arbitrary host (which would make it an SSRF gadget). Anything else is
 *    excluded with `host_not_allowed`.
 */

/** A stored picture is never larger than this; anything bigger is not a product photo. */
const MAX_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface ImageSourceReader {
  /** Reads `<key>/full.webp` from the bucket. Null when the object is missing. */
  readStoredImage(baseKey: string): Promise<Buffer | null>;
  /** Reads a variant picture from this store's own media host. Null when it cannot be read. */
  readVariantUrl(url: string): Promise<Buffer | null>;
  /** Whether a URL points at this store's media host, and so may be fetched at all. */
  isOwnMediaUrl(url: string): boolean;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > MAX_BYTES) throw new Error('image too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function createImageSourceReader(options: {
  storage: MediaStorage | undefined;
  publicBaseUrl: string | undefined;
  fetchImpl?: typeof fetch;
}): ImageSourceReader {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.publicBaseUrl === undefined ? null : safeUrl(options.publicBaseUrl);

  function isOwnMediaUrl(url: string): boolean {
    if (base === null) return false;
    const parsed = safeUrl(url);
    if (parsed === null) return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    return (
      basePath === '' || parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`)
    );
  }

  return {
    isOwnMediaUrl,

    async readStoredImage(baseKey) {
      if (options.storage === undefined) return null;
      const store = options.storage.objects;
      if (store.get === undefined) return null;
      const stream = await store.get(`${baseKey}/full.webp`);
      if (stream === null) return null;
      return streamToBuffer(stream.body);
    },

    async readVariantUrl(url) {
      if (!isOwnMediaUrl(url)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) return null;
        const type = response.headers.get('content-type') ?? '';
        if (!type.startsWith('image/')) return null;
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > MAX_BYTES) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        return bytes.length === 0 || bytes.length > MAX_BYTES ? null : bytes;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
