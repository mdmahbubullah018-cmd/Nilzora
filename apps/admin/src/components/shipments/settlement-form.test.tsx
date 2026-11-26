// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSettlement, SettlementForm, type SettlementLineDraft } from './settlement-form';
import { SHIPMENT_ID } from './fixtures';

vi.mock('@/lib/courier-actions', () => ({ recordSettlementAction: vi.fn() }));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
afterEach(cleanup);

const line = (settled: string, extra: Partial<SettlementLineDraft> = {}): SettlementLineDraft => ({
  shipmentId: SHIPMENT_ID,
  settled,
  deliveryCharge: '',
  codFee: '',
  returnCharge: '',
  other: '',
  ...extra,
});

describe('checkSettlement', () => {
  it('accepts lines that add up exactly to the payout', () => {
    const result = checkSettlement('1,500.50', [line('1000'), line('500.50')]);
    expect(result).toMatchObject({ ok: true, linesMinor: 150_050, amountMinor: 150_050 });
  });

  it('says by how much the lines miss the payout', () => {
    const result = checkSettlement('1500', [line('1000')]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('The lines add up to ৳1,000 but the payout is ৳1,500.');
  });

  it('needs at least one line, valid amounts and a payout', () => {
    expect(checkSettlement('100', []).message).toBe('Choose at least one shipment.');
    expect(checkSettlement('100', [line('')]).ok).toBe(false);
    expect(checkSettlement('100', [line('100', { codFee: 'abc' })]).ok).toBe(false);
    expect(checkSettlement('', [line('100')]).message).toBe('Enter the payout amount in taka.');
  });
});

describe('SettlementForm', () => {
  it('blocks the submit until the chosen lines add up to the amount', () => {
    render(
      <SettlementForm
        csrf={csrf}
        today="2026-11-14"
        allowTest={false}
        candidates={[
          {
            shipmentId: SHIPMENT_ID,
            orderNumber: 'NZ100001',
            provider: 'steadfast',
            consignmentId: 'SF-1',
            isMock: false,
            outstandingMinor: 117_750,
          },
        ]}
      />,
    );
    const submit = screen.getByRole('button', { name: 'Record settlement' });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText(/Settled \(৳\)/)).toHaveProperty('value', '1177.50');
    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: '1000' } });
    expect(screen.getByTestId('settlement-check').textContent).toMatch(/add up to ৳1,177.50/);
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: '1177.50' } });
    expect(screen.getByTestId('settlement-check').textContent).toMatch(/add up to the payout/);
    expect(submit).toHaveProperty('disabled', false);
  });

  it('lists only the chosen courier’s shipments', () => {
    render(
      <SettlementForm
        csrf={csrf}
        today="2026-11-14"
        allowTest={false}
        candidates={[
          {
            shipmentId: SHIPMENT_ID,
            orderNumber: 'NZ100002',
            provider: 'pathao',
            consignmentId: null,
            isMock: false,
            outstandingMinor: 1_000,
          },
        ]}
      />,
    );
    expect(screen.getByText(/No Steadfast shipments are waiting/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Courier/), { target: { value: 'pathao' } });
    expect(screen.getByText('NZ100002')).toBeTruthy();
  });
});
