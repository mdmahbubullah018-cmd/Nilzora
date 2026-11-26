import {
  orderDetailSchema,
  orderNumberSchema,
  orderSummarySchema,
  type OrderDetail,
  type OrderPreviewItem,
  type OrderSummary,
  type placeOrderRequestSchema,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import {
  conform,
  isoTimestamp,
  OrderReadBackError,
  StoreUnavailableError,
  toStoreError,
} from '../commerce/errors';
import { pictureFromKey } from '../media/images';

/** A validated POST /orders body. */
export type PlaceOrderInput = z.output<typeof placeOrderRequestSchema>;

export interface PlacedOrder {
  order: OrderDetail;
  /** False when the idempotency key had already placed this order (a replay). */
  created: boolean;
}

export interface OrderPage {
  orders: OrderSummary[];
  total: number;
}

/**
 * The caller's own Cash-on-Delivery orders. Placement and cancellation run as
 * database functions in one transaction each (pricing, stock, ledger, history);
 * reads run as the user under RLS, so another account's order is simply not found.
 */
export interface OrderStore {
  place(accessToken: string, userId: string, input: PlaceOrderInput): Promise<PlacedOrder>;
  /** Newest first. */
  list(
    accessToken: string,
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<OrderPage>;
  get(accessToken: string, userId: string, orderNumber: string): Promise<OrderDetail | null>;
  cancel(
    accessToken: string,
    userId: string,
    orderNumber: string,
    reason: string | undefined,
  ): Promise<OrderDetail>;
}

/*
 * Explicit columns only: customers may read neither idempotency_key nor
 * request_fingerprint, so a `*` select would be refused. The same field list is used by the
 * PostgREST select and by the direct PostgreSQL query, so both stores answer identically.
 */
const SUMMARY_FIELDS =
  'order_number, status, payment_method, payment_status, item_count, total_minor, placed_at';
/** A list needs a taste of what was bought; the order's own `item_count` still counts it all. */
const PREVIEW_FIELDS = `${SUMMARY_FIELDS}, order_items(product_name, variant_label, quantity, image_key, image_alt)`;
const DETAIL_COLUMNS = `${SUMMARY_FIELDS}, currency, subtotal_minor, shipping_fee_minor, discount_minor, delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line, ship_postal_code, ship_landmark, customer_note, cancel_reason, cancelled_at, order_items(id, product_id, variant_id, variant_label, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor, image_key, image_alt, regular_price_minor, catalog_price_minor, campaign_id, campaign_title, campaign_discount_minor), order_status_history(from_status, to_status, created_at)`;

/** How many lines an order list shows before it stops (the rest live in the order). */
const PREVIEW_LINES = 3;

export interface OrderStoreOptions {
  /** Public base URL of the media bucket; without it an order line carries no picture. */
  mediaBaseUrl?: string | undefined;
}

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/**
 * Reads of an order a database function just committed. The first try is immediate; the
 * second and third wait, so a connection pool still warming up or a write that is visible
 * a moment later does not turn a placed order into an error.
 */
const READ_BACK_DELAYS_MS = [0, 120, 350];

const placedSchema = z.object({ orderNumber: orderNumberSchema, created: z.boolean() });
const summariesSchema = z.array(orderSummarySchema);

/** PostgreSQL returns bigint columns as strings, and timestamps as Dates. */
interface PreviewRow {
  product_name: string;
  variant_label: string | null;
  quantity: number;
  image_key: string | null;
  image_alt: string | null;
}

interface SummaryRow {
  order_number: string;
  status: string;
  payment_method: string;
  payment_status: string;
  item_count: number;
  total_minor: number | string;
  placed_at: string | Date;
  /** The embedded lines a list shows; the detail select carries its own, longer list. */
  order_items?: PreviewRow[] | null;
}

/** The first few lines of an order, with their picture resolved from the stored key. */
function previewOf(
  rows: readonly PreviewRow[] | null | undefined,
  mediaBaseUrl: string | undefined,
): OrderPreviewItem[] {
  return (rows ?? []).slice(0, PREVIEW_LINES).map((row) => ({
    productName: row.product_name,
    // A row that carries no variant column at all sold no variant: null, never undefined.
    variantLabel: row.variant_label ?? null,
    quantity: row.quantity,
    image: pictureFromKey(row.image_key, mediaBaseUrl, row.image_alt),
  }));
}

function toSummary(row: SummaryRow, mediaBaseUrl: string | undefined) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    itemCount: row.item_count,
    totalMinor: Number(row.total_minor),
    placedAt: isoTimestamp(row.placed_at),
    preview: previewOf(row.order_items, mediaBaseUrl),
  };
}

