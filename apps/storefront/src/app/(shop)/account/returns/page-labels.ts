/** What each stage of a return means to the customer, in words rather than a status word. */
const STATUS_LABELS: Record<string, string> = {
  requested: 'Waiting for Nilzora to review it',
  approved: 'Approved — send the items back',
  rejected: 'Not accepted',
  received: 'Nilzora has your items',
  completed: 'Done',
  cancelled: 'Cancelled',
};

/** Refund stages, kept separate because they mean something different to the customer. */
const REFUND_LABELS: Record<string, string> = {
  requested: 'Waiting for approval',
  approved: 'Approved — the money has not been handed back yet',
  completed: 'Paid back',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};

export function returnStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? REFUND_LABELS[status] ?? status;
}

export function refundStatusLabel(status: string): string {
  return REFUND_LABELS[status] ?? status;
}
