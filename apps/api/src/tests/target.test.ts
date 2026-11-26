import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config/env';
import {
  classifyDatabaseUrl,
  classifySupabaseUrl,
  describeTarget,
  targetProblems,
  withProjectRef,
} from '../config/target';

const HOSTED_SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co';
const HOSTED_DB_POOLER =
  'postgresql://postgres.fake:not-a-real-password@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require';
const HOSTED_DB_DIRECT =
  'postgresql://postgres:not-a-real-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require';
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable';

const KEYS = {
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key-not-real-0000',
  SUPABASE_SECRET_KEY: 'test-secret-key-not-real-000000000',
};

function config(env: Record<string, string>): ReturnType<typeof loadConfig> {
  return loadConfig({ ...KEYS, ...env });
}

describe('classifyDatabaseUrl', () => {
  it.each([
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'local', 'local'],
    ['postgresql://postgres:postgres@localhost:54322/postgres', 'local', 'local'],
    ['postgresql://postgres:postgres@[::1]:54322/postgres', 'local', 'local'],
  ])('reads %s as a local stack', (url, mode, connection) => {
    expect(classifyDatabaseUrl(url)).toStrictEqual({ mode, connection, projectRef: null });
  });

  it('reads a Supabase pooler host as hosted, without inventing a project ref', () => {
    expect(classifyDatabaseUrl(HOSTED_DB_POOLER)).toStrictEqual({
      mode: 'hosted',
      connection: 'pooler',
      projectRef: null,
    });
  });

  it('reads a direct Supabase host and its project ref', () => {
    expect(classifyDatabaseUrl(HOSTED_DB_DIRECT)).toStrictEqual({
      mode: 'hosted',
      connection: 'direct',
      projectRef: 'abcdefghijklmnopqrst',
    });
  });

  it('treats an unrecognised host as other', () => {
    expect(classifyDatabaseUrl('postgresql://u:p@db.example.internal:5432/postgres')).toStrictEqual({
      mode: 'other',
      connection: 'other',
      projectRef: null,
    });
  });

  it.each([undefined, 'not a url', ''])('never reports %s as local', (url) => {
    expect(classifyDatabaseUrl(url).mode).toBe('other');
  });
});

describe('classifySupabaseUrl', () => {
  it('reads a hosted project ref', () => {
    expect(classifySupabaseUrl(HOSTED_SUPABASE)).toStrictEqual({
      mode: 'hosted',
      connection: 'other',
      projectRef: 'abcdefghijklmnopqrst',
    });
  });

  it('reads the local stack', () => {
    expect(classifySupabaseUrl('http://127.0.0.1:54321').mode).toBe('local');
  });
});

describe('targetProblems', () => {
  it('reports nothing when both sides agree', () => {
    expect(
      targetProblems(classifyDatabaseUrl(HOSTED_DB_POOLER), classifySupabaseUrl(HOSTED_SUPABASE)),
    ).toStrictEqual([]);
  });

  it('reports a split stack: local database, hosted Auth', () => {
    const problems = targetProblems(
      classifyDatabaseUrl(LOCAL_DB),
      classifySupabaseUrl(HOSTED_SUPABASE),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('different stacks');
  });

  it('reports two different hosted projects', () => {
    const otherProject = 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co';
    const problems = targetProblems(
      classifyDatabaseUrl(HOSTED_DB_DIRECT),
      classifySupabaseUrl(otherProject),
    );
    expect(problems).toEqual(['DATABASE_URL and SUPABASE_URL name different Supabase projects']);
  });
});

describe('loadConfig database target', () => {
  it('records the target of the configured database', () => {
    const loaded = config({
      NODE_ENV: 'development',
      SUPABASE_URL: HOSTED_SUPABASE,
      DATABASE_URL: HOSTED_DB_DIRECT,
    });
    expect(loaded.databaseTarget).toStrictEqual({
      mode: 'hosted',
      connection: 'direct',
      projectRef: 'abcdefghijklmnopqrst',
    });
  });

  it('refuses a local database paired with hosted Auth', () => {
    expect(() =>
      config({ NODE_ENV: 'development', SUPABASE_URL: HOSTED_SUPABASE, DATABASE_URL: LOCAL_DB }),
    ).toThrow(ConfigError);
  });

  it('refuses to start production on the local database', () => {
    try {
      config({ NODE_ENV: 'production', SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: LOCAL_DB });
      throw new Error('expected ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toContain(
        'DATABASE_URL: production must not use the local database',
      );
    }
  });

  it('refuses to let a test run reach the hosted database', () => {
    try {
      config({
        NODE_ENV: 'test',
        SUPABASE_URL: HOSTED_SUPABASE,
        DATABASE_URL: HOSTED_DB_POOLER,
      });
      throw new Error('expected ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toContain(
        'DATABASE_URL: tests must not connect to a hosted database',
      );
    }
  });

  it('accepts a configuration with no direct connection at all', () => {
    const loaded = config({ NODE_ENV: 'development', SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(loaded.databaseUrl).toBeUndefined();
    expect(loaded.databaseTarget.mode).toBe('other');
  });

  it('never echoes a credential in the refusal message', () => {
    try {
      config({ NODE_ENV: 'development', SUPABASE_URL: HOSTED_SUPABASE, DATABASE_URL: LOCAL_DB });
      throw new Error('expected ConfigError');
    } catch (error) {
      expect((error as Error).message).not.toContain('not-a-real-password');
      expect((error as Error).message).not.toContain('postgres@');
    }
  });
});

describe('withProjectRef', () => {
  it('borrows the ref from SUPABASE_URL when the pooler host carries none', () => {
    const merged = withProjectRef(
      classifyDatabaseUrl(HOSTED_DB_POOLER),
      classifySupabaseUrl(HOSTED_SUPABASE),
    );
    expect(merged.projectRef).toBe('abcdefghijklmnopqrst');
    expect(merged.connection).toBe('pooler');
  });

  it('keeps a ref the database host already names', () => {
    const merged = withProjectRef(
      classifyDatabaseUrl(HOSTED_DB_DIRECT),
      classifySupabaseUrl('https://zzzzzzzzzzzzzzzzzzzz.supabase.co'),
    );
    expect(merged.projectRef).toBe('abcdefghijklmnopqrst');
  });

  it('adds nothing to a local target', () => {
    const merged = withProjectRef(classifyDatabaseUrl(LOCAL_DB), classifySupabaseUrl(HOSTED_SUPABASE));
    expect(merged.projectRef).toBeNull();
  });
});

describe('describeTarget', () => {
  it('summarises a hosted target with its project ref and no host', () => {
    const line = describeTarget(classifyDatabaseUrl(HOSTED_DB_DIRECT));
    expect(line).toBe('hosted/direct ref=abcdefghijklmnopqrst');
    expect(line).not.toContain('supabase.co');
  });

  it('summarises a local target', () => {
    expect(describeTarget(classifyDatabaseUrl(LOCAL_DB))).toBe('local/local');
  });
});
