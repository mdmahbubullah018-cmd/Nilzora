import { describe, expect, it } from 'vitest';
import { describeRedisConnection, parseRedisUrl } from '../cache/redis-url';

describe('parseRedisUrl', () => {
  it('reads a plain local URL', () => {
    const result = parseRedisUrl('redis://127.0.0.1:6379/0');

    expect(result).toStrictEqual({
      ok: true,
      connection: {
        tls: false,
        host: '127.0.0.1',
        port: 6379,
        username: undefined,
        password: undefined,
        database: 0,
      },
    });
  });

  it('reads a TLS URL with credentials, as Upstash shows it', () => {
    const result = parseRedisUrl('rediss://default:s3cret@example.upstash.io:6379');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connection).toMatchObject({
      tls: true,
      host: 'example.upstash.io',
      port: 6379,
      username: 'default',
      password: 's3cret',
      database: 0,
    });
  });

  it('defaults the port and reads a database index', () => {
    const result = parseRedisUrl('redis://cache.internal/2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connection.port).toBe(6379);
    expect(result.connection.database).toBe(2);
  });

  it('decodes escaped credentials', () => {
    const result = parseRedisUrl('redis://user:p%40ss%3Aword@redis.internal:7000');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connection.password).toBe('p@ss:word');
  });

  it('refuses anything that is not a Redis URL', () => {
    expect(parseRedisUrl(undefined)).toStrictEqual({ ok: false, problem: 'unparseable' });
    expect(parseRedisUrl('')).toStrictEqual({ ok: false, problem: 'unparseable' });
    expect(parseRedisUrl('not a url')).toStrictEqual({ ok: false, problem: 'unparseable' });
    expect(parseRedisUrl('https://redis.example.com')).toStrictEqual({
      ok: false,
      problem: 'wrong_scheme',
    });
  });

  it('refuses credentials in a query string, where they are easy to log', () => {
    expect(parseRedisUrl('redis://cache.internal:6379/0?password=s3cret')).toStrictEqual({
      ok: false,
      problem: 'credentials_in_query',
    });
  });

  it('refuses an impossible database index', () => {
    expect(parseRedisUrl('redis://cache.internal/99')).toStrictEqual({
      ok: false,
      problem: 'bad_database',
    });
    expect(parseRedisUrl('redis://cache.internal/one')).toStrictEqual({
      ok: false,
      problem: 'bad_database',
    });
  });

  it('never prints credentials in the log-safe description', () => {
    const result = parseRedisUrl('rediss://default:s3cret@example.upstash.io:6380');
    if (!result.ok) throw new Error('expected a parsed connection');

    const description = describeRedisConnection(result.connection);

    expect(description).toBe('rediss://example.upstash.io:6380');
    expect(description).not.toContain('s3cret');
    expect(description).not.toContain('default');
  });
});
