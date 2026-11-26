import type { CourierCapabilities, CourierProviderId } from '@nilzora/contracts';
import type { CourierProvider, ProviderFailure } from './types';

/*
 * The real Steadfast and Pathao adapters: BLOCKED.
 *
 * Neither courier publishes official API documentation that this project has verified.
 * Until a courier's merchant documentation is obtained and checked, every operation here
 * answers "awaiting documentation" and makes NO network call. Nothing below may be
 * "filled in" from guesses: endpoints, payloads, authentication, webhook signatures and
 * status names must come from the merchant documentation, never from community sources
 * or leaked credentials.
 *
 * UNVERIFIED evidence, recorded only so that the future work knows where to start. None
 * of it is implemented, and none of it is trusted:
 *
 *  - Steadfast (source: a public Postman collection by an unverified publisher):
 *    base https://portal.packzy.com/api/v1, headers `api-key` and `secret-key`, an order
 *    creation call named `create_order`, a status lookup `status_by_cid`. Steadfast's own
 *    terms say a consignment is cancelled through the merchant portal, so `cancel` is
 *    reported as unsupported (staff cancel in the portal and confirm here).
 *  - Pathao (source: the vendor's WooCommerce plugin published as `pathao-eng`):
 *    hosts api-hermes.pathao.com (production) and courier-api-sandbox.pathao.com (sandbox),
 *    an OAuth-style login (client id/secret plus merchant username/password) and webhooks
 *    carrying an `X-Pathao-Signature` header compared against a shared secret.
 *
 * The base-URL allow-list in ./config.ts uses those hosts so that a misconfigured URL is
 * refused at start-up; it does not make any of the above verified.
 */

const AWAITING = 'awaiting_documentation' as const;

function blockedProvider(
  id: CourierProviderId,
  displayName: string,
  capabilities: CourierCapabilities,
  blockedReason: string,
): CourierProvider {
  const awaiting = (): Promise<ProviderFailure> =>
    Promise.resolve({ kind: 'awaiting_documentation', message: blockedReason });
  return {
    id,
    displayName,
    isMock: false,
    // Set to true only in a real adapter implemented against verified merchant documentation.
    verified: false,
    blockedReason,
    capabilities: () => ({ ...capabilities }),
    quote: awaiting,
    book: awaiting,
    track: awaiting,
    cancel: () =>
      capabilities.cancel === 'unsupported'
        ? Promise.resolve({
            kind: 'unsupported',
            message: `${displayName} cancels consignments in its merchant portal only`,
          })
        : awaiting(),
    checkConnection: awaiting,
    verifyWebhook: () => ({ ok: false, reason: 'not_configured' }),
    parseWebhook: () => null,
    mapStatus: () => 'unknown',
  };
}

export function createSteadfastProvider(): CourierProvider {
  return blockedProvider(
    'steadfast',
    'Steadfast Courier',
    {
      quote: AWAITING,
      book: AWAITING,
      track: AWAITING,
      cancel: 'unsupported',
      webhook: AWAITING,
      returnPickup: AWAITING,
      locations: AWAITING,
    },
    'Real Steadfast calls are disabled until the merchant API documentation is verified.',
  );
}

export function createPathaoProvider(): CourierProvider {
  return blockedProvider(
    'pathao',
    'Pathao Courier',
    {
      quote: AWAITING,
      book: AWAITING,
      track: AWAITING,
      cancel: AWAITING,
      webhook: AWAITING,
      returnPickup: AWAITING,
      locations: AWAITING,
    },
    'Real Pathao calls are disabled until the merchant API documentation is verified.',
  );
}
