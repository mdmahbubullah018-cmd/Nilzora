import type { RequestHandler } from 'express';
import {
  ipKeyGenerator,
  MemoryStore,
  rateLimit,
  type IncrementResponse,
  type Options,
  type Store,
} from 'express-rate-limit';
import type { KeyValueStore } from '../cache';
import { sendError } from '../http/send-error';

export interface RateLimitOptions {
  windowMs: number;
  /** Requests allowed per client IP within the window. */
  limit: number;
  /**
   * Shared counters (Redis). Absent, counters live in this process. Every limiter given a store
   * also needs its own `name`, so two limiters never add to the same counter.
   */
  store?: KeyValueStore | undefined;
  /** Key namespace of this limiter in the shared store, for example "auth". */
  name?: string | undefined;
}

/**
 * Counters shared between API instances, kept in Redis with `INCR` + `EXPIRE` (a fixed window
 * that starts with the first request). A Redis outage must not take the API down and must not
 * switch limiting off, so a failed command is answered from this process's own counters until
 * Redis is back: for that short time each instance limits on its own, exactly as it would with
 * no Redis configured.
 */
export class SharedCounterStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private readonly fallback = new MemoryStore();

  constructor(
    private readonly counters: KeyValueStore,
    name: string,
  ) {
    this.prefix = `nilzora:v1:ratelimit:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    const ttlSeconds = Math.max(1, Math.ceil(this.windowMs / 1000));
    try {
      const totalHits = await this.counters.increment(this.prefix + key, ttlSeconds);
      // INCR does not report the remaining TTL; the window's length is a safe upper bound.
      return { totalHits, resetTime: new Date(Date.now() + ttlSeconds * 1000) };
    } catch {
      return this.fallback.increment(key);
    }
  }

  /** Only used with skip(Successful|Failed)Requests, which Nilzora's limiters do not set. */
  async decrement(key: string): Promise<void> {
    await this.fallback.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    await this.fallback.resetKey(key);
    await this.counters.del([this.prefix + key]).catch(() => 0);
  }

  shutdown(): void {
    this.fallback.shutdown();
  }
}

/**
 * Per-IP request limiter. Clients are keyed by the address the clientAddress
 * middleware chose: `req.ip` (which honours X-Forwarded-For only for the configured
 * TRUST_PROXY_HOPS), or the browser address named by a trusted Nilzora web server.
 * Neither can be chosen by an ordinary caller to dodge the limit.
 *
 * With a shared `store` (REDIS_URL configured) the counters are shared by every API instance,
 * which is what running more than one instance requires. Without one they live in process
 * memory: correct for a single instance, reset on restart.
 */
export function createRateLimiter({
  windowMs,
  limit,
  store,
  name,
}: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(store ? { store: new SharedCounterStore(store, name ?? 'default') } : {}),
    // IPv6 addresses are grouped by /56 subnet, as the library's default key does.
    keyGenerator: (req, res) => ipKeyGenerator(res.locals.clientIp ?? req.ip ?? 'unknown'),
    handler: (_req, res) => {
      // Draft-8 names the window and the quota; Retry-After tells a client how long to wait,
      // which is what a camera-driven surface needs to show a countdown instead of a dead end.
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(windowMs / 1000))));
      sendError(res, 429, 'rate_limited', 'Too many requests. Please wait and try again.');
    },
  });
}
