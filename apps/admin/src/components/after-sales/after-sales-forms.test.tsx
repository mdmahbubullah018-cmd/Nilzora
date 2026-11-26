// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundRequestForm, RefundSteps, ReturnSteps } from './after-sales-forms';

const actions = vi.hoisted(() => ({
  decideReturn: vi.fn(),
  restockReturn: vi.fn(),
  requestRefund: vi.fn(),
  decideRefund: vi.fn(),
  completeRefund: vi.fn(),
  cancelRefund: vi.fn(),
}));

vi.mock('@/lib/after-sales-actions', () => ({
  decideReturnAction: actions.decideReturn,
  restockReturnAction: actions.restockReturn,
  requestRefundAction: actions.requestRefund,
  decideRefundAction: actions.decideRefund,
  completeRefundAction: actions.completeRefund,
  cancelRefundAction: actions.cancelRefund,
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const RETURN = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const REFUND = '9d1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

function returnSteps(overrides: Partial<Parameters<typeof ReturnSteps>[0]> = {}) {
  return render(
    <ReturnSteps
      returnId={RETURN}
      status="requested"
      received={false}
      restocked={false}
      canDecide
      canRestock
      csrf={csrf}
      {...overrides}
    />,
  );
}

describe('ReturnSteps', () => {
  it('offers only the decisions the return’s status allows', () => {
    returnSteps();
    const options = within(screen.getByLabelText('Decision')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Approve return',
      'Reject return',
      'Cancel return',
    ]);
    cleanup();

    returnSteps({ status: 'received', received: true });
    expect(
      within(screen.getByLabelText('Decision'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Complete return']);
  });

  it('shows what happened after a decision', async () => {
    actions.decideReturn.mockResolvedValue({
      status: 'success',
      message: 'Return approved. Mark the goods received when they arrive.',
    });
    returnSteps();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText(/Return approved/)).toBeTruthy();
    const sent = actions.decideReturn.mock.calls[0]?.[1] as FormData;
    expect(sent.get('returnId')).toBe(RETURN);
    expect(sent.get('status')).toBe('approved');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('shows a refusal under the field it belongs to instead of dropping it', async () => {
    actions.decideReturn.mockResolvedValue({
      status: 'error',
      message: 'Give the customer a reason to reject the return.',
      fieldErrors: { note: 'Give a reason of 3 to 300 characters.' },
      values: { note: '' },
    });
    returnSteps();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('Give a reason of 3 to 300 characters.')).toBeTruthy();
    expect(screen.getByText('Give the customer a reason to reject the return.')).toBeTruthy();
  });

  it('closes the decision form for a closed return and without orders.update_status', () => {
    returnSteps({ status: 'completed' });
    expect(screen.getByText(/This return is closed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    cleanup();

    returnSteps({ canDecide: false });
    expect(screen.getByText(/“Update order status” permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('restocks only received goods, and says when it worked or failed', async () => {
    returnSteps();
    expect(screen.getByText(/available once the goods are marked as received/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restock received items' })).toBeNull();
    cleanup();

    actions.restockReturn.mockResolvedValue({ status: 'error', message: 'This return has already moved on.' });
    returnSteps({ status: 'received', received: true });
    fireEvent.click(screen.getByRole('button', { name: 'Restock received items' }));
    expect(await screen.findByText('This return has already moved on.')).toBeTruthy();
    cleanup();

    returnSteps({ status: 'received', received: true, restocked: true });
    expect(screen.getByText(/already back in stock/)).toBeTruthy();
    cleanup();

    returnSteps({ status: 'received', received: true, canRestock: false });
    expect(screen.getByText(/“Adjust stock” permission/)).toBeTruthy();
  });
});

describe('RefundSteps', () => {
  it('shows the decision form for a requested refund and the payout form once approved', () => {
    render(<RefundSteps refundId={REFUND} status="requested" csrf={csrf} />);
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record payout' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel refund' })).toBeTruthy();
    cleanup();

    render(<RefundSteps refundId={REFUND} status="approved" csrf={csrf} />);
    expect(screen.getByRole('button', { name: 'Record payout' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('shows the payout’s outcome and the reference problem beside its field', async () => {
    actions.completeRefund.mockResolvedValue({
      status: 'error',
      message: 'Check the highlighted fields',
      fieldErrors: { reference: 'Enter the receipt or transfer reference (3 to 120 characters).' },
      values: { reference: 'x', note: '' },
    });
    render(<RefundSteps refundId={REFUND} status="approved" csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record payout' }));
    expect(await screen.findByText(/Enter the receipt or transfer reference/)).toBeTruthy();
    cleanup();

    actions.completeRefund.mockResolvedValue({ status: 'success', message: 'Payout recorded. The refund is paid out.' });
    render(<RefundSteps refundId={REFUND} status="approved" csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record payout' }));
    expect(await screen.findByText('Payout recorded. The refund is paid out.')).toBeTruthy();
  });

  it('shows a cancellation’s refusal instead of staying silent', async () => {
    actions.cancelRefund.mockResolvedValue({
      status: 'error',
      message: 'Give a reason to cancel the refund.',
      fieldErrors: { note: 'Give a reason of 5 to 300 characters.' },
      values: { note: '' },
    });
    render(<RefundSteps refundId={REFUND} status="requested" csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel refund' }));
    expect(await screen.findByText('Give a reason of 5 to 300 characters.')).toBeTruthy();
    await waitFor(() => expect(actions.cancelRefund).toHaveBeenCalledTimes(1));
  });

  it('says a closed refund takes nothing more', () => {
    render(<RefundSteps refundId={REFUND} status="completed" csrf={csrf} />);
    expect(screen.getByText(/This refund is closed/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RefundRequestForm', () => {
  it('marks every field that is wrong at once and shows the success message', async () => {
    actions.requestRefund.mockResolvedValue({
      status: 'error',
      message: 'Check the highlighted fields',
      fieldErrors: { orderNumber: 'Enter the order number, e.g. NZ100001.', amount: 'Enter the amount to refund in taka.' },
    });
    render(<RefundRequestForm csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request refund' }));
    expect(await screen.findByText('Enter the order number, e.g. NZ100001.')).toBeTruthy();
    expect(screen.getByText('Enter the amount to refund in taka.')).toBeTruthy();
  });
});
