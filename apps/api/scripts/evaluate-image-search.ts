/*
 * Image search threshold evaluation
 * ---------------------------------
 * Measures retrieval quality on the catalogue that is actually indexed, so the similarity
 * threshold in the admin settings is a measurement rather than a guess.
 *
 *   corepack pnpm --filter @nilzora/api evaluate-image-search
 *   corepack pnpm --filter @nilzora/api evaluate-image-search -- --sample=12
 *
 * What it does, per sample:
 *   1. Takes a seeded, deterministic sample of indexed pictures (round-robin across products,
 *      so primary, gallery and variant pictures are all represented).
 *   2. Embeds each picture again with the *production* provider — the same code path a
 *      customer's photograph takes — instead of reusing the stored vector.
 *   3. Searches the real index through `image_search_nearest`, and groups the pictures into
 *      products keeping each product's best picture (exactly what the API does).
 *   4. Drops pictures that are byte-identical to the query, so nothing matches itself.
 *   5. Records where the query's own product landed.
 *
 * It reports, for every candidate threshold: precision@1, recall@5, recall@10, mean reciprocal
 * rank and the mean number of *other* products that clear the threshold (the false matches a
 * shopper would see). The last line names the recommended threshold.
 *
 * The sample is seeded by ordering on (kind, content hash), so two runs over the same index
 * evaluate the same pictures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Client, type QueryResultRow } from 'pg';
import { connectionSettings } from '../src/db/pool';
import { createLocalClipProvider } from '../src/modules/image-search/embedding/local-clip';
import { vectorLiteral } from '../src/modules/image-search/embedding/provider';

interface PictureRow extends QueryResultRow {
  image_id: string;
  product_id: string;
  product_name: string;
  kind: 'primary' | 'gallery' | 'variant';
  is_primary: boolean;
  source_key: string;
  content_hash: string;
  model: string;
  dimensions: number;
}

interface SettingsRow extends QueryResultRow {
  similarity_threshold: number;
  model: string;
  model_version: string;
  dimensions: number;
}

interface NearestRow extends QueryResultRow {
  image_id: string;
  product_id: string;
  similarity: number;
}

const CANDIDATE_THRESHOLDS = [0.6, 0.65, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.85, 0.88, 0.9];

/** `process.stdout.write`, so this runs the same under lint's no-console rule. */
function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function argument(name: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  const parsed = raw === undefined ? Number.NaN : Number(raw.split('=')[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function envFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) values[match[1]] = match[2] ?? '';
  }
  return values;
}

