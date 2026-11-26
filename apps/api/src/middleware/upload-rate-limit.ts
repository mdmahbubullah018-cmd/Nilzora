import { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import { sendError } from '../http/send-error';
import type { KeyValueStore } from '../cache';

/*
 * Upload rate limits
 * ------------------
 * The shared chat limiter protects writes in general; this one exists because an upload is the
 * expensive operation on the whole chat surface: it moves megabytes, runs sharp, and writes two
 * objects to Cloudflare R2. One budget for "anything a person may do in a minute" would either
 * throttle ordinary conversation or leave uploads almost unguarded, so uploads get their own
 * counters, per kind and per account.
 *
 * What a counter is keyed by
 *   user:<id>|<scope>   an authenticated account — the identity that costs money
 *   ip:<addr>|<scope>   a caller with no verified account, keyed by the same client address the
 *                       other limiters use (honouring TRUST_PROXY_HOPS only)
 *
 * The scope is the upload kind ("image", "document", "audio"), so a person who has used their
 * picture budget can still send a document, while switching entry points cannot escape the
 * total: every kind shares the `upload` counter as well. Counters live in Redis when it is
 * configured (atomic INCR, shared between instances); without Redis the counters live in this
 * process, which is correct for a single instance and resets on restart — the same trade-off
 * the existing per-IP limiter documents, and the reason its ceilings are deliberately generous.
 */

export const UPLOAD_SCOPES = ['upload', 'image', 'document', 'audio'] as const;
export type UploadScope = (typeof UPLOAD_SCOPES)[number];

export interface UploadLimitRule {
  /** The budget for every upload together, of any kind. */
  total: number;
  image: number;
  document: number;
  audio: number;
}

export interface UploadRateLimitOptions {
  windowMs: number;
  limits: UploadLimitRule;
  /** Counters; omitted means this process's memory. */
  store?: KeyValueStore | undefined;
  /** Where the caller's address comes from, as the other limiters read it. */
  clientIp?: ((req: Request, res: Response) => string) | undefined;
}

/** One ladder of budgets, counted on the server and never taken from the request. */
interface Window {
  count: number;
  resetAt: number;
}

const DEFAULT_IP = (req: Request, res: Response): string =>
  ipKeyGenerator(res.locals.clientIp ?? req.ip ?? 'unknown');

/**
 * Counters for this process. Bounded on purpose: an entry is dropped as soon as its window has
 * passed, and the map is swept whenever it grows past `maxKeys`, so a flood of distinct
 * addresses cannot grow it without limit.
 */
class MemoryCounterStore {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly maxKeys = 10_000) {}

  increment(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.sweep(now);
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest, which are the closest to expiring anyway.
    if (this.windows.size >= this.maxKeys) {
      const oldest = [...this.windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (const [key] of oldest.slice(0, Math.ceil(this.maxKeys / 4))) this.windows.delete(key);
    }
  }
}

export interface UploadLimiters {
  /** Every upload, of any kind, for one account or address. */
  total: RequestHandler;
  /** The limiter for one kind. */
  forKind: (kind: 'image' | 'document' | 'audio') => RequestHandler;
}

export function createUploadLimiters(options: UploadRateLimitOptions): UploadLimiters {
  const { windowMs, limits, store } = options;
  const addressOf = options.clientIp ?? DEFAULT_IP;
  const memory = new MemoryCounterStore();
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  /**
   * Adds one to a counter and answers the decision. A Redis outage must not open the door, so a
   * failure is treated as a refusal with the window's length as the wait — the same conservative
   * choice the catalogue cache makes by falling back to the database rather than to nothing.
   */
  async function take(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (store !== undefined) {
      try {
        const count = await store.increment(key, windowSeconds);
        return { allowed: count <= limitFor(key), retryAfterSeconds: windowSeconds };
      } catch {
        return { allowed: false, retryAfterSeconds: windowSeconds };
      }
    }
    const window = memory.increment(key, windowMs);
    return {
      allowed: window.count <= limitFor(key),
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000)),
    };
  }

  function limitFor(key: string): number {
    if (key.includes('|image')) return limits.image;
    if (key.includes('|document')) return limits.document;
    if (key.includes('|audio')) return limits.audio;
    return limits.total;
  }

  function keyFor(scope: UploadScope, req: Request, res: Response): string {
    const identity = res.locals.identity as { userId?: string } | undefined;
    const userId = typeof identity?.userId === 'string' ? identity.userId : undefined;
    // An account is the identity that matters; an unauthenticated caller is limited by address.
    return userId === undefined
      ? `upload:ip:${addressOf(req, res)}|${scope}`
      : `upload:user:${userId}|${scope}`;
  }

  function limiter(scope: UploadScope): RequestHandler {
    return (req, res, next) => {
      void decide(scope, req, res, next).catch(next);
    };
  }

  /** Charges one counter and answers whether the request may continue. */
  async function charge(
    scope: UploadScope,
    req: Request,
    res: Response,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return take(keyFor(scope, req, res));
  }

  async function decide(scope: UploadScope, req: Request, res: Response, next: () => void) {
    const decision = await charge(scope, req, res);
    if (!decision.allowed) {
      refuse(res, decision.retryAfterSeconds, scope);
      return;
    }
    next();
  }

  function refuse(res: Response, retryAfterSeconds: number, scope: UploadScope): void {
    // A caller that retries too early is told exactly how long to wait, and the header is the
    // standard one so an ordinary client can back off without parsing the body.
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(res, 429, 'rate_limited', 'Too many uploads. Wait a moment and try again.', {
      retryAfterSeconds,
      scope,
    });
  }

  /**
   * One kind of upload charges two counters, in one pass: its own and the total. Charging both is
   * what makes the entry points interchangeable — a person cannot send more pictures by
   * alternating between "image" and "camera" requests — while each kind keeps its own allowance.
   */
  function kindLimiter(kind: 'image' | 'document' | 'audio'): RequestHandler {
    return (req, res, next) => {
      void (async () => {
        const total = await charge('upload', req, res);
        if (!total.allowed) {
          refuse(res, total.retryAfterSeconds, 'upload');
          return;
        }
        const kindDecision = await charge(kind, req, res);
        if (!kindDecision.allowed) {
          refuse(res, kindDecision.retryAfterSeconds, kind);
          return;
        }
        next();
      })().catch(next);
    };
  }

  const totalLimiter = limiter('upload');

  return {
    total: totalLimiter,
    forKind: kindLimiter,
  };
}

/** The limits a deployment runs with, for the report and the tests. */
export function describeUploadLimits(limits: UploadLimitRule, windowMs: number): string {
  const per = Math.round(windowMs / 1000);
  return `uploads: ${limits.total}/${per}s in total, images ${limits.image}/${per}s, documents ${limits.document}/${per}s, voice ${limits.audio}/${per}s`;
}
