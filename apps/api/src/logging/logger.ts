import { hostname } from 'node:os';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env';

export const REDACTED = '[REDACTED]';

/** Field names whose values must never reach the logs, at any of the first three levels. */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'secret',
  'clientSecret',
  'apiKey',
  'privateKey',
  'secretKey',
  'serviceRoleKey',
] as const;

export const redactPaths: readonly string[] = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers["x-api-key"]',
  'req.headers["x-nilzora-client-secret"]',
  'res.headers["set-cookie"]',
  '*.headers["set-cookie"]',
];

/**
 * Structured JSON logs with secret redaction. Local development gets
 * human-readable output via pino-pretty; tests can pass a destination stream.
 */
export function createLogger(
  config: Pick<AppConfig, 'nodeEnv' | 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: { service: 'nilzora-api', pid: process.pid, hostname: hostname() },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...redactPaths], censor: REDACTED },
  };

  if (destination) return pino(options, destination);
  if (config.nodeEnv === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    });
  }
  return pino(options);
}
