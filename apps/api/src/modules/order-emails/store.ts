import type { OrderDetail } from '@nilzora/contracts';
import type { Pool } from 'pg';
import { withServiceRole } from '../../db/user-context';
import type { RefundFacts, ReturnFacts, ShipmentFacts } from './templates';

/*
 * The order email worker's view of the database, over the direct connection.
 *
 *  - The outbox itself (claim_customer_emails / finish_customer_email) and the recipient's
 *    address are service-role reads: the table is closed to every other role.
 *  - The order is read through the ordinary order store, *as the customer*: the same
 *    row-level security that guards the order page decides what an email may contain, so an
 *    email can only ever describe an order of the account it is addressed to.
 *  - Shipment, return and refund facts are service-role reads that are always narrowed to the
 *    order the outbox row names, which the trigger took from that account's order.
 */

export type EmailKind =
  'order_confirmation' | 'out_for_delivery' | 'return_update' | 'refund_update';

export interface ClaimedEmail {
  id: string;
  kind: EmailKind;
  userId: string;
  orderId: string;
  orderNumber: string;
  shipmentId: string | null;
  returnRequestId: string | null;
  refundId: string | null;
  eventStatus: string | null;
  /** Includes this attempt: 1 on the first try. */
  attempts: number;
}

export interface EmailRecipient {
  email: string;
  name: string | null;
  verified: boolean;
  active: boolean;
}

export type EmailOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

export interface OrderEmailStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedEmail[]>;
  finish(
    id: string,
    outcome: EmailOutcome,
    options?: { retrySeconds?: number; errorCode?: string },
  ): Promise<void>;
  recipient(userId: string): Promise<EmailRecipient | null>;
  order(userId: string, orderNumber: string): Promise<OrderDetail | null>;
  shipment(
    shipmentId: string,
    orderId: string,
  ): Promise<(ShipmentFacts & { status: string }) | null>;
  returnRequest(returnId: string, orderId: string): Promise<ReturnFacts | null>;
  refund(
    refundId: string,
    orderId: string,
  ): Promise<(Omit<RefundFacts, 'status'> & { status: string }) | null>;
}

/** The outbox is not in this database yet (its migration has not been applied there). */
export class OutboxMissingError extends Error {
  override readonly name = 'OutboxMissingError';
}

/** undefined_function / undefined_table: the migration that creates the outbox is absent. */
function missing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42883' || code === '42P01';
}

interface ClaimRow {
  id: string;
  kind: EmailKind;
  user_id: string;
  order_id: string;
  order_number: string;
  shipment_id: string | null;
  return_request_id: string | null;
  refund_id: string | null;
  event_status: string | null;
  attempts: number;
}

/**
 * `readOrder` must read as the customer (the Postgres order store's `get`, which runs under
 * `withUser`), never as the service role.
 */
export function createPostgresOrderEmailStore(
  pool: Pool,
  readOrder: (userId: string, orderNumber: string) => Promise<OrderDetail | null>,
): OrderEmailStore {
  return {
    async claim(limit, leaseSeconds) {
      try {
        return await withServiceRole(pool, async (client) => {
          const result = await client.query<ClaimRow>(
            'select * from public.claim_customer_emails($1::integer, $2::integer)',
            [limit, leaseSeconds],
          );
          return result.rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            userId: row.user_id,
            orderId: row.order_id,
            orderNumber: row.order_number,
            shipmentId: row.shipment_id,
            returnRequestId: row.return_request_id,
            refundId: row.refund_id,
            eventStatus: row.event_status,
            attempts: row.attempts,
          }));
        });
      } catch (error) {
        if (missing(error)) throw new OutboxMissingError('email outbox is not installed');
        throw error;
      }
    },

    async finish(id, outcome, options = {}) {
      await withServiceRole(pool, async (client) => {
        await client.query('select public.finish_customer_email($1::uuid, $2, $3, $4)', [
          id,
          outcome,
          options.retrySeconds ?? null,
          options.errorCode ?? null,
        ]);
      });
    },

    async recipient(userId) {
      return withServiceRole(pool, async (client) => {
        const result = await client.query<{
          email: string | null;
          full_name: string | null;
          email_verified_at: Date | null;
          status: string;
        }>(
          'select email, full_name, email_verified_at, status from public.profiles where id = $1',
          [userId],
        );
        const row = result.rows[0];
        if (!row?.email) return null;
        return {
          email: row.email,
          name: row.full_name,
          verified: row.email_verified_at !== null,
          active: row.status === 'active',
        };
      });
    },

    async order(userId, orderNumber) {
      return readOrder(userId, orderNumber);
    },

    async shipment(shipmentId, orderId) {
      return withServiceRole(pool, async (client) => {
        const result = await client.query<{
          status: string;
          display_name: string;
          tracking_code: string | null;
          tracking_url: string | null;
          cod_amount_minor: string | number;
        }>(
          `select s.status::text as status, c.display_name, s.tracking_code, s.tracking_url,
                  s.cod_amount_minor
             from public.shipments s
             join public.courier_accounts c on c.provider = s.provider
            where s.id = $1 and s.order_id = $2 and s.kind = 'forward' and not s.is_mock`,
          [shipmentId, orderId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
          status: row.status,
          courier: row.display_name,
          trackingCode: row.tracking_code,
          trackingUrl: row.tracking_url,
          codAmountMinor: Number(row.cod_amount_minor),
        };
      });
    },

    async returnRequest(returnId, orderId) {
      return withServiceRole(pool, async (client) => {
        const head = await client.query<{
          status: ReturnFacts['status'];
          reason: string;
          decision_note: string | null;
        }>(
          `select status::text as status, reason, decision_note
             from public.return_requests where id = $1 and order_id = $2`,
          [returnId, orderId],
        );
        const row = head.rows[0];
        if (!row) return null;
        const items = await client.query<{
          product_name: string;
          variant_label: string | null;
          quantity: number;
        }>(
          `select oi.product_name, oi.variant_label, ri.quantity
             from public.return_items ri
             join public.order_items oi on oi.id = ri.order_item_id
            where ri.return_request_id = $1
            order by ri.id`,
          [returnId],
        );
        return {
          status: row.status,
          reason: row.reason,
          decisionNote: row.decision_note,
          items: items.rows.map((item) => ({
            productName: item.product_name,
            variantLabel: item.variant_label,
            quantity: item.quantity,
          })),
        };
      });
    },

    async refund(refundId, orderId) {
      return withServiceRole(pool, async (client) => {
        const result = await client.query<{
          status: string;
          amount_minor: string | number;
          method: RefundFacts['method'];
        }>(
          `select status::text as status, amount_minor, method::text as method
             from public.refunds where id = $1 and order_id = $2`,
          [refundId, orderId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return { status: row.status, amountMinor: Number(row.amount_minor), method: row.method };
      });
    },
  };
}
