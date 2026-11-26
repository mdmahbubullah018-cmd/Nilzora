import { MAX_PRODUCT_IMAGES } from '@nilzora/contracts';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { AdminRefusalError } from '../modules/admin/errors';
import { variantKeys, type ImageRow } from '../modules/media/images';
import { createMemoryObjectStore } from '../modules/media/object-store';
import type { ProductImageStore } from '../modules/media/store';
import { StoreUnavailableError } from '../modules/commerce/errors';
import type { FakeIdentity } from './fakes';

/*
 * An in-memory stand-in for the product_images table and the admin_*_product_image
 * functions. Like the database it checks the CALLER (from the token) for products.update,
 * refuses unknown products, products on sale (content_locked) and a ninth image, and
 * derives the storage key from the ids. The real functions are covered by pgTAP.
 */

export type ProductState = 'draft' | 'active' | 'pending';

export class FakeProductImages implements ProductImageStore {
  readonly rows: (ImageRow & { productId: string; bytes: number })[] = [];
  readonly products = new Map<string, ProductState>();
  readonly calls: string[] = [];
  /** The next write fails as a store outage (not a refusal). */
  nextOutage = false;

  constructor(private readonly identity: FakeIdentity) {}

  private enter(operation: string, accessToken: string, write: boolean): void {
    this.calls.push(operation);
    if (write && this.nextOutage) {
      this.nextOutage = false;
      throw new StoreUnavailableError(`${operation} failed (08006)`);
    }
    const user = this.identity.userFor(accessToken);
    if (!user) throw new StoreUnavailableError(`${operation} failed (no session)`);
    if (write && !this.identity.permissionsOf(user).has('products.update')) {
      throw new AdminRefusalError('missing_permission');
    }
  }

  private editable(productId: string): void {
    const state = this.products.get(productId);
    if (state === undefined) throw new AdminRefusalError('not_found');
    if (state === 'active') throw new AdminRefusalError('content_locked');
    if (state === 'pending') throw new AdminRefusalError('under_review');
  }

  private ofProduct(productId: string) {
    return this.rows
      .filter((row) => row.productId === productId)
      .sort((a, b) => a.position - b.position);
  }

  list(accessToken: string, _userId: string, productId: string) {
    this.enter('list', accessToken, false);
    return Promise.resolve(
      this.ofProduct(productId).map(({ productId: _p, bytes: _b, ...row }) => row),
    );
  }

  productOf(accessToken: string, _userId: string, imageId: string) {
    this.enter('productOf', accessToken, false);
    return Promise.resolve(this.rows.find((row) => row.id === imageId)?.productId ?? null);
  }

  add(accessToken: string, _userId: string, image: Parameters<ProductImageStore['add']>[2]) {
    this.enter('add', accessToken, true);
    this.editable(image.productId);
    const existing = this.ofProduct(image.productId);
    if (existing.length >= MAX_PRODUCT_IMAGES) throw new AdminRefusalError('image_limit');
    this.rows.push({
      id: image.imageId,
      productId: image.productId,
      storage_key: `products/${image.productId}/${image.imageId}`,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      alt_text: image.alt,
      position: existing.length,
    });
    return Promise.resolve();
  }

  updateAlt(accessToken: string, _userId: string, imageId: string, alt: string | null) {
    this.enter('updateAlt', accessToken, true);
    const row = this.rows.find((candidate) => candidate.id === imageId);
    if (!row) throw new AdminRefusalError('not_found');
    this.editable(row.productId);
    row.alt_text = alt === null || alt.trim() === '' ? null : alt.trim();
    return Promise.resolve();
  }

  reorder(accessToken: string, _userId: string, productId: string, imageIds: readonly string[]) {
    this.enter('reorder', accessToken, true);
    this.editable(productId);
    const current = this.ofProduct(productId);
    const same =
      imageIds.length === current.length &&
      new Set(imageIds).size === imageIds.length &&
      current.every((row) => imageIds.includes(row.id));
    if (!same) throw new AdminRefusalError('invalid_input');
    imageIds.forEach((id, index) => {
      const row = this.rows.find((candidate) => candidate.id === id);
      if (row) row.position = index;
    });
    return Promise.resolve();
  }

  remove(accessToken: string, _userId: string, imageId: string) {
    this.enter('remove', accessToken, true);
    const row = this.rows.find((candidate) => candidate.id === imageId);
    if (!row) throw new AdminRefusalError('not_found');
    this.editable(row.productId);
    this.rows.splice(this.rows.indexOf(row), 1);
    this.ofProduct(row.productId).forEach((remaining, index) => {
      remaining.position = index;
    });
    return Promise.resolve(row.storage_key);
  }

  /** Base keys of every stored image, for comparing with the object store. */
  objectKeys(): string[] {
    return this.rows.flatMap((row) => variantKeys(row.storage_key));
  }
}

/** An object store whose puts and deletes can be made to fail, remembering what it was asked. */
export function failingObjectStore() {
  const memory = createMemoryObjectStore();
  const state = { failPutAfter: Infinity, failDelete: false, puts: 0, deletes: [] as string[][] };
  return {
    state,
    memory,
    store: {
      put: async (object: Parameters<typeof memory.put>[0]) => {
        state.puts += 1;
        if (state.puts > state.failPutAfter) throw new Error('R2 down');
        await memory.put(object);
      },
      deleteMany: async (keys: readonly string[]) => {
        state.deletes.push([...keys]);
        if (state.failDelete) throw new Error('R2 down');
        await memory.deleteMany(keys);
      },
    },
  };
}

type Format = 'jpeg' | 'png' | 'webp';

/** A real, valid test picture: a gradient so that encoders have something to compress. */
export async function makeImage(
  format: Format = 'jpeg',
  width = 800,
  height = 600,
  options: { exif?: boolean } = {},
): Promise<Buffer> {
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * channels;
      pixels[at] = (x * 255) / width;
      pixels[at + 1] = (y * 255) / height;
      pixels[at + 2] = 128;
    }
  }
  let image = sharp(pixels, { raw: { width, height, channels } });
  if (options.exif) {
    image = image.withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Copyright: 'Nilzora test' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 45/1 0/1' },
      },
    });
  }
  return image[format]().toBuffer();
}

/** A valid animated WebP (two frames), which the pipeline must refuse. */
export async function makeAnimatedWebp(): Promise<Buffer> {
  const frame = (background: string) =>
    sharp({ create: { width: 500, height: 500, channels: 3, background } })
      .png()
      .toBuffer();
  const frames = await Promise.all([frame('#ff0000'), frame('#00ff00')]);
  return sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
}

/**
 * A valid, decodable PNG of incompressible noise, sized between the picture limit (5 MB) and
 * the chat-attachment limit (10 MB). Used to prove a body reader accepts a file the contract
 * and the clients allow.
 */
export async function makeNoisePng(width = 1700, height = 1700): Promise<Buffer> {
  const pixels = randomBytes(width * height * 3);
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}
