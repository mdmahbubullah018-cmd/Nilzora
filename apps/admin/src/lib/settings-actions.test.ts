import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import { saveStoreRulesAction } from './settings-actions';

/*
 * The store rules action answers with a state the form shows: fixed messages only (never
 * the API's own text), nothing reaches the API from an untrusted or invalid form, and the
 * request carries only the fields the contract names.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({ adminSaveStoreSettings: vi.fn() }));
const act = vi.hoisted((): { outcome: Outcome } => ({ outcome: 'ok' }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };
const API_TEXT = 'API text that must not reach the browser';
const SAVED = {
  settings: {
    returnWindowDays: 14,
    cartInactivityMinutes: 720,
    repeatOrderThreshold: 4,
    highSpendThresholdMinor: 2_000_050,
    inactiveDays: 120,
    monthlySalesTargetMinor: null,
    updatedAt: '2026-11-06T09:00:00.000Z',
  },
};
const FIELDS = {
  returnWindowDays: '14',
  cartInactivityMinutes: '720',
  repeatOrderThreshold: '4',
  highSpend: '20000.50',
  inactiveDays: '120',
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  act.outcome = 'ok';
  revalidatePath.mockReset();
  api.adminSaveStoreSettings.mockReset().mockResolvedValue(SAVED);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('saveStoreRulesAction', () => {
  it('sends the contract’s fields, with the amount in poisha, and answers with the saved values', async () => {
    const state = await saveStoreRulesAction(IDLE, form(FIELDS));

    expect(api.adminSaveStoreSettings).toHaveBeenCalledWith('access-token', {
      returnWindowDays: 14,
      cartInactivityMinutes: 720,
      repeatOrderThreshold: 4,
      highSpendThresholdMinor: 2_000_050,
      inactiveDays: 120,
    });
    expect(state).toEqual({
      status: 'success',
      message: 'Store rules saved.',
      values: { ...FIELDS },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
  });

  it('leaves empty thresholds out so the API keeps them', async () => {
    await saveStoreRulesAction(
      IDLE,
      form({ ...FIELDS, repeatOrderThreshold: '', highSpend: '', inactiveDays: '' }),
    );
    expect(api.adminSaveStoreSettings).toHaveBeenCalledWith('access-token', {
      returnWindowDays: 14,
      cartInactivityMinutes: 720,
    });
  });

  it('ignores fields the contract does not name, such as a smuggled sales target or role', async () => {
    await saveStoreRulesAction(
      IDLE,
      form({ ...FIELDS, monthlySalesTargetMinor: '1', role: 'super_admin' }),
    );
    const body = api.adminSaveStoreSettings.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'cartInactivityMinutes',
      'highSpendThresholdMinor',
      'inactiveDays',
      'repeatOrderThreshold',
      'returnWindowDays',
    ]);
  });

  it('marks every field outside its range before calling the API, and keeps what was typed', async () => {
    const state = await saveStoreRulesAction(
      IDLE,
      form({ ...FIELDS, returnWindowDays: '0', cartInactivityMinutes: '5', highSpend: 'lots' }),
    );

    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual([
      'cartInactivityMinutes',
      'highSpend',
      'returnWindowDays',
    ]);
    expect(state.values).toMatchObject({ returnWindowDays: '0', highSpend: 'lots' });
    expect(api.adminSaveStoreSettings).not.toHaveBeenCalled();
  });

  it('shows fixed messages for a refusal, never the API text, and keeps what was typed', async () => {
    api.adminSaveStoreSettings.mockRejectedValue(new ApiError(403, 'forbidden', API_TEXT, 'req-1'));
    const forbidden = await saveStoreRulesAction(IDLE, form(FIELDS));
    expect(forbidden.status).toBe('error');
    expect(forbidden.message).toContain('Manage store settings');
    expect(JSON.stringify(forbidden)).not.toContain(API_TEXT);
    if (forbidden.status === 'error') expect(forbidden.values?.returnWindowDays).toBe('14');

    api.adminSaveStoreSettings.mockRejectedValue(
      new ApiError(400, 'bad_request', API_TEXT, 'req-2'),
    );
    const refused = await saveStoreRulesAction(IDLE, form(FIELDS));
    expect(refused.status).toBe('error');
    expect(JSON.stringify(refused)).not.toContain(API_TEXT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reaches no API with an untrusted form, and sends a lapsed session to sign in', async () => {
    act.outcome = 'untrusted';
    expect((await saveStoreRulesAction(IDLE, form(FIELDS))).status).toBe('error');
    expect(api.adminSaveStoreSettings).not.toHaveBeenCalled();

    act.outcome = 'signed_out';
    const error = await saveStoreRulesAction(IDLE, form(FIELDS)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe(
      `/login?next=${encodeURIComponent('/admin/settings')}`,
    );
  });
});
