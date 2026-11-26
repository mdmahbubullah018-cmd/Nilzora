import { StoreUnavailableError, type DatabaseFailure } from '../commerce/errors';

/** Refusals raised by the device functions (see the device_tokens migration). */
export type DeviceRefusal = 'account_suspended' | 'invalid_input';

export class DeviceRefusalError extends Error {
  override readonly name = 'DeviceRefusalError';
  readonly refusal: DeviceRefusal;

  constructor(refusal: DeviceRefusal) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
  }
}

const SQLSTATES: Readonly<Record<string, DeviceRefusal>> = {
  NZ403: 'account_suspended',
  NZ412: 'invalid_input',
};

/**
 * Turns a failed device call into a refusal the routes answer with a stable code, or
 * StoreUnavailableError (a 503) for anything unexpected. Database messages never reach
 * clients. Unlike the other stores the original failure is NOT kept as the cause: its
 * DETAIL can quote the failing row, and that row holds the push token. The error log
 * does not serialize causes today; dropping the text keeps the token out of any log
 * even if that changes. Only the SQLSTATE is kept.
 */
export function toDeviceStoreError(failure: DatabaseFailure, operation: string): Error {
  const refusal = SQLSTATES[failure.code];
  if (refusal) return new DeviceRefusalError(refusal);
  const code = failure.code || 'network';
  return new StoreUnavailableError(`${operation} failed (${code})`, {
    cause: new Error(`database error ${code}`),
  });
}
