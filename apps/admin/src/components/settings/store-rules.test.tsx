// @vitest-environment jsdom
import type { StoreSettings } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal } from '@/test/redirect';
import { StoreRulesCard } from './store-rules-card';
import { StoreRulesForm } from './store-rules-form';
import {
  checkStoreRules,
  STORE_RULE_MESSAGES,
  storeRuleTexts,
  type StoreRuleTexts,
} from './store-rules';

/*
 * The store rules form: the contract's limits as staff see them, what is sent, and what the
 * card says when the current values cannot be read. The API is faked; nothing here claims
 * a database was involved.
 */

const api = vi.hoisted(() => ({ adminGetStoreSettings: vi.fn() }));
const action = vi.hoisted(() => vi.fn());
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' | 'forbidden' } => ({
  outcome: 'ok',
}));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/lib/settings-actions', () => ({ saveStoreRulesAction: action }));
vi.mock('next/navigation', async () => {
  const { throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), usePathname: () => '/' };
});

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

const SETTINGS: StoreSettings = {
  returnWindowDays: 7,
  cartInactivityMinutes: 1440,
  repeatOrderThreshold: 3,
  highSpendThresholdMinor: 1_500_000,
  inactiveDays: 90,
  monthlySalesTargetMinor: null,
  codEnabled: true,
  updatedAt: '2026-11-06T09:00:00.000Z',
};
const TEXTS = storeRuleTexts(SETTINGS);

