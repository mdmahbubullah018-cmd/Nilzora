import type { ApiErrorCode } from '@nilzora/contracts';

/**
 * A refusal decided by the API itself (not the database): couriers switched off, an
 * operation the courier's adapter cannot do, a courier that did not answer. The message is
 * fixed, safe text for staff.
 */
export class CourierRefusalError extends Error {
  override readonly name = 'CourierRefusalError';
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function couriersOff(): CourierRefusalError {
  return new CourierRefusalError(
    503,
    'courier_unavailable',
    'Couriers are switched off on this server',
  );
}
