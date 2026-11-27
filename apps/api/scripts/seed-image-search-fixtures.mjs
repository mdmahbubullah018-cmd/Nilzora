/*
 * Development fixtures for visual search
 * --------------------------------------
 * Three product photo sets were already in the bucket from products that no longer exist in
 * the database (real Nilzora product photographs: a kids' cyan tee, a pink leather handbag and
 * a printed blue tee). Visual search needs real catalogue pictures to index — and the running
 * evaluation script needs several photos of the same product, plus a pair of *different*
 * products that look alike (the two blue t-shirts), plus something unrelated (the handbag).
 *
 * This script restores them as three ordinary development products, reusing the objects that
 * are already stored (their keys are `products/<product id>/<image id>`, and the id is the
 * product's own), so nothing is uploaded and nothing existing is changed. It is additive and
 * idempotent: running it twice changes nothing.
 *
 *   corepack pnpm --filter @nilzora/api seed-image-search
 *
 * It is a development fixture, not store data: the products it creates are marked in their
 * summary, and the rows are ordinary products that the admin can edit or delete.
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Client } from 'pg';
import sharp from 'sharp';

const FIXTURES = {
  // product folder id -> the development product that owns those photos
  '8f4c7f03-1198-408b-a344-1987a45f7f38': {
    slug: 'kids-cyan-cotton-t-shirt',
    sku: 'NZ-VIS-KIDS-TEE',
    name: "Kids' Cyan Cotton T-Shirt",
    summary: 'Development fixture for image search: soft cotton crew-neck tee for children.',
    priceMinor: 49000,
    compareAtPriceMinor: 59000,
    stock: 24,
  },
  'c43aa6bb-bfa5-4e61-acd1-42246765b100': {
    slug: 'pink-textured-handbag',
    sku: 'NZ-VIS-PINK-BAG',
    name: 'Pink Textured Handbag with Tassel Charm',
    summary: 'Development fixture for image search: structured handbag with a shoulder strap.',
    priceMinor: 189000,
    compareAtPriceMinor: 229000,
    stock: 9,
  },
  'e61f0026-f136-45e6-94c2-bda2245edfbe': {
    slug: 'no-internet-graphic-tee',
    sku: 'NZ-VIS-GRAPHIC-TEE',
    name: 'No Internet Graphic Tee',
    summary: 'Development fixture for image search: light blue printed cotton t-shirt.',
    priceMinor: 75000,
    compareAtPriceMinor: null,
    stock: 16,
  },
};

const R2 = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
};

if (
  !process.env.DATABASE_URL ||
  !R2.accountId ||
  !R2.accessKeyId ||
  !R2.secretAccessKey ||
  !R2.bucket
) {
  console.error('DATABASE_URL and the R2_* settings are required (run with the API .env files).');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2.accessKeyId, secretAccessKey: R2.secretAccessKey },
});

const listed = await s3.send(
  new ListObjectsV2Command({ Bucket: R2.bucket, Prefix: 'products/', MaxKeys: 1000 }),
);
const imagesByProduct = new Map();
for (const object of listed.Contents ?? []) {
  const match = /^products\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/full\.webp$/.exec(object.Key ?? '');
  if (!match) continue;
  const [, productId, imageId] = match;
  if (!FIXTURES[productId]) continue;
  const list = imagesByProduct.get(productId) ?? [];
  list.push({ imageId, key: `products/${productId}/${imageId}`, bytes: Number(object.Size ?? 0) });
  imagesByProduct.set(productId, list);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let created = 0;
let images = 0;
try {
  const { rows: categories } = await client.query(
    `select id, slug from public.categories where slug in ('fashion', 'home-kitchen') order by slug`,
  );
  const categoryId = categories.find((row) => row.slug === 'fashion')?.id ?? categories[0]?.id;
  if (categoryId === undefined) {
    throw new Error('The development seed categories are missing; run the database seed first.');
  }

  for (const [productId, fixture] of Object.entries(FIXTURES)) {
    const list = (imagesByProduct.get(productId) ?? []).sort((a, b) =>
      a.imageId.localeCompare(b.imageId),
    );
    if (list.length === 0) continue;

    const product = await client.query(
      `insert into public.products
         (id, category_id, slug, sku, name, summary, description, price_minor,
          compare_at_price_minor, stock_quantity, max_order_quantity, status,
          moderation_status, is_featured, published_at)
       values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, 10, 'active', 'approved', false, now())
       on conflict (id) do nothing
       returning id`,
      [
        productId,
        categoryId,
        fixture.slug,
        fixture.sku,
        fixture.name,
        fixture.summary,
        fixture.priceMinor,
        fixture.compareAtPriceMinor,
        fixture.stock,
      ],
    );
    if (product.rowCount === 1) created += 1;

    // The stored dimensions are read from R2 once, because the indexer uses them to decide
    // eligibility before it downloads anything.
    for (const [position, image] of list.entries()) {
      const { rows: existing } = await client.query(
        `select id from public.product_images where id = $1`,
        [image.imageId],
      );
      if (existing.length > 0) continue;

      // The image's own bytes give the exact width and height the media pipeline recorded.
      const head = await fetch(
        `${process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '')}/${image.key}/full.webp`,
      );
      if (!head.ok) {
        console.warn(`skipping ${image.key}: the object could not be read (${head.status})`);
        continue;
      }
      const meta = await sharp(Buffer.from(await head.arrayBuffer())).metadata();
      await client.query(
        `insert into public.product_images
           (id, product_id, storage_key, width, height, bytes, alt_text, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do nothing`,
        [
          image.imageId,
          productId,
          image.key,
          meta.width ?? 1200,
          meta.height ?? 1200,
          image.bytes,
          fixture.name,
          position,
        ],
      );
      images += 1;
    }
  }

  process.stdout.write(
    `image search fixtures: ${created} product(s) created, ${images} image(s) attached.\n`,
  );
} finally {
  await client.end();
}
