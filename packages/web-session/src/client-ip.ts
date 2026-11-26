import { isIP } from 'node:net';

/**
 * The browser's address as seen by this server, for the API's per-client limits.
 *
 * Next.js records the connection address in X-Forwarded-For only when the header is
 * absent, and a reverse proxy appends the address it saw. With `trustProxyHops` proxies
 * in front, the client is that many entries from the right (at least the last one).
 *
 * Limitation: if this server is exposed directly, a client can send its own header and
 * choose its address. Production deployments must run behind a reverse proxy that sets
 * X-Forwarded-For.
 */
export function clientIpFrom(
  headers: Pick<Headers, 'get'>,
  trustProxyHops: number,
): string | undefined {
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - Math.max(trustProxyHops, 1)];
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : undefined;
}
