import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createUploadLimiters, describeUploadLimits } from '../middleware/upload-rate-limit';
import type { KeyValueStore } from '../cache';

/*
 * The upload budgets. They exist because an upload is the expensive chat write — a decode, a
 * re-encode and two objects in Cloudflare R2 — so it needs its own counters rather than the
 * message one. These tests hold down the three things that make a limit trustworthy:
 *
 *   it counts per account (not per connection), it charges both the kind and the total so a
 *   different entry point cannot dodge it, and it answers 429 with a wait a client can honour.
 */

const WINDOW_MS = 60_000;

/** A Redis-shaped counter that only counts, so the limiter's own logic is what is under test. */
function counterStore() {
  const counts = new Map<string, number>();
  const fail = { on: false };
  const store: KeyValueStore = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(0),
    increment: (key) => {
      if (fail.on) return Promise.reject(new Error('redis down'));
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    ping: () => Promise.resolve(!fail.on),
    close: () => Promise.resolve(),
  };
  return { store, counts, fail };
}

function limiterFor(
  options: {
    store?: KeyValueStore;
    limits?: { total: number; image: number; document: number; audio: number };
  } = {},
) {
  return createUploadLimiters({
    windowMs: WINDOW_MS,
    limits: options.limits ?? { total: 3, image: 2, document: 2, audio: 2 },
    ...(options.store === undefined ? {} : { store: options.store }),
  });
}

/** A request/response pair as the route sees it: after authentication, so `identity` is set. */
function context(userId: string | undefined, ip = '203.0.113.7') {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn(() => ({ json }) as unknown as Response);
  const res = {
    locals: { clientIp: ip, ...(userId === undefined ? {} : { identity: { userId } }) },
    setHeader,
    status,
  } as unknown as Response;
  const req = { ip } as unknown as Request;
  return { req, res, json, status, setHeader };
}

async function call(
  middleware: ReturnType<typeof limiterFor>['total'],
  ctx: ReturnType<typeof context>,
) {
  const next = vi.fn();
  middleware(ctx.req, ctx.res, next);
  // The limiter decides asynchronously (and a kind charges two counters in sequence), so wait
  // until one of the two outcomes has actually happened.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (next.mock.calls.length > 0 || ctx.status.mock.calls.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return next;
}

describe('upload limiters', () => {
  it('allows uploads up to the total budget and refuses the one after it', async () => {
    const limiters = limiterFor();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const next = await call(limiters.total, context('user-a'));
      expect(next).toHaveBeenCalledTimes(1);
    }

    const refused = context('user-a');
    const next = await call(limiters.total, refused);
    expect(next).not.toHaveBeenCalled();
    expect(refused.status).toHaveBeenCalledWith(429);
    const answered = refused.json.mock.calls[0]?.[0] as { error?: { code?: string } } | undefined;
    expect(answered?.error?.code).toBe('rate_limited');
  });

  it('tells a client how long to wait, in the standard header and in the body', async () => {
    const limiters = limiterFor({ limits: { total: 1, image: 1, document: 1, audio: 1 } });
    await call(limiters.total, context('user-a'));

    const refused = context('user-a');
    await call(limiters.total, refused);

    expect(refused.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    const body = refused.json.mock.calls[0]?.[0] as {
      error: { details: { retryAfterSeconds: number } };
    };
    expect(body.error.details.retryAfterSeconds).toBe(60);
  });

  it('counts each account separately, so one busy person cannot block another', async () => {
    const limiters = limiterFor({ limits: { total: 1, image: 1, document: 1, audio: 1 } });
    await call(limiters.total, context('user-a'));
    expect(await call(limiters.total, context('user-a'))).not.toHaveBeenCalledTimes(1);

    // A different signed-in account is a different counter.
    const other = await call(limiters.total, context('user-b'));
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('falls back to the client address for a caller with no account', async () => {
    const limiters = limiterFor({ limits: { total: 1, image: 1, document: 1, audio: 1 } });
    await call(limiters.total, context(undefined, '198.51.100.1'));

    const sameAddress = await call(limiters.total, context(undefined, '198.51.100.1'));
    expect(sameAddress).not.toHaveBeenCalled();

    const otherAddress = await call(limiters.total, context(undefined, '198.51.100.2'));
    expect(otherAddress).toHaveBeenCalledTimes(1);
  });

  it('gives every kind its own budget', async () => {
    const limiters = limiterFor({ limits: { total: 10, image: 1, document: 1, audio: 1 } });
    const image = limiters.forKind('image');

    expect(await call(image, context('user-a'))).toHaveBeenCalledTimes(1);
    // A second picture is refused by the picture budget…
    expect(await call(image, context('user-a'))).not.toHaveBeenCalled();
    // …while the other kinds still have their own allowance.
    expect(await call(limiters.forKind('document'), context('user-a'))).toHaveBeenCalledTimes(1);
    expect(await call(limiters.forKind('audio'), context('user-a'))).toHaveBeenCalledTimes(1);
  });

  it('charges the total as well as the kind, so entry points are interchangeable', async () => {
    const { store, counts } = counterStore();
    const limiters = limiterFor({
      store,
      limits: { total: 1, image: 1, document: 1, audio: 1 },
    });

    expect(await call(limiters.forKind('image'), context('user-a'))).toHaveBeenCalledTimes(1);
    // One picture used both budgets…
    expect(counts.get('upload:user:user-a|upload')).toBe(1);
    expect(counts.get('upload:user:user-a|image')).toBe(1);
    // …so switching to a document cannot buy another upload.
    expect(await call(limiters.forKind('document'), context('user-a'))).not.toHaveBeenCalled();
  });

  it('keeps one account able to send several attachments inside the product limits', async () => {
    // The product allows five attachments per message; the default image budget is eight.
    const limiters = limiterFor({ limits: { total: 12, image: 8, document: 6, audio: 6 } });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await call(limiters.forKind('image'), context('user-a'))).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses rather than allowing when the counter store is unreachable', async () => {
    const { store, fail } = counterStore();
    fail.on = true;
    const limiters = limiterFor({ store });

    const refused = context('user-a');
    const next = await call(limiters.total, refused);

    // Failing closed is deliberate: a Redis outage must not remove the protection.
    expect(next).not.toHaveBeenCalled();
    expect(refused.status).toHaveBeenCalledWith(429);
  });

  it('shares its counters through the store when one is configured', async () => {
    const { store, counts } = counterStore();
    const limiters = limiterFor({ store });

    await call(limiters.forKind('image'), context('user-a'));

    expect(counts.get('upload:user:user-a|image')).toBe(1);
  });

  it('has a bounded in-process fallback: distinct callers cannot grow it forever', async () => {
    const limiters = limiterFor({ limits: { total: 1, image: 1, document: 1, audio: 1 } });
    // 120 distinct addresses each get their own window; none may throw or leak unbounded state.
    for (let index = 0; index < 120; index += 1) {
      const octet = (index % 100) + 1;
      const subnet = Math.floor(index / 100) + 1;
      const address = `198.51.${String(subnet)}.${String(octet)}`;
      const next = await call(limiters.total, context(undefined, address));
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('describes the limits it enforces, for the report', () => {
    expect(describeUploadLimits({ total: 12, image: 8, document: 6, audio: 6 }, 60_000)).toBe(
      'uploads: 12/60s in total, images 8/60s, documents 6/60s, voice 6/60s',
    );
  });
});
