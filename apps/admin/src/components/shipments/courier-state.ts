import type { BookingOutcome, CourierCompareResponse } from '@nilzora/contracts';
import type { ActionState } from '@/components/admin-kit/act';

/*
 * What the courier Server Actions hand back to their forms, beyond the admin kit's
 * message: the comparison to choose from, and a booking's outcome. Type-only, so client
 * forms can import it without pulling server code.
 */

export interface CompareState extends ActionState {
  comparison?: CourierCompareResponse;
  /**
   * A fresh booking key for the booking form this comparison opens. Created once on the
   * server per comparison, so the form renders the same key on the server and in the
   * browser, and every retry of that form sends it again.
   */
  bookingKey?: string;
}

export interface BookingState extends ActionState {
  outcome?: BookingOutcome;
  shipmentId?: string;
  courier?: string;
  consignmentId?: string | null;
  /** Whether the key had been used before (a retry or a double click). */
  duplicate?: boolean;
  /** The bookingKey this answer belongs to. */
  bookingKey?: string;
}