beforeEach(() => {
  read.outcome = 'ok';
  api.adminGetStoreSettings.mockReset();
  action.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

describe('storeRuleTexts', () => {
  it('shows the high-spend amount in taka, not poisha', () => {
    expect(TEXTS).toEqual({
      returnWindowDays: '7',
      cartInactivityMinutes: '1440',
      repeatOrderThreshold: '3',
      highSpend: '15000',
      inactiveDays: '90',
    });
    expect(storeRuleTexts({ ...SETTINGS, highSpendThresholdMinor: 150_050 }).highSpend).toBe(
      '1500.50',
    );
  });
});

describe('checkStoreRules', () => {
  it('sends whole numbers and the amount in poisha', () => {
    expect(checkStoreRules(TEXTS)).toEqual({
      ok: true,
      value: {
        returnWindowDays: 7,
        cartInactivityMinutes: 1440,
        repeatOrderThreshold: 3,
        highSpendThresholdMinor: 1_500_000,
        inactiveDays: 90,
      },
    });
    const decimal = checkStoreRules({ ...TEXTS, highSpend: ' ৳1,500.50 ' });
    expect(decimal.ok && decimal.value.highSpendThresholdMinor).toBe(150_050);
  });

  it('leaves an empty threshold out of the request, so the API keeps its current value', () => {
    const checked = checkStoreRules({
      ...TEXTS,
      repeatOrderThreshold: '',
      highSpend: ' ',
      inactiveDays: '',
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(Object.keys(checked.value).sort()).toEqual([
        'cartInactivityMinutes',
        'returnWindowDays',
      ]);
    }
  });

  it('requires the return window and cart inactivity', () => {
    const checked = checkStoreRules({
      ...TEXTS,
      returnWindowDays: '',
      cartInactivityMinutes: '  ',
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.errors).toEqual({
        returnWindowDays: STORE_RULE_MESSAGES.returnWindowDays,
        cartInactivityMinutes: STORE_RULE_MESSAGES.cartInactivityMinutes,
      });
    }
  });

  it.each([
    ['returnWindowDays', '0'],
    ['returnWindowDays', '91'],
    ['cartInactivityMinutes', '14'],
    ['cartInactivityMinutes', '10081'],
    ['repeatOrderThreshold', '1'],
    ['repeatOrderThreshold', '21'],
    ['inactiveDays', '6'],
    ['inactiveDays', '731'],
    ['highSpend', '0'],
    ['highSpend', '10000000.01'],
  ] as const)('refuses %s = %s with the message naming the range', (field, value) => {
    const checked = checkStoreRules({ ...TEXTS, [field]: value });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors).toEqual({ [field]: STORE_RULE_MESSAGES[field] });
  });

  it.each([['7.5'], ['-7'], ['seven'], ['1e2'], ['1,000']])(
    'refuses %j as a number of days',
    (value) => {
      const checked = checkStoreRules({ ...TEXTS, returnWindowDays: value });
      expect(checked.ok).toBe(false);
    },
  );

  it('accepts the limits themselves', () => {
    expect(
      checkStoreRules({
        returnWindowDays: '90',
        cartInactivityMinutes: '15',
        repeatOrderThreshold: '20',
        highSpend: '10000000',
        inactiveDays: '7',
      }).ok,
    ).toBe(true);
  });

  it('names the range in each message', () => {
    expect(STORE_RULE_MESSAGES.returnWindowDays).toContain('1 to 90');
    expect(STORE_RULE_MESSAGES.cartInactivityMinutes).toContain('15 to 10,080');
    expect(STORE_RULE_MESSAGES.repeatOrderThreshold).toContain('2 to 20');
    expect(STORE_RULE_MESSAGES.inactiveDays).toContain('7 to 730');
    expect(STORE_RULE_MESSAGES.highSpend).toContain('10,000,000');
  });
});

describe('StoreRulesForm', () => {
  const renderForm = (initial: StoreRuleTexts = TEXTS) =>
    render(<StoreRulesForm initial={initial} csrf={csrf} />);

  it('starts from the saved values, labelled, with the units beside them', () => {
    renderForm();
    expect(screen.getByLabelText(/^Return window/)).toHaveProperty('value', '7');
    expect(screen.getByLabelText(/^Cart inactivity/)).toHaveProperty('value', '1440');
    expect(screen.getByLabelText('Repeat customer from')).toHaveProperty('value', '3');
    expect(screen.getByLabelText('High spender from')).toHaveProperty('value', '15000');
    expect(screen.getByLabelText('Inactive after')).toHaveProperty('value', '90');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('marks a value outside its range as soon as the field is left, and blocks the send', () => {
    renderForm();
    const window = screen.getByLabelText(/^Return window/);
    fireEvent.change(window, { target: { value: '120' } });
    fireEvent.blur(window);

    expect(screen.getByText(STORE_RULE_MESSAGES.returnWindowDays)).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save store rules' }));
    expect(action).not.toHaveBeenCalled();
  });

  it('sends every field with the CSRF token and shows the outcome', async () => {
    action.mockResolvedValue({ status: 'success', message: 'Store rules saved.' });
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Return window/), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save store rules' }));

    expect(await screen.findByText('Store rules saved.')).toBeTruthy();
    const sent = action.mock.calls[0]?.[1] as FormData;
    expect(sent.get('returnWindowDays')).toBe('14');
    expect(sent.get('cartInactivityMinutes')).toBe('1440');
    expect(sent.get('highSpend')).toBe('15000');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('shows a refusal instead of staying silent', async () => {
    action.mockResolvedValue({
      status: 'error',
      message: 'Changing the store rules needs the “Manage store settings” permission.',
    });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save store rules' }));
    expect(await screen.findByText(/needs the “Manage store settings” permission/)).toBeTruthy();
  });

  it('shows the field errors the server sent beside their fields', async () => {
    action.mockResolvedValue({
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { inactiveDays: STORE_RULE_MESSAGES.inactiveDays },
    });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save store rules' }));
    expect(await screen.findByText(STORE_RULE_MESSAGES.inactiveDays)).toBeTruthy();
  });
});

describe('StoreRulesCard', () => {
  it('shows the saved values in the form', async () => {
    api.adminGetStoreSettings.mockResolvedValue({ settings: SETTINGS });
    render(await StoreRulesCard({ csrf }));

    expect(screen.getByRole('region', { name: 'Store rules' })).toBeTruthy();
    expect(screen.getByLabelText(/^Return window/)).toHaveProperty('value', '7');
    expect(api.adminGetStoreSettings).toHaveBeenCalledWith('access-token');
  });

  it('shows no form, rather than one that could overwrite the values with guesses, when they cannot be read', async () => {
    read.outcome = 'unavailable';
    render(await StoreRulesCard({ csrf }));

    expect(screen.queryByLabelText(/^Return window/)).toBeNull();
    expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
  });

  it('explains a refusal by naming the permission, and sends a lapsed session to sign in', async () => {
    read.outcome = 'forbidden';
    render(await StoreRulesCard({ csrf }));
    expect(screen.getByText(/Manage store settings/)).toBeTruthy();
    cleanup();

    read.outcome = 'signed_out';
    await expect(StoreRulesCard({ csrf })).rejects.toBeInstanceOf(RedirectSignal);
  });
});
