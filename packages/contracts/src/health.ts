import { z } from 'zod';

/**
 * Where the API's database lives. Deliberately classification-only: the health endpoint is
 * unauthenticated, so it must never carry a host, user, password or key.
 */
export const databaseTargetSchema = z.object({
  target: z.enum(['local', 'hosted', 'other']),
  connection: z.enum(['local', 'pooler', 'direct', 'other']),
  /** Public Supabase project ref, or null for a local stack. */
  projectRef: z.string().nullable(),
});

export type DatabaseTargetInfo = z.infer<typeof databaseTargetSchema>;

/** Response of GET /api/v1/health (process liveness). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('nilzora-api'),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
  database: databaseTargetSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * One dependency's state in GET /api/v1/health/ready. `skipped` means the process is not
 * configured to use it (for example no REDIS_URL), which is not a failure.
 */
export const readinessCheckSchema = z.object({
  status: z.enum(['ok', 'failed', 'skipped']),
  latencyMs: z.number().int().nonnegative().nullable(),
});

/**
 * Response of GET /api/v1/health/ready (traffic readiness). HTTP 200 with `ready` when the
 * database answers; HTTP 503 with `not_ready` otherwise. Redis is optional: a failed Redis makes
 * the process `degraded` (cache misses, per-instance rate limits) but still able to serve.
 * Classification only, like /health: no host, error text or configuration is ever included.
 */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  service: z.literal('nilzora-api'),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: readinessCheckSchema,
    redis: readinessCheckSchema,
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