interface DetailRow extends SummaryRow {
  currency: string;
  subtotal_minor: number | string;
  shipping_fee_minor: number | string;
  discount_minor: number | string;
  delivery_zone: string;
  ship_recipient_name: string;
  ship_phone: string;
  ship_division: string;
  ship_district: string;
  ship_area: string;
  ship_address_line: string;
  ship_postal_code: string | null;
  ship_landmark: string | null;
  customer_note: string | null;
  cancel_reason: string | null;
  cancelled_at: string | Date | null;
  order_items: {
    id: number | string;
    product_id: string;
    variant_id: string | null;
    variant_label: string | null;
    product_name: string;
    product_slug: string;
    sku: string;
    unit_price_minor: number | string;
    quantity: number;
    line_total_minor: number | string;
    image_key: string | null;
    image_alt: string | null;
    regular_price_minor: number | string | null;
    catalog_price_minor: number | string | null;
    campaign_id: string | null;
    campaign_title: string | null;
    campaign_discount_minor: number | string;
  }[];
  order_status_history: {
    from_status: string | null;
    to_status: string;
    created_at: string | Date;
  }[];
}

function toDetail(row: DetailRow, mediaBaseUrl: string | undefined): OrderDetail {
  return conform(
    orderDetailSchema,
    {
      ...toSummary(row, mediaBaseUrl),
      currency: row.currency,
      subtotalMinor: Number(row.subtotal_minor),
      shippingFeeMinor: Number(row.shipping_fee_minor),
      discountMinor: Number(row.discount_minor),
      deliveryZone: row.delivery_zone,
      shippingAddress: {
        recipientName: row.ship_recipient_name,
        phone: row.ship_phone,
        division: row.ship_division,
        district: row.ship_district,
        area: row.ship_area,
        addressLine: row.ship_address_line,
        postalCode: row.ship_postal_code,
        landmark: row.ship_landmark,
      },
      customerNote: row.customer_note,
      cancelReason: row.cancel_reason,
      cancelledAt: row.cancelled_at === null ? null : isoTimestamp(row.cancelled_at),
      items: row.order_items.map((item) => ({
        orderItemId: Number(item.id),
        productId: item.product_id,
        variantId: item.variant_id,
        variantLabel: item.variant_label,
        productName: item.product_name,
        productSlug: item.product_slug,
        sku: item.sku,
        unitPriceMinor: Number(item.unit_price_minor),
        quantity: item.quantity,
        lineTotalMinor: Number(item.line_total_minor),
        image: pictureFromKey(item.image_key, mediaBaseUrl, item.image_alt),
        regularPriceMinor:
          item.regular_price_minor === null ? null : Number(item.regular_price_minor),
        catalogPriceMinor:
          item.catalog_price_minor === null ? null : Number(item.catalog_price_minor),
        campaignId: item.campaign_id,
        campaignTitle: item.campaign_title,
        campaignDiscountMinor: Number(item.campaign_discount_minor ?? 0),
      })),
      history: row.order_status_history.map((event) => ({
        fromStatus: event.from_status,
        toStatus: event.to_status,
        at: isoTimestamp(event.created_at),
      })),
      canCancel: row.status === 'pending',
    },
    'orders',
  );
}

