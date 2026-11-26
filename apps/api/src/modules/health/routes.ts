import type { HealthResponse, ReadinessResponse } from '@nilzora/contracts';
import { Router } from 'express';
import type { DatabaseTarget } from '../../config/target';

/** A dependency probe: resolves true when it answered, false (or throws) when it did not. */
export type ReadinessProbe = () => Promise<boolean>;

export interface ReadinessProbes {
  /** Absent when the process has no direct database connection (the check is then skipped). */
  database?: ReadinessProbe | undefined;
  /** Absent when Redis is not configured. */
  redis?: ReadinessProbe | undefined;
}

/** A probe that has not answered by then counts as failed, so the check never hangs. */
export const READINESS_TIMEOUT_MS = 2_000;

type Check = ReadinessResponse['checks']['database'];

async function run(probe: ReadinessProbe | undefined, timeoutMs: number): Promise<Check> {
  if (!probe) return { status: 'skipped', latencyMs: null };
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const answered = await Promise.race([
      probe(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    const latencyMs = Math.round(performance.now() - started);
    return { status: answered ? 'ok' : 'failed', latencyMs };
  } catch {
    // The failure's text can name a host; it is never part of the public answer.
    return { status: 'failed', latencyMs: Math.round(performance.now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GET /health — process liveness for load balancers and uptime checks. It also reports which
 * database the process is connected to, as a classification only (no host, user or password),
 * so a process pointed at the wrong stack is visible without reading its environment.
 *
 * GET /health/ready — whether this instance should receive traffic: the database must answer.
 * A load balancer or deployment check uses it to hold traffic back from an instance that cannot
 * reach PostgreSQL, and to wait for a new instance before the old one stops. Redis only degrades.
 */
export function healthRouter(
  target: DatabaseTarget,
  probes: ReadinessProbes = {},
  timeoutMs = READINESS_TIMEOUT_MS,
): Router {
  const router = Router();
  const database = {
    target: target.mode,
    connection: target.connection,
    projectRef: target.projectRef,
  };
  router.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'nilzora-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    };
    res.json(body);
  });
  router.get('/health/ready', (_req, res, next) => {
    void (async () => {
      const [db, redis] = await Promise.all([
        run(probes.database, timeoutMs),
        run(probes.redis, timeoutMs),
      ]);
      const status: ReadinessResponse['status'] =
        db.status === 'failed' ? 'not_ready' : redis.status === 'failed' ? 'degraded' : 'ready';
      const body: ReadinessResponse = {
        status,
        service: 'nilzora-api',
        timestamp: new Date().toISOString(),
        checks: { database: db, redis },
      };
      res.setHeader('Cache-Control', 'no-store');
      res.status(status === 'not_ready' ? 503 : 200).json(body);
    })().catch(next);
  });
  return router;
}
