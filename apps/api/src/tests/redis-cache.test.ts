import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createCatalogCache, type CatalogCache } from '../cache/catalog-cache';
import { createRedisClient, type KeyValueStore } from '../cache/redis-client';
import { parseRedisUrl } from '../cache/redis-url';

/*
 * The real Redis path, against whatever `REDIS_URL` points at (a local `redis-server` during
 * development). Skipped when it is unset, so the default suite never needs a server.
 *
 * Every key this file writes starts with `nilzora:selftest:` and lives for a few seconds;
 * only those keys are ever deleted. Nothing else in the database is read, written or flushed.
 */

const redisUrl = process.env.REDIS_URL;
const parsed = parseRedisUrl(redisUrl);
const enabled = parsed.ok;

const PREFIX = `nilzora:selftest:${randomUUID()}`;
const created: string[] = [];

function client(): KeyValueStore {
  if (!parsed.ok) throw new Error('REDIS_URL is not a Redis URL');
  return createRedisClient(parsed.connection, { commandTimeoutMs: 3_000 });
}

const main = enabled ? client() : null;

afterAll(async () => {
  if (main !== null && created.length > 0) await main.del(created);
  await main?.close();
});

describe.skipIf(!enabled)('Redis cache against a real server', () => {
  it('answers PING', async () => {
    await expect(main?.ping()).resolves.toBe(true);
  });

  it('writes, reads and expires a value', async () => {
    const key = `${PREFIX}:ttl`;
    created.push(key);

    await main?.set(key, 'value-1', 1);
    await expect(main?.get(key)).resolves.toBe('value-1');

    // The shortest TTL Redis accepts is one second: wait it out rather than rounding up.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(main?.get(key)).resolves.toBeNull();
  });

  it('deletes exactly the keys it is given', async () => {
    const keep = `${PREFIX}:keep`;
    const drop = `${PREFIX}:drop`;
    created.push(keep, drop);
    await main?.set(keep, 'k', 30);
    await main?.set(drop, 'd', 30);

    await expect(main?.del([drop])).resolves.toBe(1);
    await expect(main?.get(keep)).resolves.toBe('k');
    await expect(main?.get(drop)).resolves.toBeNull();
  });

  it('serves the second read of a cached document without loading it again', async () => {
    const cache: CatalogCache = createCatalogCache(main, { ttlSeconds: 5 });
    let loads = 0;
    const load = (): Promise<string[]> => {
      loads += 1;
      return Promise.resolve(['fashion']);
    };

    await expect(cache.read('nilzora:v1:catalog:categories', parse, load)).resolves.toStrictEqual([
      'fashion',
    ]);
    await expect(cache.read('nilzora:v1:catalog:categories', parse, load)).resolves.toStrictEqual([
      'fashion',
    ]);
    expect(loads).toBe(1);

    // Clean up through the cache's own invalidation, then confirm the key is gone.
    await cache.invalidate();
    await expect(main?.get('nilzora:v1:catalog:categories')).resolves.toBeNull();
  });

  it('unavailable Redis falls back to the loader instead of failing the request', async () => {
    // A port nothing listens on: the connection attempt fails fast.
    const unreachable = createRedisClient(
      {
        tls: false,
        host: '127.0.0.1',
        port: 6399,
        username: undefined,
        password: undefined,
        database: 0,
      },
      { commandTimeoutMs: 500, retryDelayMs: 60_000 },
    );
    const cache = createCatalogCache(unreachable, { ttlSeconds: 5 });

    await expect(
      cache.read('nilzora:v1:catalog:brands', parse, () => Promise.resolve(['from-database'])),
    ).resolves.toStrictEqual(['from-database']);
    await expect(unreachable.isAvailable()).resolves.toBe(false);

    await unreachable.close();
  });
});

function parse(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}
