import { createApiClient, type ApiClient } from '@nilzora/api-client';
import { TRUSTED_CLIENT_IP_HEADER, TRUSTED_CLIENT_SECRET_HEADER } from '@nilzora/contracts';
import { clientIpFrom } from './client-ip';
import type { WebSessionConfig } from './config';

/**
 * An API client for one incoming request. Only this server talks to the API: browser
 * headers (including any Authorization header) are never forwarded. When the shared
 * client secret is configured, the browser's address goes along for rate limiting.
 */
export function apiClientFor(
  config: Pick<WebSessionConfig, 'apiUrl' | 'apiClientSecret' | 'trustProxyHops'>,
  requestHeaders: Pick<Headers, 'get'>,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): ApiClient {
  const clientIp = clientIpFrom(requestHeaders, config.trustProxyHops);
  const secret = config.apiClientSecret;
  if (secret === undefined || clientIp === undefined) {
    return createApiClient({ baseUrl: config.apiUrl, fetch: fetchImpl });
  }
  return createApiClient({
    baseUrl: config.apiUrl,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set(TRUSTED_CLIENT_SECRET_HEADER, secret);
      headers.set(TRUSTED_CLIENT_IP_HEADER, clientIp);
      return fetchImpl(input, { ...init, headers });
    },
  });
}
