import { ApiError, type ApiClient } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { throwRedirect } from '@/test/redirect';
import { comparison, courierConfig, shipment, SHIPMENT_ID } from '@/components/shipments/fixtures';
import type { BookingState, CompareState } from '@/components/shipments/courier-state';
import {
  bookShipmentAction,
  cancelShipmentAction,
  compareCouriersAction,
  recordSettlementAction,
  saveCourierProviderAction,
  recordPortalBookingAction,
  saveCourierBaseUrlAction,
  saveCourierOperationsAction,
  saveLocationMappingAction,
  setCourierCredentialAction,
  setLiveVerificationAction,
} from './courier-actions';

/*
 * The courier actions shape requests and check what they can before any API call; the API
 * and database decide again. Refusals come back as fixed messages, never API text.
 */

const api = vi.hoisted(() => ({
  adminCompareCouriers: vi.fn(),
  adminBookShipment: vi.fn(),
  adminCancelShipment: vi.fn(),
  adminRecordCourierSettlement: vi.fn(),
  adminSaveCourierProvider: vi.fn(),
  adminRecordPortalBooking: vi.fn(),
  adminSaveCourierOperations: vi.fn(),
  adminSetCourierCredential: vi.fn(),
  adminSaveCourierBaseUrl: vi.fn(),
  adminSetCourierLiveVerification: vi.fn(),
  adminSaveCourierLocationMapping: vi.fn(),
}));
const act = vi.hoisted((): { outcome: 'ok' | 'untrusted' } => ({ outcome: 'ok' }));

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const KEY = '7b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f09';
const API_TEXT = 'API text that must not reach the browser';
const IDLE = { status: 'idle' } as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  act.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
});