export function createSupabaseOrderStore(
  clients: SupabaseClients,
  { mediaBaseUrl }: OrderStoreOptions = {},
): OrderStore {
  async function get(accessToken: string, userId: string, orderNumber: string) {
    const { data, error } = await clients
      .asUser(accessToken)
      .from('orders')
      .select(DETAIL_COLUMNS)
      .eq('order_number', orderNumber)
      .eq('user_id', userId)
      .order('id', { referencedTable: 'order_items' })
      .order('created_at', { referencedTable: 'order_status_history' })
      .order('id', { referencedTable: 'order_status_history' })
      .maybeSingle();
    if (error) throw toStoreError(error, 'orders');
    return data ? toDetail(data, mediaBaseUrl) : null;
  }

  /**
   * The order a database function just committed, read back as the customer sees it.
   * A failed read is retried with a short backoff; after that the change is still saved,
   * so the error names the order (OrderReadBackError) instead of claiming nothing happened.
   */
  async function readBack(
    accessToken: string,
    userId: string,
    orderNumber: string,
    operation: string,
  ) {
    let failure: StoreUnavailableError | undefined;
    for (const delay of READ_BACK_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const order = await get(accessToken, userId, orderNumber);
        if (order) return order;
        failure = undefined;
      } catch (error) {
        if (!(error instanceof StoreUnavailableError)) throw error;
        failure = error;
      }
    }
    throw new OrderReadBackError(
      operation,
      orderNumber,
      failure === undefined ? undefined : { cause: failure },
    );
  }

  return {
    async place(accessToken, userId, input) {
      const { data, error } = await clients.asUser(accessToken).rpc('place_cod_order', {
        p_idempotency_key: input.idempotencyKey,
        p_address_id: input.addressId,
        p_items: input.items,
        p_expected_total_minor: input.expectedTotalMinor,
        ...(input.note === undefined ? {} : { p_note: input.note }),
        ...(input.couponCode === undefined ? {} : { p_coupon_code: input.couponCode }),
      });
      if (error) throw toStoreError(error, 'place_cod_order');
      const placed = conform(placedSchema, data, 'place_cod_order');
      return {
        order: await readBack(accessToken, userId, placed.orderNumber, 'place_cod_order'),
        created: placed.created,
      };
    },

    async list(accessToken, userId, { limit, offset }) {
      const { data, error, count } = await clients
        .asUser(accessToken)
        .from('orders')
        .select(PREVIEW_FIELDS, { count: 'exact' })
        .eq('user_id', userId)
        .order('placed_at', { ascending: false })
        .order('id', { ascending: false })
        .order('id', { referencedTable: 'order_items' })
        .range(offset, offset + limit - 1);

      if (error?.code === RANGE_NOT_SATISFIABLE) {
        // A page past the end is empty; the total still comes from a count.
        const counted = await clients
          .asUser(accessToken)
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (counted.error) throw toStoreError(counted.error, 'orders');
        return { orders: [], total: counted.count ?? 0 };
      }
      if (error) throw toStoreError(error, 'orders');
      return {
        orders: conform(
          summariesSchema,
          data.map((row) => toSummary(row, mediaBaseUrl)),
          'orders',
        ),
        total: count ?? data.length,
      };
    },

    get,

    async cancel(accessToken, userId, orderNumber, reason) {
      const { error } = await clients.asUser(accessToken).rpc('cancel_my_order', {
        p_order_number: orderNumber,
        ...(reason === undefined ? {} : { p_reason: reason }),
      });
      if (error) throw toStoreError(error, 'cancel_my_order');
      return readBack(accessToken, userId, orderNumber, 'cancel_my_order');
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

const DETAIL_SQL_COLUMNS = `${SUMMARY_FIELDS}, id, currency, subtotal_minor, shipping_fee_minor, discount_minor, delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line, ship_postal_code, ship_landmark, customer_note, cancel_reason, cancelled_at`;

/**
 * The customer's orders over a direct PostgreSQL connection.
 *
 * Placement and cancellation still run through the database functions
 * (`place_cod_order`, `cancel_my_order`), inside `withUser`, so pricing, stock, the
 * ledger, the status history and the idempotency rules are unchanged. Reads run as the
 * account under RLS, so another account's order is not found.
 *
 * The access token stays in the interface because the other stores still use it as
 * their RLS context; here the verified account id is enough and the token is never read.
 */
export function createPostgresOrderStore(
  pool: Pool,
  { mediaBaseUrl }: OrderStoreOptions = {},
): OrderStore {
  function failure(error: unknown): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toStoreError(pgFailure(error), 'orders');
  }

  async function get(userId: string, orderNumber: string): Promise<OrderDetail | null> {
    try {
      return await withUser(pool, userId, async (client) => {
        const orders = await client.query<DetailRow & { id: string }>(
          `select ${DETAIL_SQL_COLUMNS}
             from public.orders
            where order_number = $1 and user_id = $2`,
          [orderNumber, userId],
        );
        const row = orders.rows[0];
        if (!row) return null;

        const items = await client.query<DetailRow['order_items'][number]>(
          `select id, product_id, variant_id, variant_label, product_name, product_slug, sku, unit_price_minor, quantity,
                  line_total_minor, image_key, image_alt, regular_price_minor, catalog_price_minor,
                  campaign_id, campaign_title, campaign_discount_minor
             from public.order_items
            where order_id = $1
            order by id`,
          [row.id],
        );
        const history = await client.query<DetailRow['order_status_history'][number]>(
          `select from_status, to_status, created_at
             from public.order_status_history
            where order_id = $1
            order by created_at, id`,
          [row.id],
        );
        return toDetail(
          {
            ...row,
            order_items: items.rows,
            order_status_history: history.rows,
          },
          mediaBaseUrl,
        );
      });
    } catch (error) {
      throw failure(error);
    }
  }

  /** The order a database function just committed, read back the way the customer sees it. */
  async function readBack(userId: string, orderNumber: string, operation: string) {
    let failed: StoreUnavailableError | undefined;
    for (const delay of READ_BACK_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const order = await get(userId, orderNumber);
        if (order) return order;
        failed = undefined;
      } catch (error) {
        if (!(error instanceof StoreUnavailableError)) throw error;
        failed = error;
      }
    }
    throw new OrderReadBackError(
      operation,
      orderNumber,
      failed === undefined ? undefined : { cause: failed },
    );
  }

  return {
    async place(_accessToken, userId, input) {
      try {
        const placed = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ placed: unknown }>(
            // The coupon (or collected voucher) code travels with the order: the transaction
            // prices it again, so the reviewed total matches only when the same code is sent.
            `select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, $4, $5::bigint, $6::text) as placed`,
            [
              input.idempotencyKey,
              input.addressId,
              JSON.stringify(input.items),
              input.note ?? null,
              input.expectedTotalMinor ?? null,
              input.couponCode ?? null,
            ],
          );
          return conform(placedSchema, result.rows[0]?.placed, 'place_cod_order');
        });
        return {
          order: await readBack(userId, placed.orderNumber, 'place_cod_order'),
          created: placed.created,
        };
      } catch (error) {
        throw failure(error);
      }
    },

    async list(_accessToken, userId, { limit, offset }) {
      try {
        return await withUser(pool, userId, async (client) => {
          const page = await client.query<SummaryRow & { id: string; total: string }>(
            `select ${SUMMARY_FIELDS}, id, count(*) over () as total
               from public.orders
              where user_id = $1
              order by placed_at desc, id desc
              limit $2 offset $3`,
            [userId, limit, offset],
          );
          const first = page.rows[0];
          if (first) {
            // One extra query for the whole page, never one per order.
            const previews = await client.query<PreviewRow & { order_id: string }>(
              `select order_id, product_name, variant_label, quantity, image_key, image_alt
                 from public.order_items
                where order_id = any ($1::uuid[])
                order by order_id, id`,
              [page.rows.map((row) => row.id)],
            );
            const byOrder = new Map<string, PreviewRow[]>();
            for (const row of previews.rows) {
              const lines = byOrder.get(row.order_id) ?? [];
              lines.push(row);
              byOrder.set(row.order_id, lines);
            }
            return {
              orders: conform(
                summariesSchema,
                page.rows.map((row) =>
                  toSummary({ ...row, order_items: byOrder.get(row.id) ?? [] }, mediaBaseUrl),
                ),
                'orders',
              ),
              total: Number(first.total),
            };
          }
          // A page past the end is empty, but the total still comes from a count.
          const counted = await client.query<{ total: string }>(
            'select count(*) as total from public.orders where user_id = $1',
            [userId],
          );
          return { orders: [], total: Number(counted.rows[0]?.total ?? 0) };
        });
      } catch (error) {
        throw failure(error);
      }
    },

    get(_accessToken, userId, orderNumber) {
      return get(userId, orderNumber);
    },

    async cancel(_accessToken, userId, orderNumber, reason) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.cancel_my_order($1, $2)', [
            orderNumber,
            reason ?? null,
          ]);
        });
      } catch (error) {
        throw failure(error);
      }
      return readBack(userId, orderNumber, 'cancel_my_order');
    },
  };
}
