import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connectionSettings } from '../db/pool';
import { SUPABASE_ROOT_CA, SUPABASE_ROOT_CA_SHA256 } from '../db/supabase-ca';

const POOLER =
  'postgresql://postgres.abcdefghijklmnopqrst:pw%40x@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres';
const VERIFIED = { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };

describe('Supabase root CA', () => {
  it('is the pinned, self-signed root and still valid', () => {
    const certificate = new X509Certificate(SUPABASE_ROOT_CA);
    expect(certificate.fingerprint256).toBe(SUPABASE_ROOT_CA_SHA256);
    expect(certificate.subject).toContain('Supabase Root 2021 CA');
    expect(certificate.issuer).toBe(certificate.subject);
    expect(certificate.ca).toBe(true);
    expect(new Date(certificate.validTo).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('database connection settings', () => {
  it('verifies a hosted pooler against the Supabase CA when the URL has no TLS options', () => {
    expect(connectionSettings(POOLER)).toEqual({ connectionString: POOLER, ssl: VERIFIED });
  });

  it('replaces sslmode=require, which would verify against Node CAs and fail, keeping other options', () => {
    const settings = connectionSettings(`${POOLER}?pgbouncer=true&sslmode=require`);
    expect(settings.ssl).toEqual(VERIFIED);
    expect(settings.connectionString).toBe(`${POOLER}?pgbouncer=true`);
  });

  it('cannot be weakened from the URL', () => {
    for (const weak of [
      'sslmode=disable',
      'sslmode=no-verify',
      'sslmode=prefer',
      'sslrootcert=system',
      'uselibpqcompat=true&sslmode=require',
    ]) {
      const settings = connectionSettings(`${POOLER}?${weak}`);
      expect(settings.ssl).toEqual(VERIFIED);
      expect(settings.connectionString).not.toMatch(/ssl|uselibpqcompat/);
    }
  });

  it('recognises the direct database host too', () => {
    const direct = 'postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
    expect(connectionSettings(direct).ssl).toEqual(VERIFIED);
  });

  it('leaves local and other hosts exactly as the URL says', () => {
    for (const url of [
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'postgresql://u:p@db.example.com:5432/app?sslmode=require',
    ]) {
      expect(connectionSettings(url)).toEqual({ connectionString: url });
    }
  });

  it('does not treat look-alike host names as Supabase', () => {
    for (const host of ['evil-supabase.co', 'supabase.co.evil.test', 'notsupabase.com']) {
      const url = `postgresql://u:p@${host}:5432/postgres`;
      expect(connectionSettings(url)).toEqual({ connectionString: url });
    }
  });

  it('passes an unparseable string through for the driver to reject', () => {
    expect(connectionSettings('not a url')).toEqual({ connectionString: 'not a url' });
  });
});
