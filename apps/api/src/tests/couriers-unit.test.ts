import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../config/env';
import {
  createPathaoProvider,
  createSteadfastProvider,
} from '../modules/couriers/blocked-providers';
import { createCourierHttpClient, redactSecrets } from '../modules/couriers/http';
import {
  createMockProvider,
  MOCK_SIGNATURE_HEADER,
  MOCK_TIMESTAMP_HEADER,
  mockStatus,
  signMockWebhook,
} from '../modules/couriers/mock-provider';
import { codFeeMinor, internalEstimate, rateCardFor } from '../modules/couriers/pricing';
import { recommendCourier, type RecommendationCandidate } from '../modules/couriers/recommendation';
import { outcomeOf } from '../modules/couriers/service';
import { syncBackoffSeconds } from '../modules/couriers/processor';
import type { BookingRequest } from '../modules/couriers/types';
import { createCourierWorker } from '../modules/couriers/worker';
import { emptyCourierConfig } from '../modules/couriers/config';
import {
  createCourierRuntime,
  effectiveRuntime,
  resolveBaseUrl,
} from '../modules/couriers/runtime';
import type { CourierRuntimeSettings } from '../modules/couriers/store';
import { shipmentStatusNotification } from '../modules/notifications/messages';
import { createSupabaseNotificationStore } from '../modules/notifications/store';
import { createNotificationProcessor } from '../modules/notifications/worker';
import type { SupabaseClients } from '../supabase/clients';
import { captureLogs, TEST_SUPABASE_ENV, testConfig } from './helpers';
import { claimed, FakeNotificationStore, FakePushSender } from './notification-fakes';

const SECRET = 'unit-test-mock-secret-not-real-0123456789';
const NOW = Date.parse('2026-11-14T08:00:00.000Z');

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadConfig({ ...TEST_SUPABASE_ENV, ...env });
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return [...error.problems];
    throw error;
  }
}

const PRODUCTION = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  CORS_ORIGINS: 'https://shop.example.com',
  ADMIN_APP_ORIGIN: 'https://admin.example.com',
  API_CLIENT_SECRET: 'x'.repeat(48),
};