describe('compareCouriersAction', () => {
  it('sends the weight in grams and hands back a fresh booking key', async () => {
    api.adminCompareCouriers.mockResolvedValue(comparison());
    const state: CompareState = await compareCouriersAction(
      IDLE,
      form({ orderNumber: 'NZ100001', weight: '1.25' }),
    );
    expect(api.adminCompareCouriers).toHaveBeenCalledWith('access-token', 'NZ100001', {
      weightGrams: 1250,
    });
    expect(state.status).toBe('success');
    expect(state.bookingKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses an impossible weight without calling the API', async () => {
    const state = await compareCouriersAction(
      IDLE,
      form({ orderNumber: 'NZ100001', weight: '60' }),
    );
    expect(state.fieldErrors?.weight).toMatch(/kilograms/);
    expect(api.adminCompareCouriers).not.toHaveBeenCalled();
  });

  it('explains calmly when couriers are switched off on the server', async () => {
    api.adminCompareCouriers.mockRejectedValue(new ApiError(503, 'courier_unavailable', API_TEXT));
    const state = await compareCouriersAction(
      IDLE,
      form({ orderNumber: 'NZ100001', weight: '0.5' }),
    );
    expect(state.message).toMatch(/switched off on this server/);
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('bookShipmentAction', () => {
  const booking = (fields: Record<string, string> = {}) =>
    form({
      orderNumber: 'NZ100001',
      bookingKey: KEY,
      provider: 'pathao',
      recommendedProvider: 'pathao',
      weightGrams: '500',
      ...fields,
    });

  it('requires a reason when the chosen courier is not the recommended one', async () => {
    const state: BookingState = await bookShipmentAction(IDLE, booking({ provider: 'steadfast' }));
    expect(state.fieldErrors?.selectionReason).toMatch(/Say why you chose Steadfast/);
    expect(state.bookingKey).toBe(KEY);
    expect(api.adminBookShipment).not.toHaveBeenCalled();
  });

  it('sends the same key, the override reason and the recommendation', async () => {
    api.adminBookShipment.mockResolvedValue({
      shipment: shipment({ provider: 'steadfast', providerName: 'Steadfast' }),
      outcome: 'booked',
      duplicate: false,
    });
    const state = await bookShipmentAction(
      IDLE,
      booking({ provider: 'steadfast', selectionReason: 'Customer asked for Steadfast' }),
    );
    expect(api.adminBookShipment).toHaveBeenCalledWith('access-token', 'NZ100001', {
      bookingKey: KEY,
      provider: 'steadfast',
      weightGrams: 500,
      recommendedProvider: 'pathao',
      selectionReason: 'Customer asked for Steadfast',
    });
    expect(state).toMatchObject({ outcome: 'booked', status: 'success', bookingKey: KEY });
    expect(state.message).toMatch(/Booked with Steadfast/);
  });

  it.each([
    ['failed', /refused the booking/],
    ['uncertain', /Check the courier portal/],
    ['in_progress', /already being sent/],
  ] as const)('reports a %s booking in words', async (outcome, words) => {
    api.adminBookShipment.mockResolvedValue({
      shipment: shipment({ status: 'booking_pending', bookingUncertain: outcome === 'uncertain' }),
      outcome,
      duplicate: false,
    });
    const state = await bookShipmentAction(IDLE, booking());
    expect(state.outcome).toBe(outcome);
    expect(state.message).toMatch(words);
  });

  it('keeps the key on an unanswered call so a retry is safe', async () => {
    api.adminBookShipment.mockRejectedValue(new ApiError(0, 'network_error', API_TEXT));
    const state = await bookShipmentAction(IDLE, booking());
    expect(state.bookingKey).toBe(KEY);
    expect(state.outcome).toBeUndefined();
    expect(state.message).toMatch(/could not be confirmed/);
  });

  it('sends nothing from an untrusted form', async () => {
    act.outcome = 'untrusted';
    const state = await bookShipmentAction(IDLE, booking());
    expect(state.message).toMatch(/expired/);
    expect(api.adminBookShipment).not.toHaveBeenCalled();
  });
});

describe('cancelShipmentAction', () => {
  it('needs the portal confirmation when the courier has no cancel API', async () => {
    const state = await cancelShipmentAction(
      IDLE,
      form({ shipmentId: SHIPMENT_ID, reason: 'Customer cancelled', needsPortal: '1' }),
    );
    expect(state.fieldErrors?.cancelledInPortal).toMatch(/portal/);
    expect(api.adminCancelShipment).not.toHaveBeenCalled();
  });

  it('sends the reason and the confirmation', async () => {
    api.adminCancelShipment.mockResolvedValue(shipment({ status: 'cancelled' }));
    const state = await cancelShipmentAction(
      IDLE,
      form({
        shipmentId: SHIPMENT_ID,
        reason: 'Customer cancelled',
        needsPortal: '1',
        cancelledInPortal: 'on',
      }),
    );
    expect(api.adminCancelShipment).toHaveBeenCalledWith('access-token', SHIPMENT_ID, {
      reason: 'Customer cancelled',
      cancelledInPortal: true,
    });
    expect(state.message).toMatch(/order itself is unchanged/);
  });
});

describe('recordSettlementAction', () => {
  const lines = (settled: string) =>
    JSON.stringify([
      {
        shipmentId: SHIPMENT_ID,
        settled,
        deliveryCharge: '60',
        codFee: '',
        returnCharge: '',
        other: '',
      },
    ]);

  it('refuses lines that do not add up to the payout', async () => {
    const state = await recordSettlementAction(
      IDLE,
      form({
        provider: 'pathao',
        reference: 'PAY-1',
        amount: '1000',
        receivedOn: '2026-11-14',
        lines: lines('900'),
      }),
    );
    expect(state.fieldErrors?.lines).toMatch(/add up/);
    expect(api.adminRecordCourierSettlement).not.toHaveBeenCalled();
  });

  it('sends poisha lines that add up', async () => {
    api.adminRecordCourierSettlement.mockResolvedValue({
      id: SHIPMENT_ID,
      provider: 'pathao',
      reference: 'PAY-1',
      amountMinor: 100_000,
      receivedOn: '2026-11-14',
      note: null,
      isMock: false,
      createdAt: '2026-11-14T10:00:00.000Z',
      lines: 1,
    });
    const state = await recordSettlementAction(
      IDLE,
      form({
        provider: 'pathao',
        reference: 'PAY-1',
        amount: '1000',
        receivedOn: '2026-11-14',
        lines: lines('1000'),
      }),
    );
    expect(api.adminRecordCourierSettlement).toHaveBeenCalledWith('access-token', {
      provider: 'pathao',
      reference: 'PAY-1',
      amountMinor: 100_000,
      receivedOn: '2026-11-14',
      isMock: false,
      lines: [{ shipmentId: SHIPMENT_ID, settledMinor: 100_000, deliveryChargeMinor: 6_000 }],
    });
    expect(state.status).toBe('success');
  });
});

describe('saveCourierProviderAction', () => {
  it('refuses a credential-like setting name before any call', async () => {
    const data = form({ provider: 'pathao', isEnabled: 'on', codFee: '1', returnCharge: '' });
    data.append('settingKey', 'apiKey');
    data.append('settingValue', 'abc');
    const state = await saveCourierProviderAction(IDLE, data);
    expect(state.fieldErrors?.settings).toMatch(/set on the server, never here/);
    expect(api.adminSaveCourierProvider).not.toHaveBeenCalled();
  });

  it('sends non-secret settings and the fee in basis points', async () => {
    api.adminSaveCourierProvider.mockResolvedValue({});
    const data = form({ provider: 'pathao', isEnabled: 'on', codFee: '0.5', returnCharge: '50' });
    data.append('settingKey', 'storeId');
    data.append('settingValue', '42');
    await saveCourierProviderAction(IDLE, data);
    expect(api.adminSaveCourierProvider).toHaveBeenCalledWith('access-token', 'pathao', {
      isEnabled: true,
      settings: { storeId: '42' },
      codFeeBp: 50,
      returnChargeMinor: 5_000,
    });
  });
});

describe('recordPortalBookingAction', () => {
  const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
  const portal = (fields: Record<string, string> = {}) =>
    form({
      orderNumber: 'NZ100001',
      bookingKey: KEY,
      provider: 'pathao',
      weight: '0.5',
      consignmentId: 'PA-998',
      note: 'Booked in the Pathao portal',
      ...fields,
    });

  it('checks the consignment, note, weight and charge before any call', async () => {
    const state = await recordPortalBookingAction(
      IDLE,
      portal({ consignmentId: '', note: 'x', weight: '99', charge: 'sixty' }),
    );
    expect(state.fieldErrors?.consignmentId).toMatch(/consignment id/);
    expect(state.fieldErrors?.note).toMatch(/where and how/);
    expect(state.fieldErrors?.weight).toMatch(/kilograms/);
    expect(state.fieldErrors?.charge).toMatch(/taka/);
    expect(state.bookingKey).toBe(KEY);
    expect(api.adminRecordPortalBooking).not.toHaveBeenCalled();
  });

  it('requires a reason when overriding the recommended courier', async () => {
    const state = await recordPortalBookingAction(
      IDLE,
      portal({ provider: 'steadfast', recommendedProvider: 'pathao' }),
    );
    expect(state.fieldErrors?.selectionReason).toMatch(/Say why you chose Steadfast/);
    expect(api.adminRecordPortalBooking).not.toHaveBeenCalled();
  });

  it('records a return pickup with the charge in poisha and the same key', async () => {
    api.adminRecordPortalBooking.mockResolvedValue(
      shipment({ kind: 'return_pickup', consignmentId: 'PA-998', codAmountMinor: 0 }),
    );
    const state = await recordPortalBookingAction(
      IDLE,
      portal({ returnId: RETURN_ID, charge: '60.50', trackingCode: 'T-1' }),
    );
    expect(api.adminRecordPortalBooking).toHaveBeenCalledWith('access-token', 'NZ100001', {
      bookingKey: KEY,
      provider: 'pathao',
      returnId: RETURN_ID,
      weightGrams: 500,
      consignmentId: 'PA-998',
      trackingCode: 'T-1',
      chargeMinor: 6_050,
      note: 'Booked in the Pathao portal',
    });
    expect(state).toMatchObject({ status: 'success', outcome: 'booked', bookingKey: KEY });
    expect(state.message).toMatch(/Nothing was sent to the courier/);
  });

  it('keeps the key and a fixed message when the API refuses', async () => {
    api.adminRecordPortalBooking.mockRejectedValue(
      new ApiError(409, 'shipment_already_active', API_TEXT),
    );
    const state = await recordPortalBookingAction(IDLE, portal());
    expect(state.bookingKey).toBe(KEY);
    expect(state.message).toMatch(/already an active shipment/);
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('saveCourierOperationsAction', () => {
  const operations = (fields: Record<string, string> = {}) =>
    form({ mode: 'live', trackingSyncMinutes: '15', timeoutSeconds: '10', ...fields });

  it('sends seconds and milliseconds, and the confirmation only when typed', async () => {
    api.adminSaveCourierOperations.mockResolvedValue(courierConfig({ mode: 'live' }));
    await saveCourierOperationsAction(
      IDLE,
      operations({ bookingEnabled: 'on', confirmation: 'ENABLE LIVE COURIERS' }),
    );
    expect(api.adminSaveCourierOperations).toHaveBeenCalledWith('access-token', {
      mode: 'live',
      bookingEnabled: true,
      trackingSyncEnabled: false,
      trackingSyncIntervalSeconds: 900,
      httpTimeoutMs: 10_000,
      confirmation: 'ENABLE LIVE COURIERS',
    });
  });

  it('refuses a mistyped confirmation and bad numbers before any call', async () => {
    const state = await saveCourierOperationsAction(
      IDLE,
      operations({ confirmation: 'enable live', trackingSyncMinutes: '0', timeoutSeconds: '90' }),
    );
    expect(state.fieldErrors?.confirmation).toMatch(/ENABLE LIVE COURIERS/);
    expect(state.fieldErrors?.trackingSyncMinutes).toMatch(/1 to 1,440/);
    expect(state.fieldErrors?.timeoutSeconds).toMatch(/1 to 60/);
    expect(api.adminSaveCourierOperations).not.toHaveBeenCalled();
  });

  it.each([
    ['courier_confirmation_required', /typed confirmation/],
    ['courier_mock_not_allowed', /local database/],
  ])('maps %s to a fixed message', async (code, words) => {
    api.adminSaveCourierOperations.mockRejectedValue(new ApiError(409, code, API_TEXT));
    const state = await saveCourierOperationsAction(IDLE, operations({ mode: 'mock' }));
    expect(state.message).toMatch(words);
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });

  it('reports a saved mode that is not in effect', async () => {
    api.adminSaveCourierOperations.mockResolvedValue(
      courierConfig({ mode: 'off', modeNotice: 'Test mode is refused here.' }),
    );
    const state = await saveCourierOperationsAction(IDLE, operations({ mode: 'mock' }));
    expect(state.message).toBe('Saved. Test mode is refused here.');
  });
});

describe('setCourierCredentialAction', () => {
  const SECRET = 'sk_live_fixture_secret_9f3a';

  it('sends the value once and never echoes it back', async () => {
    api.adminSetCourierCredential.mockResolvedValue(courierConfig());
    const state = await setCourierCredentialAction(
      IDLE,
      form({ provider: 'steadfast', field: 'secretKey', value: SECRET }),
    );
    expect(api.adminSetCourierCredential).toHaveBeenCalledWith(
      'access-token',
      'steadfast',
      'secretKey',
      SECRET,
    );
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state.message).toMatch(/verified for live use again/);
  });

  it('keeps a refused value out of the answer too', async () => {
    api.adminSetCourierCredential.mockRejectedValue(
      new ApiError(422, 'validation_failed', API_TEXT),
    );
    const state = await setCourierCredentialAction(
      IDLE,
      form({ provider: 'steadfast', field: 'secretKey', value: SECRET }),
    );
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it('refuses an odd field name or an empty value without calling the API', async () => {
    await setCourierCredentialAction(
      IDLE,
      form({ provider: 'steadfast', field: '../x', value: 'a' }),
    );
    const empty = await setCourierCredentialAction(
      IDLE,
      form({ provider: 'steadfast', field: 'apiKey', value: '  ' }),
    );
    expect(empty.fieldErrors?.value).toBeDefined();
    expect(api.adminSetCourierCredential).not.toHaveBeenCalled();
  });
});

describe('saveCourierBaseUrlAction', () => {
  it('accepts https only, and an empty field clears it', async () => {
    const plain = await saveCourierBaseUrlAction(
      IDLE,
      form({ provider: 'pathao', apiBaseUrl: 'http://example.test' }),
    );
    expect(plain.fieldErrors?.apiBaseUrl).toMatch(/https/);
    api.adminSaveCourierBaseUrl.mockResolvedValue(courierConfig());
    await saveCourierBaseUrlAction(IDLE, form({ provider: 'pathao', apiBaseUrl: '' }));
    expect(api.adminSaveCourierBaseUrl).toHaveBeenCalledWith('access-token', 'pathao', {
      apiBaseUrl: null,
    });
  });
});

describe('setLiveVerificationAction', () => {
  it('needs the exact phrase to verify, none to remove', async () => {
    const wrong = await setLiveVerificationAction(
      IDLE,
      form({ provider: 'pathao', verified: 'true', confirmation: 'VERIFY STEADFAST' }),
    );
    expect(wrong.fieldErrors?.confirmation).toMatch(/VERIFY PATHAO/);
    expect(api.adminSetCourierLiveVerification).not.toHaveBeenCalled();

    api.adminSetCourierLiveVerification.mockResolvedValue(courierConfig());
    await setLiveVerificationAction(
      IDLE,
      form({ provider: 'pathao', verified: 'true', confirmation: 'VERIFY PATHAO' }),
    );
    await setLiveVerificationAction(IDLE, form({ provider: 'pathao', verified: 'false' }));
    expect(api.adminSetCourierLiveVerification.mock.calls.map((call): unknown => call[2])).toEqual([
      { verified: true, confirmation: 'VERIFY PATHAO' },
      { verified: false },
    ]);
  });

  it('explains a missing live check', async () => {
    api.adminSetCourierLiveVerification.mockRejectedValue(
      new ApiError(409, 'courier_live_check_required', API_TEXT),
    );
    const state = await setLiveVerificationAction(
      IDLE,
      form({ provider: 'pathao', verified: 'true', confirmation: 'VERIFY PATHAO' }),
    );
    expect(state.message).toMatch(/successful live connection check/);
  });
});

describe('saveLocationMappingAction', () => {
  const mapping = (keys: string[], values: string[], fields: Record<string, string> = {}) => {
    const data = form({ provider: 'pathao', district: 'Dhaka', area: 'Mirpur', ...fields });
    for (const key of keys) data.append('destKey', key);
    for (const value of values) data.append('destValue', value);
    return data;
  };

  it('sends whole numbers as numbers and skips empty rows', async () => {
    api.adminSaveCourierLocationMapping.mockResolvedValue(undefined);
    const state = await saveLocationMappingAction(
      IDLE,
      mapping(['cityId', 'zoneName', ''], ['1', 'Mirpur 10', ''], { label: 'Mirpur' }),
    );
    expect(api.adminSaveCourierLocationMapping).toHaveBeenCalledWith('access-token', {
      provider: 'pathao',
      district: 'Dhaka',
      area: 'Mirpur',
      destination: { cityId: 1, zoneName: 'Mirpur 10' },
      label: 'Mirpur',
    });
    expect(state.status).toBe('success');
  });

  it.each([
    [['CityId'], ['1'], /lower-case letter/],
    [['cityId'], [''], /needs a value/],
    [[], [], /at least one/],
  ])('refuses destination %j before any call', async (keys, values, words) => {
    const state = await saveLocationMappingAction(IDLE, mapping(keys, values));
    expect(state.fieldErrors?.destination).toMatch(words);
    expect(api.adminSaveCourierLocationMapping).not.toHaveBeenCalled();
  });

  it('needs a courier and a district', async () => {
    const state = await saveLocationMappingAction(
      IDLE,
      mapping(['cityId'], ['1'], { provider: 'other', district: '' }),
    );
    expect(state.fieldErrors?.provider).toBeDefined();
    expect(state.fieldErrors?.district).toBeDefined();
  });
});