const environment = { ...envFile('.env'), ...process.env };
const { DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
  environment;

if (
  DATABASE_URL === undefined ||
  R2_ACCOUNT_ID === undefined ||
  R2_ACCESS_KEY_ID === undefined ||
  R2_SECRET_ACCESS_KEY === undefined ||
  R2_BUCKET === undefined
) {
  print('DATABASE_URL and the R2_* settings are required (run with the API .env file).');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function readStored(key: string): Promise<Buffer | null> {
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: `${key}/full.webp` }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function readVariant(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const sampleSize = argument('sample', 30);
const direct = new Client({ ...connectionSettings(DATABASE_URL) });

await direct.connect();
try {
  const settings = (
    await direct.query<SettingsRow>(
      `select similarity_threshold, model, model_version, dimensions
       from public.image_search_settings where id`,
    )
  ).rows[0];

  const pictures = (
    await direct.query<PictureRow>(
      `select i.id as image_id, i.product_id, p.name as product_name, i.kind::text as kind,
              i.is_primary, i.source_key, i.content_hash, i.model, i.dimensions
       from public.image_search_images i
       join public.products p on p.id = i.product_id
       where i.status = 'indexed'
       order by i.kind, i.content_hash`,
    )
  ).rows.map((row) => ({
    imageId: row.image_id,
    productId: row.product_id,
    productName: row.product_name,
    kind: row.kind,
    isPrimary: row.is_primary,
    sourceKey: row.source_key,
    contentHash: row.content_hash,
    model: row.model,
    dimensions: Number(row.dimensions),
  }));

  if (pictures.length === 0) {
    print('No indexed pictures: run the indexer (or Backfill) first.');
    process.exit(1);
  }

  // Round-robin across products, so one product's gallery does not crowd out the others.
  const byProduct = new Map<string, typeof pictures>();
  for (const picture of pictures) {
    const list = byProduct.get(picture.productId) ?? [];
    list.push(picture);
    byProduct.set(picture.productId, list);
  }
  const queues = [...byProduct.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
  const sample: typeof pictures = [];
  for (let index = 0; sample.length < Math.min(sampleSize, pictures.length); index += 1) {
    let added = false;
    for (const queue of queues) {
      const picture = queue[index];
      if (picture !== undefined && sample.length < sampleSize) {
        sample.push(picture);
        added = true;
      }
    }
    if (!added) break;
  }

  const provider = createLocalClipProvider({
    cacheDir: path.resolve(environment.IMAGE_EMBEDDING_CACHE_DIR ?? '.cache/transformers'),
    ...(settings === undefined
      ? {}
      : { model: settings.model, modelVersion: settings.model_version }),
  });

  // Pictures whose bytes are identical to the query's (a copy attached to a variant, say) would
  // score 1.0 and prove nothing: they are excluded from their own evaluation.
  const imageIdsByHash = new Map<string, Set<string>>();
  for (const picture of pictures) {
    const set = imageIdsByHash.get(picture.contentHash) ?? new Set<string>();
    set.add(picture.imageId);
    imageIdsByHash.set(picture.contentHash, set);
  }

  const results: { query: (typeof pictures)[number]; ranked: { productId: string; similarity: number }[] }[] = [];
  let skipped = 0;

  for (const [index, query] of sample.entries()) {
    const bytes =
      query.kind === 'variant'
        ? await readVariant(query.sourceKey)
        : await readStored(query.sourceKey);
    if (bytes === null) {
      skipped += 1;
      continue;
    }
    const vector = await provider.embed(bytes);
    const nearest = await direct.query<NearestRow>(
      `select image_id, product_id, similarity
       from public.image_search_nearest($1::extensions.vector, $2, $3, 300)`,
      [vectorLiteral(vector), settings?.model ?? provider.model, settings?.dimensions ?? 512],
    );
    const best = new Map<string, number>();
    const identical = imageIdsByHash.get(query.contentHash) ?? new Set<string>();
    for (const row of nearest.rows) {
      if (identical.has(row.image_id)) continue;
      const similarity = Number(row.similarity);
      if ((best.get(row.product_id) ?? -1) < similarity) best.set(row.product_id, similarity);
    }
    const ranked = [...best.entries()]
      .map(([productId, similarity]) => ({ productId, similarity }))
      .sort((a, b) => b.similarity - a.similarity);
    results.push({ query, ranked });
    process.stdout.write(`\r embedded ${index + 1} / ${sample.length}`);
  }
  print();
  print();

  print(`Catalogue: ${pictures.length} indexed pictures, ${byProduct.size} products`);
  print(`Model: ${settings?.model ?? provider.model} (${settings?.dimensions ?? 512} dims)`);
  print(`Sample: ${results.length} query pictures (${skipped} unreadable), round-robin by product`);
  print();

  const header = 'threshold | P@1    | R@5    | R@10   | MRR    | false matches/query | results/query';
  print(header);
  print('-'.repeat(header.length));

  let best = { threshold: settings?.similarity_threshold ?? 0.7, score: Number.NEGATIVE_INFINITY };
  for (const threshold of CANDIDATE_THRESHOLDS) {
    let top1 = 0;
    let recall5 = 0;
    let recall10 = 0;
    let reciprocal = 0;
    let falseMatches = 0;
    let kept = 0;
    for (const { query, ranked } of results) {
      const keptRows = ranked.filter((row) => row.similarity >= threshold);
      kept += keptRows.length;
      falseMatches += keptRows.filter((row) => row.productId !== query.productId).length;
      const rank = keptRows.findIndex((row) => row.productId === query.productId);
      const position = rank === -1 ? Number.POSITIVE_INFINITY : rank + 1;
      if (position === 1) top1 += 1;
      if (position <= 5) recall5 += 1;
      if (position <= 10) recall10 += 1;
      if (Number.isFinite(position)) reciprocal += 1 / position;
    }
    const count = results.length || 1;
    const precision1 = top1 / count;
    const r5 = recall5 / count;
    const r10 = recall10 / count;
    const mrr = reciprocal / count;
    const falseRate = falseMatches / count;
    // Balanced: recall@5 first, then ranking; a false match per query costs a full recall point,
    // because showing the wrong product is worse than showing five right ones.
    const score = r5 + mrr * 0.2 - falseRate;
    if (score > best.score) best = { threshold, score };
    print(
      `${threshold.toFixed(2).padStart(9)} | ${precision1.toFixed(2)}   | ${r5.toFixed(2)}   | ${r10.toFixed(2)}   | ${mrr.toFixed(3)} | ${falseRate.toFixed(2).padStart(19)} | ${(kept / count).toFixed(2)}`,
    );
  }

  print();
  print('Per query (best match first):');
  for (const { query, ranked } of results) {
    const top = ranked[0];
    const hit = top?.productId === query.productId;
    const shown = ranked
      .slice(0, 3)
      .map((row) => `${row.productId.slice(0, 8)} ${row.similarity.toFixed(3)}`)
      .join(', ');
    print(` ${hit ? 'hit ' : 'miss'} ${query.productName} (${query.kind}) top: ${shown || '-'}`);
  }

  print();
  print(
    `Configured threshold: ${Number(settings?.similarity_threshold ?? 0.7).toFixed(2)}. Best score in this sample: ${best.threshold.toFixed(2)}.`,
  );
} finally {
  await direct.end();
}
