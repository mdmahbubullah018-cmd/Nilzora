import type {
  CourierConfigResponse,
  CourierCompareResponse,
  CourierProvider,
  OrderCourierContext,
  Shipment,
  ShipmentEvent,
} from '@nilzora/contracts';

/* Test data for the courier screens (never real customers or couriers' answers). */

export const AT = '2026-11-14T10:00:00.000Z';
export const LATER = '2026-11-14T10:30:00.000Z';
export const SHIPMENT_ID = '5b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f01';
export const QUOTE_STEADFAST = '6b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f02';
export const QUOTE_PATHAO = '6b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f03';

export function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    orderNumber: 'NZ100001',
    kind: 'forward',
    returnRequestId: null,
    parentShipmentId: null,
    provider: 'pathao',
    providerName: 'Pathao',
    status: 'in_transit',
    isMock: false,
    merchantRef: 'NZ100001-F1',
    consignmentId: 'PA-123',
    trackingCode: 'PA-123',
    trackingUrl: null,
    weightGrams: 500,
    codAmountMinor: 125_000,
    deliveryZone: 'inside_dhaka',
    destination: { district: 'Dhaka', area: 'Mirpur' },
    note: null,
    quoteId: null,
    recommendedProvider: 'pathao',
    selectionReason: null,
    expectedChargeMinor: 6_000,
    expectedCodFeeMinor: 1_250,
    providerStatus: null,
    bookingUncertain: false,
    bookingError: null,
    providerCallStartedAt: AT,
    bookedAt: AT,
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    lastEventAt: AT,
    nextSyncAt: null,
    syncError: null,
    codState: 'open',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function event(overrides: Partial<ShipmentEvent> = {}): ShipmentEvent {
  return {
    id: 1,
    status: 'booked',
    providerStatus: null,
    source: 'booking',
    occurredAt: AT,
    recordedAt: AT,
    applied: true,
    note: null,
    ...overrides,
  };
}

export function courierContext(overrides: Partial<OrderCourierContext> = {}): OrderCourierContext {
  return {
    order: {
      orderNumber: 'NZ100001',
      status: 'confirmed',
      paymentStatus: 'pending',
      totalMinor: 125_000,
      codDueMinor: 125_000,
      shippingFeeMinor: 8_000,
      deliveryZone: 'inside_dhaka',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Mirpur',
      itemCount: 2,
      placedAt: AT,
    },
    bookable: true,
    notBookableReason: null,
    defaultParcelWeightGrams: 500,
    shipments: [],
    quotes: [],
    locationMappings: [],
    ...overrides,
  };
}

export function comparison(
  overrides: Partial<CourierCompareResponse> = {},
): CourierCompareResponse {
  return {
    weightGrams: 500,
    isMock: false,
    quotes: [
      {
        id: QUOTE_STEADFAST,
        provider: 'steadfast',
        kind: 'internal_estimate',
        available: true,
        unavailableReason: null,
        deliveryChargeMinor: 7_000,
        codFeeMinor: 1_250,
        returnChargeMinor: 3_500,
        weightGrams: 500,
        zone: 'inside_dhaka',
        codAmountMinor: 125_000,
        details: {},
        isMock: false,
        quotedAt: AT,
        expiresAt: LATER,
      },
      {
        id: QUOTE_PATHAO,
        provider: 'pathao',
        kind: 'live',
        available: true,
        unavailableReason: null,
        deliveryChargeMinor: 6_000,
        codFeeMinor: 1_250,
        returnChargeMinor: 3_000,
        weightGrams: 500,
        zone: 'inside_dhaka',
        codAmountMinor: 125_000,
        details: {},
        isMock: false,
        quotedAt: AT,
        expiresAt: LATER,
      },
    ],
    recommendation: {
      provider: 'pathao',
      reasons: ['Lowest expected charge'],
      candidates: [],
    },
    ...overrides,
  };
}

export function provider(overrides: Partial<CourierProvider> = {}): CourierProvider {
  return {
    provider: 'steadfast',
    displayName: 'Steadfast',
    isEnabled: false,
    settings: { storeId: '42' },
    codFeeBp: 100,
    returnChargeMinor: 5_000,
    lastCheckAt: null,
    lastCheckOk: null,
    lastCheckMode: null,
    lastCheckMessage: null,
    updatedAt: AT,
    credentialsConfigured: true,
    capabilities: {
      quote: 'awaiting_documentation',
      book: 'awaiting_documentation',
      track: 'awaiting_documentation',
      cancel: 'unsupported',
      webhook: 'awaiting_documentation',
      returnPickup: 'unsupported',
      locations: 'unsupported',
    },
    blockedReason: 'Steadfast has not published verified merchant API documentation yet.',
    apiBaseUrl: 'https://portal.example.test/api/v1',
    liveVerifiedAt: null,
    credentialFields: ['apiKey', 'secretKey'],
    credentials: [{ field: 'apiKey', source: 'vault', setAt: AT }],
    readiness: {
      adapterVerified: false,
      credentialsComplete: false,
      baseUrlValid: true,
      liveCheckPassed: false,
      liveVerified: false,
      enabled: false,
      ready: false,
      blockers: [
        'The Steadfast adapter is awaiting verified API documentation.',
        'The secret key is not set.',
      ],
    },
    ...overrides,
  };
}

export const MAPPING_ID = '9c1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f07';

export function courierConfig(
  overrides: Partial<CourierConfigResponse> = {},
): CourierConfigResponse {
  return {
    mode: 'mock',
    bookingEnabled: false,
    trackingSyncEnabled: false,
    operations: {
      mode: 'mock',
      bookingEnabled: false,
      trackingSyncEnabled: false,
      trackingSyncIntervalSeconds: 900,
      httpTimeoutMs: 10_000,
      liveBookingConfirmedAt: null,
    },
    databaseTarget: 'local',
    mockAllowed: true,
    modeNotice: null,
    settings: {
      defaultParcelWeightGrams: 500,
      quoteValidityMinutes: 30,
      preferredProvider: null,
      minHistorySample: 20,
      updatedAt: AT,
    },
    providers: [provider()],
    rateCards: [],
    locationMappings: [
      {
        id: MAPPING_ID,
        provider: 'pathao',
        district: 'Dhaka',
        area: 'Mirpur',
        destination: { cityId: 1, zoneId: 52 },
        label: 'Dhaka › Mirpur',
        updatedAt: AT,
      },
    ],
    ...overrides,
  };
}
