import type { ApiClient } from '@nilzora/api-client';
import type { PublicStoreProfile } from '@nilzora/contracts';

/*
 * A fake API client for screen and hook tests. Not imported by the app, so never bundled.
 *
 *   const api = createFakeApiClient();
 *   api.listProducts.mockResolvedValue({ items: [], page: 1, pageSize: 24, total: 0, totalPages: 0 });
 *
 * Every method is a jest.fn created on first use. A method the test did not stub rejects
 * with an Error naming it, so a missing stub fails loudly instead of hanging a screen.
 */

export type FakeApiClient = {
  [Method in keyof ApiClient]: jest.Mock<
    ReturnType<ApiClient[Method]>,
    Parameters<ApiClient[Method]>
  >;
};

export function createFakeApiClient(): FakeApiClient {
  const methods = new Map<string, jest.Mock>();
  return new Proxy({} as FakeApiClient, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      let method = methods.get(name);
      if (method === undefined) {
        method = jest.fn(() => Promise.reject(new Error(`FakeApiClient.${name} has no stub`)));
        methods.set(name, method);
      }
      return method;
    },
  });
}

/**
 * The store's published profile, complete.
 *
 * Every field is present because the profile is what the screens read for contact details and
 * for the payment switch: a fixture that dropped `codAvailable` would silently change what
 * checkout offers.
 */
export function fakeStoreProfile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    addressArea: null,
    addressDistrict: null,
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    codAvailable: true,
    updatedAt: '2026-11-06T09:00:00.000Z',
    ...overrides,
  };
}
