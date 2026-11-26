import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPostgresMediaKeyReferences,
  createSupabaseMediaKeyReferences,
  pictureKeys,
} from '../modules/media/references';
import type { SupabaseClients } from '../supabase/clients';

/*
 * Before a brand picture is deleted from storage, the API asks whether any record still keeps
 * its key. The answer comes from one query (direct connection) or one count per table
 * (PostgREST), always over the server's own connection, and an unanswerable question is "keep
 * the file" rather than "delete it".
 */

const BASE = 'brands/0d000000-0000-4000-8000-000000000001/0d000000-0000-4000-8000-000000000002';

describe('pictureKeys', () => {
  it('asks about the base key and both stored objects', () => {
    expect(pictureKeys(BASE)).toEqual([BASE, `${BASE}/full.webp`, `${BASE}/thumb.webp`]);
  });
});

function postgresPool(
  answers: { probe: string[]; inUse?: boolean },
  failure: 'probe' | 'query' | null = null,
) {
  const queries: { text: string; values: unknown[] | undefined }[] = [];
  const fake = {
    query: (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes('information_schema')) {
        if (failure === 'probe') return Promise.reject(new Error('unreachable'));
        return Promise.resolve({
          rows: answers.probe.map((name) => {
            const [table_name, column_name] = name.split('.');
            return { table_name, column_name };
          }),
        });
      }
      if (failure === 'query') return Promise.reject(new Error('unreachable'));
      return Promise.resolve({ rows: [{ in_use: answers.inUse === true }] });
    },
  } as unknown as Pool;
  return { references: createPostgresMediaKeyReferences(fake), queries };
}

describe('createPostgresMediaKeyReferences', () => {
  it('asks one query across the tables that exist, with the object keys', async () => {
    const { references, queries } = postgresPool({
      probe: ['brands.logo_key', 'brands.banner_key', 'discount_campaigns.banner_image_key'],
      inUse: true,
    });

    await expect(references.inUse(BASE)).resolves.toBe(true);

    expect(queries).toHaveLength(2);
    const query = queries[1];
    expect(query?.text).toContain('public.brands');
    expect(query?.text).toContain('public.discount_campaigns');
    expect(query?.text).not.toContain('public.banners');
    expect(query?.values).toEqual([pictureKeys(BASE)]);
  });

  it('leaves out a column the database does not have yet', async () => {
    const { references, queries } = postgresPool({ probe: ['brands.logo_key'], inUse: false });

    await expect(references.inUse(BASE)).resolves.toBe(false);

    expect(queries[1]?.text).toContain('logo_key');
    expect(queries[1]?.text).not.toContain('banner_key');
  });

  it('asks the schema once per process, not once per picture', async () => {
    const { references, queries } = postgresPool({ probe: ['brands.logo_key'], inUse: false });

    await references.inUse(BASE);
    await references.inUse(BASE);

    expect(queries.filter((entry) => entry.text.includes('information_schema'))).toHaveLength(1);
  });

  it('answers null when the question cannot be answered', async () => {
    await expect(postgresPool({ probe: [] }, 'probe').references.inUse(BASE)).resolves.toBeNull();
    await expect(
      postgresPool({ probe: ['brands.logo_key'] }, 'query').references.inUse(BASE),
    ).resolves.toBeNull();
  });
});

interface SupabaseAnswers {
  count?: number;
  probeError?: { code: string } | null;
  queryError?: boolean;
}

function supabaseClients(answers: SupabaseAnswers = {}) {
  const asked: { table: string; filter: string }[] = [];
  const fake = {
    admin: {
      from: (name: string) => ({
        select: (_columns: string, options?: { head?: boolean; count?: string }) => {
          if (options === undefined) {
            // The one-off probe: does this database have brands.banner_key?
            return {
              limit: () =>
                Promise.resolve({
                  error: answers.probeError ?? null,
                  data: answers.probeError ? null : [],
                }),
            };
          }
          return {
            or: (filter: string) => {
              asked.push({ table: name, filter });
              return Promise.resolve(
                answers.queryError
                  ? { count: null, error: { code: '42501', message: 'denied' } }
                  : { count: answers.count ?? 0, error: null },
              );
            },
          };
        },
      }),
    },
  } as unknown as SupabaseClients;
  return { references: createSupabaseMediaKeyReferences(fake), asked };
}

describe('createSupabaseMediaKeyReferences', () => {
  it('counts rows per table, with the keys quoted for the filter', async () => {
    const { references, asked } = supabaseClients({ count: 2 });

    await expect(references.inUse(BASE)).resolves.toBe(true);

    const brands = asked.find((entry) => entry.table === 'brands');
    expect(brands?.filter).toContain(
      `logo_key.in.("${BASE}","${BASE}/full.webp","${BASE}/thumb.webp")`,
    );
    expect(asked.some((entry) => entry.table === 'banners')).toBe(true);
  });

  it('answers false when no table keeps the picture', async () => {
    const { references } = supabaseClients({ count: 0 });

    await expect(references.inUse(BASE)).resolves.toBe(false);
  });

  it('answers null when a table cannot be read, so the file is kept', async () => {
    const { references } = supabaseClients({ queryError: true });

    await expect(references.inUse(BASE)).resolves.toBeNull();
  });

  it('treats a missing banner column as "not there yet" and still answers', async () => {
    const { references, asked } = supabaseClients({ count: 0, probeError: { code: '42703' } });

    await expect(references.inUse(BASE)).resolves.toBe(false);
    expect(asked.find((entry) => entry.table === 'brands')?.filter).not.toContain('banner_key');
  });

  it('answers null when the schema itself cannot be read', async () => {
    const { references } = supabaseClients({ probeError: { code: '42501' } });

    await expect(references.inUse(BASE)).resolves.toBeNull();
  });

  it('never throws, even when the client itself fails', async () => {
    const broken = {
      admin: {
        from: () => {
          throw new Error('boom');
        },
      },
    } as unknown as SupabaseClients;

    await expect(createSupabaseMediaKeyReferences(broken).inUse(BASE)).resolves.toBeNull();
  });
});
