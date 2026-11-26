import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config/env';
import {
  toProductImage,
  toProductImages,
  variantKeys,
  type ImageRow,
} from '../modules/media/images';
import { TEST_SUPABASE_ENV } from './helpers';

const R2 = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'AKIATESTTESTTEST',
  R2_SECRET_ACCESS_KEY: 'test-secret-not-real',
  R2_BUCKET: 'nilzora-media',
  R2_PUBLIC_BASE_URL: 'https://media.example.com',
};

function load(env: Record<string, string> = {}, nodeEnv = 'development') {
  return loadConfig({
    NODE_ENV: nodeEnv,
    ...TEST_SUPABASE_ENV,
    ...(nodeEnv === 'production'
      ? {
          CORS_ORIGINS: 'https://shop.example.com',
          ADMIN_APP_ORIGIN: 'https://admin.example.com',
          TRUSTED_CLIENT_SECRET: 'x'.repeat(40),
          SUPABASE_URL: 'https://project.supabase.co',
        }
      : {}),
    ...env,
  });
}

describe('R2 media configuration', () => {
  it('leaves media off when no R2 setting is present', () => {
    const config = load();

    expect(config.media).toBeUndefined();
    expect(config.incompleteIntegrations).toEqual([]);
  });

  it('turns media on when all five settings are present', () => {
    const config = load(R2);

    expect(config.media).toEqual({
      accountId: '0123456789abcdef0123456789abcdef',
      accessKeyId: 'AKIATESTTESTTEST',
      secretAccessKey: 'test-secret-not-real',
      bucket: 'nilzora-media',
      publicBaseUrl: 'https://media.example.com',
    });
  });

  it('treats blank values as unset', () => {
    const config = load({ ...R2, R2_PUBLIC_BASE_URL: '' });

    expect(config.media).toBeUndefined();
  });

  it('strips a trailing slash from the public base URL and keeps a path', () => {
    expect(
      load({ ...R2, R2_PUBLIC_BASE_URL: 'https://cdn.example.com/media/' }).media?.publicBaseUrl,
    ).toBe('https://cdn.example.com/media');
  });

  it('keeps media off and names the missing settings when only some are set (development)', () => {
    const config = load({ ...R2, R2_PUBLIC_BASE_URL: '' });

    expect(config.media).toBeUndefined();
    expect(config.incompleteIntegrations).toEqual([
      'R2 media storage (missing R2_PUBLIC_BASE_URL)',
    ]);
  });

  it('fails the start in production when only some settings are set, naming variables only', () => {
    const attempt = () => load({ ...R2, R2_PUBLIC_BASE_URL: '' }, 'production');

    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('R2_PUBLIC_BASE_URL');
      expect(message).not.toContain(R2.R2_SECRET_ACCESS_KEY);
    }
  });

  it('accepts production with every setting and an https public URL', () => {
    expect(load(R2, 'production').media?.bucket).toBe('nilzora-media');
  });

  it.each([
    ['http in production', { R2_PUBLIC_BASE_URL: 'http://media.example.com' }, 'production'],
    [
      'credentials in the URL',
      { R2_PUBLIC_BASE_URL: 'https://user:pw@media.example.com' },
      'development',
    ],
    ['a query string', { R2_PUBLIC_BASE_URL: 'https://media.example.com/?a=1' }, 'development'],
    ['a non-URL', { R2_PUBLIC_BASE_URL: 'media.example.com' }, 'development'],
    ['a non-http scheme', { R2_PUBLIC_BASE_URL: 'ftp://media.example.com' }, 'development'],
    ['an invalid bucket name', { R2_BUCKET: 'Bad_Bucket!' }, 'development'],
  ])('refuses %s', (_label, override, nodeEnv) => {
    expect(() => load({ ...R2, ...override }, nodeEnv)).toThrow(ConfigError);
  });

  it('allows http for a local public URL outside production', () => {
    expect(
      load({ ...R2, R2_PUBLIC_BASE_URL: 'http://localhost:9000/nilzora' }).media?.publicBaseUrl,
    ).toBe('http://localhost:9000/nilzora');
  });

  it('refuses the S3 endpoint as the public base URL, which cannot serve reads', () => {
    const attempt = () =>
      load({
        ...R2,
        R2_PUBLIC_BASE_URL: `https://${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      });

    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('R2_PUBLIC_BASE_URL');
      expect(message).toContain('public bucket address');
    }
  });

  it('folds an upper-case account id to lower case, which is the same account', () => {
    expect(
      load({ ...R2, R2_ACCOUNT_ID: R2.R2_ACCOUNT_ID.toUpperCase() }).media?.accountId,
    ).toBe(R2.R2_ACCOUNT_ID);
  });

  it('keeps media off with a warning outside production when the account id is unusable', () => {
    const config = load({ ...R2, R2_ACCOUNT_ID: `https://${R2.R2_ACCOUNT_ID}.r2.dev` });

    expect(config.media).toBeUndefined();
    expect(config.incompleteIntegrations).toEqual([
      'R2_ACCOUNT_ID: must be the account id alone, not a URL or a host name (media storage stays off)',
    ]);
  });

  it('reports a wrong-length account id by length, never by value', () => {
    const truncated = R2.R2_ACCOUNT_ID.slice(0, 20);
    const config = load({ ...R2, R2_ACCOUNT_ID: truncated });

    expect(config.media).toBeUndefined();
    expect(config.incompleteIntegrations[0]).toContain('32-character hexadecimal');
    expect(JSON.stringify(config.incompleteIntegrations)).not.toContain(truncated);
  });

  it('fails the start in production when the account id cannot produce an endpoint', () => {
    const attempt = () => load({ ...R2, R2_ACCOUNT_ID: 'not-an-account-id' }, 'production');

    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('R2_ACCOUNT_ID');
      expect(message).not.toContain('not-an-account-id');
    }
  });
});

describe('product image URLs', () => {
  const row: ImageRow = {
    id: '11111111-1111-4111-8111-111111111111',
    storage_key:
      'products/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111',
    width: 1200,
    height: 800,
    alt_text: 'Front',
    position: 0,
  };

  it('builds both URLs from the configured base, never from stored URLs', () => {
    expect(toProductImage(row, 'https://media.example.com')).toEqual({
      id: row.id,
      url: `https://media.example.com/${row.storage_key}/full.webp`,
      thumbUrl: `https://media.example.com/${row.storage_key}/thumb.webp`,
      alt: 'Front',
      width: 1200,
      height: 800,
      position: 0,
    });
    expect(variantKeys(row.storage_key)).toEqual([
      `${row.storage_key}/full.webp`,
      `${row.storage_key}/thumb.webp`,
    ]);
  });

  it('returns no images when media is not configured, rather than broken links', () => {
    expect(toProductImage(row, undefined)).toBeNull();
    expect(toProductImages([row], undefined)).toEqual([]);
  });

  it('orders images by position', () => {
    const second: ImageRow = { ...row, id: '33333333-3333-4333-8333-333333333333', position: 1 };

    const ordered = toProductImages([second, row], 'https://media.example.com');

    expect(ordered.map((image) => image.position)).toEqual([0, 1]);
  });
});
