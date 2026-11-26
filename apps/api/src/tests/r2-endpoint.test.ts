import { describe, expect, it } from 'vitest';
import {
  R2EndpointError,
  R2_STORAGE_HOST_SUFFIX,
  isR2StorageHost,
  normalizeR2AccountId,
  resolveR2Endpoint,
} from '../modules/media/r2-endpoint';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

describe('resolveR2Endpoint', () => {
  it('derives the documented S3 endpoint from a bare account id', () => {
    expect(resolveR2Endpoint(ACCOUNT_ID)).toBe(
      `https://${ACCOUNT_ID}${R2_STORAGE_HOST_SUFFIX}`,
    );
  });

  it('trims surrounding whitespace, which a copied value often carries', () => {
    expect(resolveR2Endpoint(`  ${ACCOUNT_ID}\n`)).toBe(
      `https://${ACCOUNT_ID}${R2_STORAGE_HOST_SUFFIX}`,
    );
  });

  it('accepts an id pasted in upper case and folds it to lower case', () => {
    const upper = ACCOUNT_ID.toUpperCase();

    expect(normalizeR2AccountId(upper)).toBe(ACCOUNT_ID);
    expect(resolveR2Endpoint(upper)).toBe(`https://${ACCOUNT_ID}${R2_STORAGE_HOST_SUFFIX}`);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a pasted endpoint URL', `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`],
    ['a pasted host name', `${ACCOUNT_ID}.r2.cloudflarestorage.com`],
    ['a scheme only', 'https://'],
    ['a trailing path', `${ACCOUNT_ID}/bucket`],
    ['a shortened id', ACCOUNT_ID.slice(0, 31)],
    ['an elongated id', `${ACCOUNT_ID}0`],
    ['a non-hex id', 'z'.repeat(32)],
    ['a bucket-qualified id', `${ACCOUNT_ID}-media`],
  ])('refuses %s', (_label, value) => {
    expect(() => resolveR2Endpoint(value)).toThrow(R2EndpointError);
  });

  it('names the variable and the expected shape without repeating the value', () => {
    const pasted = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
    let message = '';
    try {
      resolveR2Endpoint(pasted);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('R2_ACCOUNT_ID');
    expect(message).not.toContain(ACCOUNT_ID);
  });

  it('reports the length of a wrong id, never the id itself', () => {
    let message = '';
    try {
      resolveR2Endpoint(`${ACCOUNT_ID}9`);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('33 characters');
    expect(message).not.toContain(ACCOUNT_ID);
  });

  it('produces an https origin with no credentials, port, query or fragment', () => {
    const url = new URL(resolveR2Endpoint(ACCOUNT_ID));

    expect(url.protocol).toBe('https:');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.port).toBe('');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.pathname).toBe('/');
  });
});

describe('isR2StorageHost', () => {
  it('recognises the S3 API host family', () => {
    expect(isR2StorageHost(`${ACCOUNT_ID}.r2.cloudflarestorage.com`)).toBe(true);
    expect(isR2StorageHost('R2.CLOUDFLARESTORAGE.COM')).toBe(true);
    expect(isR2StorageHost('pub-0123456789abcdef.r2.dev')).toBe(false);
    expect(isR2StorageHost('media.example.com')).toBe(false);
  });
});
