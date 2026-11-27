import type { Pool } from 'pg';
import type { SupabaseClients } from '../../supabase/clients';
import { variantKeys } from './images';

/**
 * Whether a stored picture is still used by a record, asked just before its objects are
 * deleted from media storage.
 *
 * Deleting a picture that another row still shows would leave a broken image on the
 * storefront, so the answer has to see *every* table, including ones the caller may not
 * read. That is why the check runs over the trusted server connection rather than as the
 * caller. `null` means the question could not be answered at all: the caller then keeps the
 * object, because an unused file costs storage while a deleted one costs a customer's trust.
 *
 * The columns below are every place a picture's base key is kept. Most of them also constrain
 * the key's prefix, so a `brands/…` key can only live in a brand row or in a column with no
 * shape check (a campaign banner, an order line's snapshot, a chat attachment): the check asks
 * about all of them anyway, so a future column cannot quietly defeat it.
 */
export interface MediaKeyReferences {
  /** True or false when it can be answered; null when the check itself failed. */
  inUse(baseKey: string): Promise<boolean | null>;
}

export interface PictureKeyColumn {
  table: string;
  columns: readonly string[];
}

export const PICTURE_KEY_COLUMNS: readonly PictureKeyColumn[] = [
  { table: 'brands', columns: ['logo_key', 'banner_key'] },
  { table: 'banners', columns: ['image_key', 'mobile_image_key'] },
  { table: 'categories', columns: ['image_key', 'banner_key', 'og_image_key'] },
  { table: 'chat_attachments', columns: ['object_key'] },
  { table: 'discount_campaigns', columns: ['banner_image_key'] },
  { table: 'media_assets', columns: ['full_key', 'thumb_key'] },
  { table: 'onboarding_slides', columns: ['image_key'] },
  { table: 'order_items', columns: ['image_key'] },
  { table: 'product_announcements', columns: ['image_key'] },
  { table: 'product_images', columns: ['storage_key'] },
  { table: 'product_review_images', columns: ['storage_key'] },
  { table: 'product_videos', columns: ['storage_key'] },
  { table: 'products', columns: ['og_image_key'] },
  { table: 'profiles', columns: ['avatar_key'] },
  { table: 'shopping_zones', columns: ['banner_key', 'mobile_banner_key'] },
  { table: 'store_profile', columns: ['logo_key', 'og_image_key'] },
];

/** The base key and the two objects stored under it: any of the three may be referenced. */
export function pictureKeys(baseKey: string): string[] {
  return [baseKey, ...variantKeys(baseKey)];
}

/**
 * The column list a database actually has. A migration that has not run yet (an added
 * `brands.banner_key`) must not make the check fail. The answer is remembered, so the schema
 * is asked once per process — and asked again a minute later if something was missing, so a
 * long-running API picks up a newly applied migration without a restart.
 */
function existingColumns(
  known: () => Promise<ReadonlySet<string> | null>,
): () => Promise<readonly PictureKeyColumn[]> {
  const RECHECK_MS = 60_000;
  const ALL = PICTURE_KEY_COLUMNS.flatMap(names);
  let cached: { present: ReadonlySet<string> | null; checkedAt: number } | null = null;
  let running: Promise<readonly PictureKeyColumn[]> | null = null;

  const complete = (present: ReadonlySet<string> | null) =>
    present !== null && ALL.every((name) => present.has(name));

  const resolve = (present: ReadonlySet<string> | null): readonly PictureKeyColumn[] =>
    present === null
      ? []
      : PICTURE_KEY_COLUMNS.map((entry) => ({
          table: entry.table,
          columns: entry.columns.filter((column) => present.has(`${entry.table}.${column}`)),
        })).filter((entry) => entry.columns.length > 0);

  return () => {
    const previous = cached;
    const fresh =
      previous !== null &&
      (complete(previous.present) || Date.now() - previous.checkedAt < RECHECK_MS);
    if (fresh && previous !== null) return Promise.resolve(resolve(previous.present));
    running ??= known()
      .then(
        (present) => {
          cached = { present, checkedAt: Date.now() };
          return resolve(present);
        },
        () => {
          cached = { present: null, checkedAt: Date.now() };
          return [];
        },
      )
      .finally(() => {
        running = null;
      });
    return running;
  };
}

/** Reads the whole picture key space as the server's own database role. */
export function createPostgresMediaKeyReferences(pool: Pool): MediaKeyReferences {
  const columns = existingColumns(async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [PICTURE_KEY_COLUMNS.map((entry) => entry.table)],
    );
    return new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  });

  return {
    async inUse(baseKey) {
      try {
        const present = await columns();
        if (present.length === 0) return null;
        const keys = pictureKeys(baseKey);
        const branch = (entry: PictureKeyColumn) =>
          `select 1 from public.${entry.table} where ${entry.columns
            .map((column) => `${column} = any($1::text[])`)
            .join(' or ')}`;
        const { rows } = await pool.query<{ in_use: boolean }>(
          `select exists (${present.map(branch).join(' union all ')}) as in_use`,
          [keys],
        );
        return rows[0]?.in_use === true;
      } catch {
        return null;
      }
    },
  };
}

/** The same question over PostgREST, with the service key so no table is hidden by RLS. */
export function createSupabaseMediaKeyReferences(clients: SupabaseClients): MediaKeyReferences {
  const columns = existingColumns(async () => {
    // One small read decides whether the brand-banner migration has run.
    // One small read each decides whether the brand-banner and category-banner migrations ran.
    const missing = new Set<string>();
    for (const table of ['brands', 'categories']) {
      const probe = await clients.admin
        .from(table as 'brands' | 'categories')
        .select('banner_key')
        .limit(1);
      if (probe.error === null) continue;
      if (probe.error.code !== '42703' && probe.error.code !== 'PGRST204') return null;
      missing.add(`${table}.banner_key`);
    }
    return new Set(PICTURE_KEY_COLUMNS.flatMap(names).filter((name) => !missing.has(name)));
  });

  return {
    async inUse(baseKey) {
      try {
        const present = await columns();
        if (present.length === 0) return null;
        const values = pictureKeys(baseKey)
          .map((key) => `"${key.replaceAll('"', '\\"')}"`)
          .join(',');
        const answers = await Promise.all(
          present.map((entry) =>
            clients.admin
              .from(entry.table as 'brands')
              .select('*', { count: 'exact', head: true })
              .or(entry.columns.map((column) => `${column}.in.(${values})`).join(',')),
          ),
        );
        for (const answer of answers) if (answer.error !== null) return null;
        return answers.some((answer) => (answer.count ?? 0) > 0);
      } catch {
        return null;
      }
    },
  };
}

function names(entry: PictureKeyColumn): string[] {
  return entry.columns.map((column) => `${entry.table}.${column}`);
}