describe('courier environment', () => {
  it('keeps no operating switch in the environment', () => {
    const { couriers } = testConfig();
    expect(couriers).not.toHaveProperty('mode');
    expect(couriers).not.toHaveProperty('bookingEnabled');
    expect(couriers).toMatchObject({
      databaseTarget: 'local',
      mockAllowed: true,
      ignoredVariables: [],
    });
  });

  it('names (never reads) retired operating variables that are still set', () => {
    const { couriers } = testConfig({ COURIER_MODE: 'live', COURIER_HTTP_TIMEOUT_MS: '100' });
    expect(couriers.ignoredVariables).toEqual(['COURIER_MODE', 'COURIER_HTTP_TIMEOUT_MS']);
    // An invalid retired value is no longer a start-up problem: it is ignored.
    expect(problemsOf({ COURIER_TRACKING_SYNC_INTERVAL_SECONDS: '5' })).toEqual([]);
  });

  it('allows test mode only on a local database outside production', () => {
    expect(testConfig({ NODE_ENV: 'development' }).couriers.mockAllowed).toBe(true);
    const hosted = testConfig({ SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' });
    expect(hosted.couriers).toMatchObject({ databaseTarget: 'hosted', mockAllowed: false });
    const localDb = testConfig({
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    expect(localDb.couriers).toMatchObject({ databaseTarget: 'local', mockAllowed: true });
    // Production is refused even on a local database.
    expect(emptyCourierConfig('local', true).mockAllowed).toBe(false);
    expect(problemsOf(PRODUCTION).filter((p) => p.startsWith('COURIER'))).toEqual([]);
  });

  it('keeps base URLs on https and on each courier allow-list', () => {
    expect(problemsOf({ STEADFAST_API_BASE_URL: 'http://portal.packzy.com/api/v1' })).toContain(
      'STEADFAST_API_BASE_URL: must use https',
    );
    expect(problemsOf({ PATHAO_API_BASE_URL: 'https://evil.example.com' }).join(' ')).toContain(
      'PATHAO_API_BASE_URL: host is not on the pathao allow-list',
    );
    expect(problemsOf({ STEADFAST_API_BASE_URL: 'https://user:pw@portal.packzy.com' })).toContain(
      'STEADFAST_API_BASE_URL: must not contain credentials, a query or a fragment',
    );
    const ok = testConfig({
      STEADFAST_API_BASE_URL: 'https://portal.packzy.com/api/v1/',
      PATHAO_API_BASE_URL: 'https://courier-api-sandbox.pathao.com',
    });
    expect(ok.couriers.baseUrls.steadfast).toBe('https://portal.packzy.com/api/v1');
    expect(ok.couriers.baseUrls.pathao).toBe('https://courier-api-sandbox.pathao.com');
  });

  it('needs a long mock webhook secret', () => {
    expect(problemsOf({ COURIER_MOCK_WEBHOOK_SECRET: 'short' }).join(' ')).toContain(
      'COURIER_MOCK_WEBHOOK_SECRET',
    );
  });

  it('never repeats a credential in a problem', () => {
    const problems = problemsOf({ PATHAO_API_BASE_URL: 'https://secret-host-value.example.com' });
    expect(problems.join(' ')).not.toContain('secret-host-value');
  });
});

describe('courier HTTP client', () => {
  const base = { allowedHosts: ['portal.packzy.com'], timeoutMs: 50 };

  it('refuses http and hosts off the allow-list before any network call', async () => {
    const fetch = vi.fn();
    const client = createCourierHttpClient({ ...base, fetch });
    expect(
      await client.request({ method: 'GET', url: 'http://portal.packzy.com/x', idempotent: true }),
    ).toMatchObject({
      kind: 'blocked',
    });
    expect(
      await client.request({ method: 'GET', url: 'https://evil.example.com/x', idempotent: true }),
    ).toMatchObject({
      kind: 'blocked',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a timeout as uncertain and does not retry', async () => {
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
          });
        }),
    );
    const client = createCourierHttpClient({
      ...base,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const outcome = await client.request({
      method: 'POST',
      url: 'https://portal.packzy.com/x',
      body: {},
      idempotent: false,
    });
    expect(outcome).toMatchObject({ kind: 'uncertain', reason: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a 5xx, an oversized or unreadable answer as uncertain', async () => {
    const answer = (body: string, status = 200) =>
      createCourierHttpClient({
        ...base,
        maxResponseBytes: 64,
        fetch: () => Promise.resolve(new Response(body, { status })),
      });
    const url = 'https://portal.packzy.com/x';
    expect(
      await answer('{}', 502).request({ method: 'POST', url, idempotent: false }),
    ).toMatchObject({
      kind: 'uncertain',
      reason: 'server_error',
    });
    expect(
      await answer('x'.repeat(200)).request({ method: 'GET', url, idempotent: true }),
    ).toMatchObject({
      kind: 'uncertain',
      reason: 'too_large',
    });
    expect(
      await answer('not json').request({ method: 'GET', url, idempotent: true }),
    ).toMatchObject({
      kind: 'uncertain',
      reason: 'unparseable',
    });
    expect(
      await answer('{"ok":1}', 422).request({ method: 'POST', url, idempotent: false }),
    ).toEqual({
      kind: 'response',
      status: 422,
      body: { ok: 1 },
    });
  });

  it('redacts credentials, phone numbers and emails', () => {
    const text = redactSecrets('key=abc12345 phone +8801712345678 mail a.b@example.com', [
      'abc12345',
    ]);
    expect(text).toBe('key=[redacted] phone [phone] mail [email]');
  });
});

const bookingRequest = (overrides: Partial<BookingRequest> = {}): BookingRequest => ({
  shipmentId: '00000000-0000-4000-8000-000000000001',
  merchantRef: 'NZ200001-F1',
  kind: 'forward',
  codAmountMinor: 160_000,
  weightGrams: 800,
  deliveryZone: 'inside_dhaka',
  destination: {},
  note: null,
  itemCount: 1,
  recipient: {
    name: 'Test',
    phone: '01700000000',
    addressLine: 'Road 1',
    area: 'Dhanmondi',
    district: 'Dhaka',
    division: 'Dhaka',
    postalCode: null,
    landmark: null,
  },
  providerSettings: {},
  ...overrides,
});

describe('mock courier', () => {
  const mock = (now = () => NOW) =>
    createMockProvider({
      id: 'steadfast',
      displayName: 'Steadfast Courier',
      webhookSecret: SECRET,
      now,
    });

  it('books deterministically and plays its scenarios', async () => {
    const first = await mock().book(bookingRequest());
    const second = await mock().book(bookingRequest());
    expect(first).toEqual(second);
    expect(first.kind === 'ok' && first.value.consignmentId).toMatch(/^MK-[0-9A-F]{10}-[0-9A-Z]+$/);
    expect(await mock().book(bookingRequest({ note: 'x [mock:reject]' }))).toMatchObject({
      kind: 'refused',
    });
    expect(await mock().book(bookingRequest({ note: '[mock:timeout]' }))).toMatchObject({
      kind: 'uncertain',
    });
  });

  it('quotes from a fixed table with a rounded-up COD fee', async () => {
    const quote = await mock().quote({
      weightGrams: 1_600,
      zone: 'outside_dhaka',
      codAmountMinor: 12_345,
    });
    expect(quote).toMatchObject({
      kind: 'ok',
      value: { kind: 'live', deliveryChargeMinor: 11_000 + 2 * 1_500, codFeeMinor: 124 },
    });
  });

  it('tracks by elapsed time with stable event times', async () => {
    const booked = await mock().book(bookingRequest());
    if (booked.kind !== 'ok') throw new Error('expected a booking');
    const at = (minutes: number) =>
      mock(() => NOW + minutes * 60_000).track({
        consignmentId: booked.value.consignmentId,
        trackingCode: null,
        merchantRef: 'NZ200001-F1',
      });
    expect(await at(1)).toEqual({ kind: 'ok', value: [] });
    const later = await at(35);
    expect(later.kind === 'ok' && later.value.map((e) => e.status)).toEqual([
      'pickup_pending',
      'picked_up',
      'in_transit',
    ]);
    expect(await at(36)).toEqual(later);
    expect(
      await mock().track({ consignmentId: 'SF-1', trackingCode: null, merchantRef: 'x' }),
    ).toMatchObject({ kind: 'refused' });
  });

  it('verifies webhooks with HMAC, a time window and a constant-time compare', () => {
    const provider = mock();
    const body = Buffer.from('{"status":"picked","consignmentId":"MK-1"}');
    const ts = String(NOW / 1000);
    const headers =
      (signature: string, timestamp = ts) =>
      (name: string) =>
        name === MOCK_TIMESTAMP_HEADER
          ? timestamp
          : name === MOCK_SIGNATURE_HEADER
            ? signature
            : undefined;
    const good = signMockWebhook(SECRET, ts, body);
    expect(provider.verifyWebhook(headers(good), body, NOW)).toEqual({ ok: true });
    expect(provider.verifyWebhook(headers(`sha256=${good}`), body, NOW)).toEqual({ ok: true });
    expect(provider.verifyWebhook(headers(good.slice(0, -1)), body, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const flipped = `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`;
    expect(provider.verifyWebhook(headers(flipped), body, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(provider.verifyWebhook(headers(good), Buffer.from(`${body.toString()} `), NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    // Replayed six minutes later.
    expect(provider.verifyWebhook(headers(good), body, NOW + 6 * 60_000)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(provider.verifyWebhook(() => undefined, body, NOW)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    const unsigned = createMockProvider({
      id: 'pathao',
      displayName: 'Pathao',
      webhookSecret: undefined,
    });
    expect(unsigned.verifyWebhook(headers(good), body, NOW)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(unsigned.capabilities().webhook).toBe('unsupported');
  });

  it('keeps only allow-listed webhook fields', () => {
    const parsed = mock().parseWebhook(
      Buffer.from(
        JSON.stringify({
          eventId: 'e1',
          consignmentId: 'MK-1',
          status: 'picked',
          name: 'Rahima',
          phone: '01712345678',
        }),
      ),
    );
    expect(parsed?.payload).toEqual({ eventId: 'e1', status: 'picked', occurredAt: null });
    expect(JSON.stringify(parsed)).not.toContain('01712345678');
    expect(mock().parseWebhook(Buffer.from('not json'))).toBeNull();
  });

  it('maps its status words and nothing inherited', () => {
    expect(mockStatus('picked')).toBe('picked_up');
    expect(mockStatus('returning')).toBe('return_initiated');
    expect(mockStatus('constructor')).toBe('unknown');
    expect(mockStatus('something_new')).toBe('unknown');
  });
});

describe('blocked Steadfast and Pathao adapters', () => {
  it('make no network call and answer awaiting documentation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      for (const provider of [createSteadfastProvider(), createPathaoProvider()]) {
        expect(
          await provider.quote({ weightGrams: 500, zone: 'inside_dhaka', codAmountMinor: 0 }),
        ).toMatchObject({
          kind: 'awaiting_documentation',
        });
        expect(await provider.book(bookingRequest())).toMatchObject({
          kind: 'awaiting_documentation',
        });
        expect(
          await provider.track({ consignmentId: 'x', trackingCode: null, merchantRef: 'x' }),
        ).toMatchObject({
          kind: 'awaiting_documentation',
        });
        expect(await provider.checkConnection()).toMatchObject({ kind: 'awaiting_documentation' });
        expect(provider.verifyWebhook(() => 'anything', Buffer.from('{}'), NOW)).toMatchObject({
          ok: false,
        });
        expect(provider.parseWebhook(Buffer.from('{}'))).toBeNull();
        expect(provider.blockedReason).toContain(
          'until the merchant API documentation is verified',
        );
      }
      expect(
        await createSteadfastProvider().cancel({ consignmentId: 'x', merchantRef: 'x' }),
      ).toMatchObject({
        kind: 'unsupported',
      });
      expect(createSteadfastProvider().capabilities().cancel).toBe('unsupported');
      expect(createPathaoProvider().capabilities().cancel).toBe('awaiting_documentation');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('courier pricing', () => {
  const card = (weightUpToGrams: number, chargeMinor: number, extra: object = {}) => ({
    id: `00000000-0000-4000-8000-${String(weightUpToGrams).padStart(12, '0')}`,
    provider: 'steadfast',
    zone: 'inside_dhaka' as const,
    weightUpToGrams,
    chargeMinor,
    isActive: true,
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...extra,
  });

  it('picks the smallest active bracket that holds the parcel', () => {
    const cards = [
      card(2000, 9000),
      card(500, 6000),
      card(1000, 7000),
      card(1500, 1, { isActive: false }),
    ];
    expect(rateCardFor(cards, 'steadfast', 'inside_dhaka', 501)?.chargeMinor).toBe(7000);
    expect(rateCardFor(cards, 'steadfast', 'inside_dhaka', 500)?.chargeMinor).toBe(6000);
    expect(rateCardFor(cards, 'steadfast', 'inside_dhaka', 2001)).toBeUndefined();
    expect(rateCardFor(cards, 'steadfast', 'outside_dhaka', 100)).toBeUndefined();
  });

  it('rounds the COD fee up to a whole poisha', () => {
    expect(codFeeMinor(12_345, 100)).toBe(124);
    expect(codFeeMinor(10_000, 100)).toBe(100);
    expect(codFeeMinor(0, 100)).toBe(0);
    expect(codFeeMinor(10_000, null)).toBeNull();
  });

  it('labels an estimate, or says why there is none', () => {
    const estimate = internalEstimate({
      provider: 'steadfast',
      zone: 'inside_dhaka',
      weightGrams: 800,
      codAmountMinor: 160_000,
      rateCards: [card(1000, 7000)],
      codFeeBp: 100,
      returnChargeMinor: 3500,
    });
    expect(estimate).toMatchObject({
      kind: 'internal_estimate',
      available: true,
      deliveryChargeMinor: 7000,
      codFeeMinor: 1600,
      returnChargeMinor: 3500,
      isMock: false,
    });
    const none = internalEstimate({
      ...estimate,
      provider: 'pathao',
      rateCards: [card(1000, 7000)],
      codFeeBp: null,
      returnChargeMinor: null,
    });
    expect(none).toMatchObject({
      kind: 'unavailable',
      available: false,
      deliveryChargeMinor: null,
    });
  });
});

describe('courier recommendation', () => {
  const candidate = (
    provider: string,
    delivery: number | null,
    extra: Partial<RecommendationCandidate> = {},
  ): RecommendationCandidate => ({
    provider,
    displayName: provider,
    eligible: delivery !== null,
    quoteKind: 'internal_estimate',
    deliveryChargeMinor: delivery,
    codFeeMinor: 0,
    notes: [],
    ...extra,
  });
  const settings = { minHistorySample: 20, preferredProvider: null };

  it('prefers the cheaper courier when there is no history', () => {
    const result = recommendCourier(
      [candidate('steadfast', 7000), candidate('pathao', 6000)],
      [],
      settings,
    );
    expect(result.provider).toBe('pathao');
    expect(result.reasons[0]).toContain('lowest expected cost');
  });

  it('counts delivery history only from the minimum sample', () => {
    const history = [
      { provider: 'pathao', settled: 5, delivered: 0, failed: 5 },
      { provider: 'steadfast', settled: 100, delivered: 98, failed: 2 },
    ];
    const result = recommendCourier(
      [candidate('steadfast', 6100), candidate('pathao', 6000)],
      history,
      settings,
    );
    const pathao = result.candidates.find((c) => c.provider === 'pathao');
    expect(pathao?.deliveryRate).toBeNull();
    // Pathao's five failures do not count; the neutral rate leaves it cheapest.
    expect(result.provider).toBe('pathao');

    const enough = [
      { provider: 'pathao', settled: 50, delivered: 25, failed: 25 },
      { provider: 'steadfast', settled: 100, delivered: 98, failed: 2 },
    ];
    const withHistory = recommendCourier(
      [candidate('steadfast', 6100), candidate('pathao', 6000)],
      enough,
      settings,
    );
    expect(withHistory.provider).toBe('steadfast');
    expect(withHistory.reasons.join(' ')).toContain(
      'best delivery rate (98% of 100 settled parcels)',
    );
  });

  it('breaks a tie with the preferred courier, then by name', () => {
    const tied = [candidate('steadfast', 6000), candidate('pathao', 6000)];
    expect(recommendCourier(tied, [], settings).provider).toBe('pathao');
    const preferred = recommendCourier(tied, [], { ...settings, preferredProvider: 'steadfast' });
    expect(preferred.provider).toBe('steadfast');
    expect(preferred.reasons.join(' ')).toContain('preferred courier');
  });

  it('recommends nobody when no courier can take the parcel', () => {
    const result = recommendCourier(
      [candidate('steadfast', null), candidate('pathao', 5000, { eligible: false })],
      [],
      settings,
    );
    expect(result.provider).toBeNull();
    expect(result.candidates.every((c) => !c.eligible && c.score === null)).toBe(true);
  });

  it('is deterministic', () => {
    const input = [candidate('steadfast', 6100), candidate('pathao', 6000)];
    expect(recommendCourier(input, [], settings)).toEqual(
      recommendCourier([...input].reverse(), [], settings),
    );
  });
});

describe('booking outcome and sync backoff', () => {
  it('derives the outcome of a repeated booking key from the shipment', () => {
    const base = {
      status: 'booking_pending',
      bookingUncertain: false,
      consignmentId: null,
    } as const;
    const outcome = (fields: object) =>
      outcomeOf({ ...base, ...fields } as Parameters<typeof outcomeOf>[0]);
    expect(outcome({})).toBe('in_progress');
    expect(outcome({ bookingUncertain: true })).toBe('uncertain');
    expect(outcome({ status: 'booking_failed' })).toBe('failed');
    expect(outcome({ status: 'in_transit', consignmentId: 'MK-1' })).toBe('booked');
    expect(outcome({ status: 'cancelled' })).toBe('failed');
  });

  it('backs off failed syncs up to seven days', () => {
    expect(syncBackoffSeconds(0, 300)).toBe(300);
    expect(syncBackoffSeconds(3, 300)).toBe(2400);
    expect(syncBackoffSeconds(40, 300)).toBe(604_800);
  });
});

describe('courier worker', () => {
  const saved = (overrides: Partial<CourierRuntimeSettings> = {}): CourierRuntimeSettings => ({
    mode: 'off',
    bookingEnabled: false,
    trackingSyncEnabled: false,
    trackingSyncIntervalSeconds: 300,
    httpTimeoutMs: 15_000,
    providers: [],
    ...overrides,
  });

  it('reads the saved settings every round: off does nothing, sync only when on', async () => {
    const processor = {
      syncDue: vi.fn(() => Promise.resolve({ claimed: 0, synced: 0, failed: 0 })),
      retryWebhooks: vi.fn(() => Promise.resolve({ claimed: 0, processed: 0, failed: 0 })),
    };
    let current = saved();
    const runtime = {
      current: () => Promise.resolve(effectiveRuntime(current, emptyCourierConfig('local'))),
    };
    const worker = createCourierWorker({ processor, runtime, logger: captureLogs().logger });
    await worker.runOnce();
    expect(processor.retryWebhooks).not.toHaveBeenCalled();
    expect(processor.syncDue).not.toHaveBeenCalled();

    current = saved({ mode: 'mock' });
    await worker.runOnce();
    expect(processor.retryWebhooks).toHaveBeenCalledTimes(1);
    expect(processor.syncDue).not.toHaveBeenCalled();

    current = saved({ mode: 'mock', trackingSyncEnabled: true });
    await worker.runOnce();
    expect(processor.syncDue).toHaveBeenCalledTimes(1);

    // A sync switch left on while couriers are off still syncs nothing.
    current = saved({ mode: 'off', trackingSyncEnabled: true });
    await worker.runOnce();
    expect(processor.syncDue).toHaveBeenCalledTimes(1);
  });

  it('starts and stops cleanly', async () => {
    const processor = {
      syncDue: vi.fn(() => Promise.resolve({ claimed: 0, synced: 0, failed: 0 })),
      retryWebhooks: vi.fn(() => Promise.resolve({ claimed: 0, processed: 0, failed: 0 })),
    };
    const runtime = {
      current: () =>
        Promise.resolve(
          effectiveRuntime(
            saved({ mode: 'mock', trackingSyncEnabled: true }),
            emptyCourierConfig('local'),
          ),
        ),
    };
    const worker = createCourierWorker({
      processor,
      runtime,
      logger: captureLogs().logger,
      pollIntervalMs: 60_000,
    });
    worker.start();
    await worker.stop();
    expect(processor.syncDue).toHaveBeenCalledTimes(1);
  });
});

describe('courier runtime settings', () => {
  const settings = (mode: 'off' | 'mock' | 'live'): CourierRuntimeSettings => ({
    mode,
    bookingEnabled: true,
    trackingSyncEnabled: true,
    trackingSyncIntervalSeconds: 600,
    httpTimeoutMs: 9_000,
    providers: [
      {
        provider: 'steadfast',
        isEnabled: true,
        apiBaseUrl: null,
        liveVerified: false,
        credentialFields: [],
      },
    ],
  });

  it('treats a saved test mode as off where test mode is not allowed', () => {
    const hosted = effectiveRuntime(settings('mock'), emptyCourierConfig('hosted'));
    expect(hosted).toMatchObject({
      mode: 'off',
      bookingEnabled: false,
      trackingSyncEnabled: false,
    });
    expect(hosted.modeNotice).toContain('local database');
    const local = effectiveRuntime(settings('mock'), emptyCourierConfig('local'));
    expect(local).toMatchObject({ mode: 'mock', modeNotice: null, trackingSyncEnabled: true });
    // Real bookings are on only in live mode.
    expect(local.bookingEnabled).toBe(false);
    expect(effectiveRuntime(settings('live'), emptyCourierConfig('hosted'))).toMatchObject({
      mode: 'live',
      bookingEnabled: true,
      trackingSyncIntervalSeconds: 600,
      httpTimeoutMs: 9_000,
    });
  });

  it('caches briefly, reads again after invalidation, and never caches a failure', async () => {
    let clock = 0;
    let reads = 0;
    let fail = false;
    const store = {
      runtime: () => {
        reads += 1;
        return fail ? Promise.reject(new Error('down')) : Promise.resolve(settings('off'));
      },
      credentials: () => Promise.resolve({}),
    };
    const runtime = createCourierRuntime({
      store,
      config: emptyCourierConfig('local'),
      ttlMs: 5_000,
      now: () => clock,
    });
    await runtime.current();
    await runtime.current();
    expect(reads).toBe(1);
    runtime.invalidate();
    await runtime.current();
    expect(reads).toBe(2);
    clock += 6_000;
    fail = true;
    await expect(runtime.current()).rejects.toThrow('down');
    fail = false;
    await runtime.current();
    expect(reads).toBe(4);
  });

  it('gives adapters Vault credentials first and the environment per field', async () => {
    const config = {
      ...emptyCourierConfig('local'),
      credentials: {
        steadfast: { api_key: 'env-key-not-real', secret_key: 'env-secret-not-real' },
        pathao: {},
      },
      baseUrls: { steadfast: 'https://portal.packzy.com/api/v1', pathao: undefined },
    };
    const runtime = createCourierRuntime({
      store: {
        runtime: () => Promise.resolve(settings('live')),
        credentials: () => Promise.resolve({ api_key: 'vault-key-not-real' }),
      },
      config,
    });
    const context = await runtime.adapterContext('steadfast');
    expect(context).toEqual({
      credentials: { api_key: 'vault-key-not-real', secret_key: 'env-secret-not-real' },
      baseUrl: 'https://portal.packzy.com/api/v1',
      timeoutMs: 9_000,
    });
  });

  it('re-validates a saved base URL against the allow-list', () => {
    const config = emptyCourierConfig('local');
    expect(resolveBaseUrl('steadfast', 'https://evil.example.com', config).valid).toBe(false);
    expect(resolveBaseUrl('steadfast', 'https://portal.packzy.com/api/v1', config)).toEqual({
      url: 'https://portal.packzy.com/api/v1',
      valid: true,
    });
    expect(resolveBaseUrl('pathao', null, config)).toEqual({ url: null, valid: false });
  });
});

describe('shipment rows in the push outbox', () => {
  it('reads shipment rows from claim_notifications and keeps order rows as before', async () => {
    const rows = [
      {
        id: '0a000000-0000-4000-8000-000000000001',
        user_id: '0b000000-0000-4000-8000-000000000001',
        order_number: 'NZ200001',
        to_status: null,
        attempts: 1,
        kind: 'shipment',
        shipment_status: 'delivered',
      },
      {
        id: '0a000000-0000-4000-8000-000000000002',
        user_id: '0b000000-0000-4000-8000-000000000001',
        order_number: 'NZ200001',
        to_status: 'shipped',
        attempts: 2,
        kind: 'order_status',
        shipment_status: null,
      },
    ];
    const clients = {
      admin: { rpc: () => Promise.resolve({ data: rows, error: null, status: 200 }) },
    } as unknown as SupabaseClients;
    const claimedRows = await createSupabaseNotificationStore(clients).claim(10, 60);
    expect(claimedRows).toEqual([
      expect.objectContaining({ kind: 'shipment', toStatus: null, shipmentStatus: 'delivered' }),
      expect.objectContaining({
        kind: 'order_status',
        toStatus: 'shipped',
        shipmentStatus: null,
        attempts: 2,
      }),
    ]);
  });

  it('sends the shipment text with the order deep link', async () => {
    const store = new FakeNotificationStore();
    const sender = new FakePushSender();
    const row = claimed({
      kind: 'shipment',
      toStatus: null,
      shipmentStatus: 'out_for_delivery',
      orderNumber: 'NZ200009',
    });
    store.devices.set(row.userId, [
      { id: 'de000000-0000-4000-8000-000000000001', token: 'token-A' },
    ]);
    store.queue = [row];
    const processor = createNotificationProcessor({
      store,
      sender,
      logger: captureLogs().logger,
      random: () => 0.5,
    });
    expect(await processor.runOnce()).toMatchObject({ sent: 1 });
    expect(sender.sent[0]).toMatchObject({
      title: 'Out for delivery',
      data: { orderNumber: 'NZ200009' },
      tag: row.id,
    });
  });

  it('closes a shipment row whose status sends no news', async () => {
    const store = new FakeNotificationStore();
    const sender = new FakePushSender();
    store.queue = [claimed({ kind: 'shipment', toStatus: null, shipmentStatus: 'in_transit' })];
    const processor = createNotificationProcessor({ store, sender, logger: captureLogs().logger });
    await processor.runOnce();
    expect(store.finished[0]).toMatchObject({ outcome: 'failed', errorCode: 'unsupported_status' });
    expect(sender.sent).toHaveLength(0);
  });
});

describe('shipment push messages', () => {
  it('carries the order number only, and the same deep link as order news', () => {
    const message = shipmentStatusNotification('NZ200001', 'out_for_delivery');
    expect(message).toEqual({
      title: 'Out for delivery',
      body: 'The parcel for order NZ200001 is out for delivery.',
      data: { orderNumber: 'NZ200001' },
    });
    for (const status of [
      'booked',
      'picked_up',
      'delivered',
      'partially_delivered',
      'delivery_failed',
      'return_initiated',
      'returned',
      'cancelled',
    ]) {
      const text = shipmentStatusNotification('NZ200001', status);
      expect(text?.data).toEqual({ orderNumber: 'NZ200001' });
      expect(text?.body).not.toMatch(/৳|BDT|\d{11}/);
    }
  });

  it('sends nothing for statuses without news or a bad order number', () => {
    expect(shipmentStatusNotification('NZ200001', 'in_transit')).toBeNull();
    expect(shipmentStatusNotification('NZ200001', 'toString')).toBeNull();
    expect(shipmentStatusNotification('not-an-order', 'delivered')).toBeNull();
  });
});
