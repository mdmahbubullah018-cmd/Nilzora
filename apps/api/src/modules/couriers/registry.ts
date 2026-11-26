import {
  COURIER_PROVIDER_IDS,
  type CourierCapabilities,
  type CourierMode,
  type CourierProviderId,
} from '@nilzora/contracts';
import { createPathaoProvider, createSteadfastProvider } from './blocked-providers';
import { createMockProvider } from './mock-provider';
import type { CourierProvider } from './types';

/*
 * Which adapter answers for a courier, in the EFFECTIVE mode (read from the database on
 * each request; see ./runtime.ts). In mock mode both couriers are served by the local mock
 * (their shipments are flagged is_mock); in live mode by the real adapters (blocked today);
 * in off mode nothing is called and the real adapters are reported for information only.
 *
 * An existing shipment is routed by its own is_mock flag, never by the current mode alone:
 * a mock shipment is only ever touched by the mock (while the mode is mock), a real one only
 * by its real adapter (while the mode is live).
 */

export interface CourierRegistry {
  /** The adapter for this mode, or undefined for a courier id the API does not know. */
  provider(id: string, mode: CourierMode): CourierProvider | undefined;
  /** The real adapter, whatever the mode (readiness, verification). */
  real(id: string): CourierProvider | undefined;
  /** The adapter that may act on an existing shipment in this mode, or none. */
  forShipment(id: string, isMock: boolean, mode: CourierMode): CourierProvider | undefined;
  capabilities(id: CourierProviderId, mode: CourierMode): CourierCapabilities;
}

export function isCourierProviderId(id: string): id is CourierProviderId {
  return (COURIER_PROVIDER_IDS as readonly string[]).includes(id);
}

export function createCourierRegistry(
  options: { mockWebhookSecret?: string | undefined; now?: () => number } = {},
): CourierRegistry {
  const real: Record<CourierProviderId, CourierProvider> = {
    steadfast: createSteadfastProvider(),
    pathao: createPathaoProvider(),
  };
  const mockOf = (id: CourierProviderId) =>
    createMockProvider({
      id,
      displayName: real[id].displayName,
      webhookSecret: options.mockWebhookSecret,
      ...(options.now ? { now: options.now } : {}),
    });
  const mock: Record<CourierProviderId, CourierProvider> = {
    steadfast: mockOf('steadfast'),
    pathao: mockOf('pathao'),
  };
  const forMode = (mode: CourierMode) => (mode === 'mock' ? mock : real);

  return {
    provider: (id, mode) => (isCourierProviderId(id) ? forMode(mode)[id] : undefined),
    real: (id) => (isCourierProviderId(id) ? real[id] : undefined),
    forShipment(id, isMock, mode) {
      if (!isCourierProviderId(id)) return undefined;
      if (isMock) return mode === 'mock' ? mock[id] : undefined;
      return mode === 'live' ? real[id] : undefined;
    },
    capabilities: (id, mode) => forMode(mode)[id].capabilities(),
  };
}
