import {
  adminOrderCouponSchema,
  type AdminOrderCoupon,
  orderItemOptionSchema,
  type OrderItemOption,
  type OrderPreviewItem,
  orderInternalResponseSchema,
  type OrderInternalResponse,
  adminOrderDetailSchema,
  adminOrderSummarySchema,
  type adminOrderListQuerySchema,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type DeliveryZone,
  type OrderStatus,
  type PaymentStatus,
  shipmentStatusSchema,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, isoTimestamps, StoreUnavailableError } from '../commerce/errors';
import { pictureFromKey } from '../media/images';
import { toAdminStoreError } from './errors';
import { RANGE_NOT_SATISFIABLE, sqlNull, untypedRpc, type Page } from './shared';

/** How the list is ordered (the contract's ADMIN_ORDER_SORTS, not exported by its index). */
export type AdminOrderSort = NonNullable<z.output<typeof adminOrderListQuerySchema>['sort']>;

/** An order as staff see it, before the caller-specific actions are added. */
export type AdminOrderRecord = Omit<AdminOrderDetail, 'allowedStatuses' | 'canRecordCollection'>;

export type OrderSearch =
  | { kind: 'order_number'; prefix: string }
  | { kind: 'phone'; digits: string }
  | { kind: 'recipient'; term: string };

export interface AdminOrderFilters {
  status?: OrderStatus | undefined;
  paymentStatus?: PaymentStatus | undefined;
  search?: OrderSearch | undefined;
  /** Inclusive lower bound of placed_at (ISO timestamp). */
  placedFrom?: string | undefined;
  /** Exclusive upper bound of placed_at (ISO timestamp). */
  placedBefore?: string | undefined;
  /** Only this customer's orders. */
  customerId?: string | undefined;
  /** True: archived (test) orders only. False or absent: archived orders are left out. */
  archived?: boolean | undefined;
  /** Archived or not, both (the bulk read of selected orders). Wins over `archived`. */
  includeArchived?: boolean | undefined;
  deliveryZone?: DeliveryZone | undefined;
  /** Only these order numbers (the bulk read of selected orders). */
  orderNumbers?: readonly string[] | undefined;
  /** Newest first by default. */
  sort?: AdminOrderSort | undefined;
}

/** How each sort orders the rows (always ending with the id, so pages never overlap). */
const SORT_SQL: Readonly<Record<AdminOrderSort, string>> = {
  newest: 'o.placed_at desc, o.id desc',
  oldest: 'o.placed_at asc, o.id asc',
  total_high: 'o.total_minor desc, o.placed_at desc, o.id desc',
  total_low: 'o.total_minor asc, o.placed_at desc, o.id desc',
};
const SORT_COLUMNS: Readonly<
  Record<AdminOrderSort, readonly { column: string; ascending: boolean }[]>
> = {
  newest: [
    { column: 'placed_at', ascending: false },
    { column: 'id', ascending: false },
  ],
  oldest: [
    { column: 'placed_at', ascending: true },
    { column: 'id', ascending: true },
  ],
  total_high: [
    { column: 'total_minor', ascending: false },
    { column: 'placed_at', ascending: false },
    { column: 'id', ascending: false },
  ],
  total_low: [
    { column: 'total_minor', ascending: true },
    { column: 'placed_at', ascending: false },
    { column: 'id', ascending: false },
  ],
};

/** admin_order_shipment_states: each listed order's latest delivery parcel. */
const shipmentStatesSchema = z.array(
  z.object({
    orderNumber: z.string(),
    shipmentId: z.uuid(),
    status: shipmentStatusSchema,
    provider: z.string(),
    providerName: z.string(),
    trackingCode: z.string().nullable(),
    bookingUncertain: z.boolean(),
    isMock: z.boolean(),
  }),
);

/**
 * Adds each order's parcel to a page of the list. One call per page. The parcel column is
 * an extra: when it cannot be read the list is still answered, without parcels, and the
 * failure is logged by its code only.
 */
async function withShipments(
  orders: AdminOrderSummary[],
  read: (orderNumbers: string[]) => Promise<unknown>,
  logger: AdminOrderStoreOptions['logger'],
): Promise<AdminOrderSummary[]> {
  if (orders.length === 0) return orders;
  try {
    const states = shipmentStatesSchema.parse(
      isoTimestamps(await read(orders.map((order) => order.orderNumber))),
    );
    const byOrder = new Map(states.map(({ orderNumber, ...state }) => [orderNumber, state]));
    return orders.map((order) => ({ ...order, shipment: byOrder.get(order.orderNumber) ?? null }));
  } catch (error) {
    const fields = error as { code?: unknown } | null;
    logger?.warn(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        code: typeof fields?.code === 'string' ? fields.code : undefined,
      },
      'Order parcels could not be read; the list is shown without them',
    );
    return orders.map((order) => ({ ...order, shipment: null }));
  }
}

/**
 * Every customer's orders, as the signed-in caller: reads under Row Level Security
 * (orders.read sees all orders), changes through the database functions that check
 * the caller's own permission, lock the order and write its history and audit entry.
 */
export interface AdminOrderStore {
  /** Newest first. */
  listOrders(
    accessToken: string,
    userId: string,
    filters: AdminOrderFilters,
    page: Page,
  ): Promise<{ orders: AdminOrderSummary[]; total: number }>;
  getOrder(
    accessToken: string,
    userId: string,
    orderNumber: string,
  ): Promise<AdminOrderRecord | null>;
  /** One fulfilment step or a cancellation (which returns the stock). */
  updateStatus(
    accessToken: string,
    userId: string,
    orderNumber: string,
    status: OrderStatus,
    note: string | undefined,
  ): Promise<void>;
  recordCollection(accessToken: string, userId: string, orderNumber: string): Promise<void>;
  /** Staff-only notes and the archive state of one order (null when it does not exist). */
  internal(
    accessToken: string,
    userId: string,
    orderNumber: string,
  ): Promise<OrderInternalResponse | null>;
  addNote(accessToken: string, userId: string, orderNumber: string, body: string): Promise<void>;
  setArchived(
    accessToken: string,
    userId: string,
    orderNumber: string,
    archive: boolean,
    reason: string | null,
  ): Promise<void>;
}

const SUMMARY_COLUMNS =
  'order_number, user_id, status, payment_method, payment_status, item_count, total_minor, discount_minor, placed_at, ship_recipient_name, ship_phone, delivery_zone';
/** A list row also carries its lines, so staff see what was bought without opening it. */
const LIST_COLUMNS = `${SUMMARY_COLUMNS}, order_items(product_name, variant_label, variant_options, quantity, image_key, image_alt)`;
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, currency, subtotal_minor, shipping_fee_minor, ship_division, ship_district, ship_area, ship_address_line, ship_postal_code, ship_landmark, customer_note, cancel_reason, cancelled_at, payment_collected_at, customer:profiles!orders_user_id_fkey(full_name, phone), order_items(id, product_id, variant_id, variant_label, variant_options, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor, image_key, image_alt, regular_price_minor, catalog_price_minor, campaign_id, campaign_title, campaign_discount_minor), order_status_history(from_status, to_status, actor_kind, note, created_at)`;

/** How many lines a list row previews (the item count still covers the whole order). */
const PREVIEW_LINES = 3;

export interface AdminOrderStoreOptions {
  /** Public base URL of the media bucket; without it an order line carries no picture. */
  mediaBaseUrl?: string | undefined;
  /** For the (non-fatal) parcel-column failure; ids and codes only. */
  logger?: Pick<Logger, 'warn'> | undefined;
}

interface PreviewRow {
  product_name: string;
  variant_label: string | null;
  variant_options?: unknown;
  quantity: number;
  image_key: string | null;
  image_alt: string | null;
}

interface SummaryRow {
  order_number: string;
  user_id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  item_count: number;
  total_minor: number | string;
  discount_minor: number | string;
  placed_at: string | Date;
  ship_recipient_name: string;
  ship_phone: string;
  delivery_zone: string;
}

interface ListRow extends SummaryRow {
  order_items: PreviewRow[] | null;
}

interface DetailRow extends SummaryRow {
  currency: string;
  subtotal_minor: number | string;
  shipping_fee_minor: number | string;
  ship_division: string;
  ship_district: string;
  ship_area: string;
  ship_address_line: string;
  ship_postal_code: string | null;
  ship_landmark: string | null;
  customer_note: string | null;
  cancel_reason: string | null;
  cancelled_at: string | Date | null;
  payment_collected_at: string | Date | null;
  /** Null when the caller may not see customer profiles. */
  customer: { full_name: string | null; phone: string | null } | null;
  order_items: {
    id: number | string;
    product_id: string;
    variant_id: string | null;
    variant_label: string | null;
    variant_options?: unknown;
    image_key: string | null;
    image_alt: string | null;
    product_name: string;
    product_slug: string;
    sku: string;
    unit_price_minor: number | string;
    quantity: number;
    line_total_minor: number | string;
    regular_price_minor: number | string | null;
    catalog_price_minor: number | string | null;
    campaign_id: string | null;
    campaign_title: string | null;
    campaign_discount_minor: number | string;
  }[];
  order_status_history: {
    from_status: string | null;
    to_status: string;
    actor_kind: string;
    note: string | null;
    created_at: string | Date;
  }[];
}

/** The options snapshot, kept only when it has the expected shape (never trusted blindly). */
function optionsOf(value: unknown): OrderItemOption[] {
  const parsed = z.array(orderItemOptionSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function previewOf(
  rows: readonly PreviewRow[] | null | undefined,
  mediaBaseUrl: string | undefined,
): OrderPreviewItem[] {
  return (rows ?? []).slice(0, PREVIEW_LINES).map((row) => ({
    productName: row.product_name,
    variantLabel: row.variant_label ?? null,
    variantOptions: optionsOf(row.variant_options),
    quantity: row.quantity,
    image: pictureFromKey(row.image_key, mediaBaseUrl, row.image_alt),
  }));
}

function toSummary(
  row: SummaryRow,
  preview: OrderPreviewItem[] = [],
  coupon: AdminOrderCoupon | null = null,
) {
  return {
    orderNumber: row.order_number,
    customerId: row.user_id,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    itemCount: row.item_count,
    totalMinor: Number(row.total_minor),
    discountMinor: Number(row.discount_minor),
    placedAt: isoTimestamp(row.placed_at),
    recipientName: row.ship_recipient_name,
    phone: row.ship_phone,
    deliveryZone: row.delivery_zone,
    preview,
    coupon,
  };
}

const couponsSchema = z.array(adminOrderCouponSchema.extend({ orderNumber: z.string() }));

/** The coupon of each order, by order number, from the database function's answer. */
function couponsByOrder(raw: unknown): Map<string, AdminOrderCoupon> {
  const map = new Map<string, AdminOrderCoupon>();
  for (const { orderNumber, ...coupon } of conform(
    couponsSchema,
    raw ?? [],
    'admin_order_coupons',
  )) {
    map.set(orderNumber, coupon);
  }
  return map;
}

/** Only an order with a discount can have a coupon: the others need no lookup. */
function discounted(rows: readonly SummaryRow[]): string[] {
  return rows.filter((row) => Number(row.discount_minor) > 0).map((row) => row.order_number);
}

const recordSchema = adminOrderDetailSchema.omit({
  allowedStatuses: true,
  canRecordCollection: true,
});
const summariesSchema = z.array(adminOrderSummarySchema);

function toRecord(
  row: DetailRow,
  mediaBaseUrl: string | undefined,
  coupon: AdminOrderCoupon | null,
) {
  const {
    customerId: _customerId,
    recipientName: _name,
    phone: _phone,
    ...summary
  } = toSummary(row, previewOf(row.order_items, mediaBaseUrl), coupon);
  return {
    ...summary,
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    shippingFeeMinor: Number(row.shipping_fee_minor),
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
      variantId: item.variant_id ?? null,
      variantLabel: item.variant_label ?? null,
      variantOptions: optionsOf(item.variant_options),
      image: pictureFromKey(item.image_key, mediaBaseUrl, item.image_alt),
      productName: item.product_name,
      productSlug: item.product_slug,
      sku: item.sku,
      unitPriceMinor: Number(item.unit_price_minor),
      quantity: item.quantity,
      lineTotalMinor: Number(item.line_total_minor),
      regularPriceMinor:
        item.regular_price_minor === null ? null : Number(item.regular_price_minor),
      catalogPriceMinor:
        item.catalog_price_minor === null ? null : Number(item.catalog_price_minor),
      campaignId: item.campaign_id,
      campaignTitle: item.campaign_title,
      campaignDiscountMinor: Number(item.campaign_discount_minor ?? 0),
    })),
    customer: {
      id: row.user_id,
      fullName: row.customer?.full_name ?? null,
      phone: row.customer?.phone ?? null,
    },
    history: row.order_status_history.map((event) => ({
      fromStatus: event.from_status,
      toStatus: event.to_status,
      actorKind: event.actor_kind,
      note: event.note,
      at: isoTimestamp(event.created_at),
    })),
    paymentCollectedAt:
      row.payment_collected_at === null ? null : isoTimestamp(row.payment_collected_at),
  };
}

export function createSupabaseAdminOrderStore(
  clients: SupabaseClients,
  { mediaBaseUrl, logger }: AdminOrderStoreOptions = {},
): AdminOrderStore {
  async function couponsOf(accessToken: string, orderNumbers: string[]) {
    if (orderNumbers.length === 0) return new Map<string, AdminOrderCoupon>();
    const { data, error } = await clients
      .asUser(accessToken)
      .rpc('admin_order_coupons', { p_order_numbers: orderNumbers });
    if (error) throw toAdminStoreError(error, 'admin_order_coupons');
    return couponsByOrder(data);
  }

  return {
    async listOrders(accessToken, _userId, filters, { limit, offset }) {
      const client = clients.asUser(accessToken);
      const build = (columns: string, head: boolean) => {
        let query = client.from('orders').select(columns, { count: 'exact', head });
        if (filters.status) query = query.eq('status', filters.status);
        if (filters.paymentStatus) query = query.eq('payment_status', filters.paymentStatus);
        if (filters.customerId) query = query.eq('user_id', filters.customerId);
        if (filters.deliveryZone) query = query.eq('delivery_zone', filters.deliveryZone);
        if (filters.orderNumbers) query = query.in('order_number', [...filters.orderNumbers]);
        if (!filters.includeArchived) {
          query = filters.archived
            ? query.not('archived_at', 'is', null)
            : query.is('archived_at', null);
        }
        if (filters.placedFrom) query = query.gte('placed_at', filters.placedFrom);
        if (filters.placedBefore) query = query.lt('placed_at', filters.placedBefore);
        const search = filters.search;
        if (search?.kind === 'order_number') {
          query = query.like('order_number', `${search.prefix}*`);
        } else if (search?.kind === 'phone') {
          query = query.like('ship_phone', `*${search.digits}*`);
        } else if (search?.kind === 'recipient') {
          query = query.ilike('ship_recipient_name', `*${search.term}*`);
        }
        return query;
      };

      let ordered = build(LIST_COLUMNS, false);
      for (const { column, ascending } of SORT_COLUMNS[filters.sort ?? 'newest']) {
        ordered = ordered.order(column, { ascending });
      }
      const { data, error, count } = await ordered
        .order('id', { referencedTable: 'order_items' })
        .range(offset, offset + limit - 1)
        .overrideTypes<ListRow[], { merge: false }>();
      if (error?.code === RANGE_NOT_SATISFIABLE) {
        const counted = await build('id', true);
        if (counted.error) throw toAdminStoreError(counted.error, 'orders');
        return { orders: [], total: counted.count ?? 0 };
      }
      if (error) throw toAdminStoreError(error, 'orders');
      const coupons = await couponsOf(accessToken, discounted(data));
      const summaries = conform(
        summariesSchema,
        data.map((row) =>
          toSummary(
            row,
            previewOf(row.order_items, mediaBaseUrl),
            coupons.get(row.order_number) ?? null,
          ),
        ),
        'orders',
      );
      const rpc = untypedRpc(client);
      return {
        orders: await withShipments(
          summaries,
          async (orderNumbers) => {
            const answer = await rpc('admin_order_shipment_states', {
              p_order_numbers: orderNumbers,
            });
            if (answer.error) throw toAdminStoreError(answer.error, 'admin_order_shipment_states');
            return answer.data;
          },
          logger,
        ),
        total: count ?? data.length,
      };
    },

    async getOrder(accessToken, _userId, orderNumber) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('orders')
        .select(DETAIL_COLUMNS)
        .eq('order_number', orderNumber)
        .order('id', { referencedTable: 'order_items' })
        .order('created_at', { referencedTable: 'order_status_history' })
        .order('id', { referencedTable: 'order_status_history' })
        .maybeSingle()
        .overrideTypes<DetailRow | null, { merge: false }>();
      if (error) throw toAdminStoreError(error, 'orders');
      if (!data) return null;
      const coupons = await couponsOf(accessToken, discounted([data]));
      return conform(
        recordSchema,
        toRecord(data, mediaBaseUrl, coupons.get(data.order_number) ?? null),
        'orders',
      );
    },

    async updateStatus(accessToken, _userId, orderNumber, status, note) {
      const { error } = await clients.asUser(accessToken).rpc('admin_update_order_status', {
        p_order_number: orderNumber,
        p_status: status,
        p_note: sqlNull(note),
      });
      if (error) throw toAdminStoreError(error, 'admin_update_order_status');
    },

    async recordCollection(accessToken, _userId, orderNumber) {
      const { error } = await clients
        .asUser(accessToken)
        .rpc('admin_record_cod_collection', { p_order_number: orderNumber });
      if (error) throw toAdminStoreError(error, 'admin_record_cod_collection');
    },

    async internal(accessToken, _userId, orderNumber) {
      const client = clients.asUser(accessToken);
      const notes = await client.rpc('admin_order_notes', { p_order_number: orderNumber });
      if (notes.error) {
        if (notes.error.code === 'NZ404') return null;
        throw toAdminStoreError(notes.error, 'admin_order_notes');
      }
      const row = await client
        .from('orders')
        .select('archived_at, archive_reason')
        .eq('order_number', orderNumber)
        .maybeSingle();
      if (row.error) throw toAdminStoreError(row.error, 'orders');
      return internalOf(notes.data, row.data);
    },

    async addNote(accessToken, _userId, orderNumber, body) {
      const { error } = await clients
        .asUser(accessToken)
        .rpc('admin_add_order_note', { p_order_number: orderNumber, p_body: body });
      if (error) throw toAdminStoreError(error, 'admin_add_order_note');
    },

    async setArchived(accessToken, _userId, orderNumber, archive, reason) {
      const { error } = await clients.asUser(accessToken).rpc('admin_set_order_archived', {
        p_order_number: orderNumber,
        p_archive: archive,
        p_reason: sqlNull(reason),
      });
      if (error) throw toAdminStoreError(error, 'admin_set_order_archived');
    },
  };
}

/** Notes (jsonb, offset timestamps) and the archive columns, in the contract's shape. */
function internalOf(
  notes: unknown,
  row: { archived_at: string | Date | null; archive_reason: string | null } | null,
): OrderInternalResponse {
  return conform(
    orderInternalResponseSchema,
    {
      notes: isoTimestamps(notes ?? []),
      archive: row?.archived_at
        ? { archivedAt: isoTimestamp(row.archived_at), reason: row.archive_reason }
        : null,
    },
    'admin_order_notes',
  );
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23505`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

const SQL_SUMMARY = `o.order_number, o.user_id, o.status, o.payment_method, o.payment_status,
  o.item_count, o.total_minor, o.discount_minor, o.placed_at, o.ship_recipient_name, o.ship_phone,
  o.delivery_zone`;

const SQL_DETAIL = `${SQL_SUMMARY}, o.currency, o.subtotal_minor, o.shipping_fee_minor,
  o.ship_division, o.ship_district, o.ship_area, o.ship_address_line,
  o.ship_postal_code, o.ship_landmark, o.customer_note, o.cancel_reason, o.cancelled_at,
  o.payment_collected_at, p.full_name as customer_full_name, p.phone as customer_phone`;

/**
 * Every customer's orders over a direct PostgreSQL connection, read as the signed-in
 * caller: the `orders.read` RLS policy decides visibility and the `profiles` policy
 * decides whether the customer's name is visible, exactly as the embedded resource did.
 * Status changes still go through the permission-checking database functions.
 */
export function createPostgresAdminOrderStore(
  pool: Pool,
  { mediaBaseUrl, logger }: AdminOrderStoreOptions = {},
): AdminOrderStore {
  async function couponsOf(client: PoolClient, orderNumbers: string[]) {
    if (orderNumbers.length === 0) return new Map<string, AdminOrderCoupon>();
    const result = await client.query<{ coupons: unknown }>(
      'select public.admin_order_coupons($1::text[]) as coupons',
      [orderNumbers],
    );
    return couponsByOrder(result.rows[0]?.coupons);
  }

  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  return {
    async listOrders(_accessToken, userId, filters, { limit, offset }) {
      const where: string[] = [];
      const parameters: unknown[] = [];
      const add = (clause: (index: number) => string, value: unknown) => {
        parameters.push(value);
        where.push(clause(parameters.length));
      };

      if (filters.status) add((i) => `o.status = $${i}::public.order_status`, filters.status);
      if (filters.paymentStatus) {
        add((i) => `o.payment_status = $${i}::public.payment_status`, filters.paymentStatus);
      }
      if (filters.customerId) add((i) => `o.user_id = $${i}::uuid`, filters.customerId);
      if (filters.deliveryZone) {
        add((i) => `o.delivery_zone = $${i}::public.delivery_zone`, filters.deliveryZone);
      }
      if (filters.orderNumbers) {
        add((i) => `o.order_number = any ($${i}::text[])`, [...filters.orderNumbers]);
      }
      if (!filters.includeArchived) {
        where.push(filters.archived ? 'o.archived_at is not null' : 'o.archived_at is null');
      }
      if (filters.placedFrom) add((i) => `o.placed_at >= $${i}::timestamptz`, filters.placedFrom);
      if (filters.placedBefore)
        add((i) => `o.placed_at < $${i}::timestamptz`, filters.placedBefore);

      const search = filters.search;
      if (search?.kind === 'order_number')
        add((i) => `o.order_number like $${i} || '%'`, search.prefix);
      else if (search?.kind === 'phone') {
        add((i) => `o.ship_phone like '%' || $${i} || '%'`, search.digits);
      } else if (search?.kind === 'recipient') {
        add((i) => `o.ship_recipient_name ilike '%' || $${i} || '%'`, search.term);
      }

      const condition = where.length === 0 ? '' : `where ${where.join(' and ')}`;
      parameters.push(limit, offset);
      const limitIndex = parameters.length - 1;
      const offsetIndex = parameters.length;

      let listed: { orders: AdminOrderSummary[]; total: number };
      try {
        listed = await withUser(pool, userId, async (client) => {
          const page = await client.query<SummaryRow & { id: string; total: string }>(
            `select ${SQL_SUMMARY}, o.id, count(*) over () as total
               from public.orders o
               ${condition}
              order by ${SORT_SQL[filters.sort ?? 'newest']}
              limit $${limitIndex} offset $${offsetIndex}`,
            parameters,
          );
          const first = page.rows[0];
          if (first) {
            // One query for every line of the page, never one per order.
            const lines = await client.query<PreviewRow & { order_id: string }>(
              `select order_id, product_name, variant_label, variant_options, quantity, image_key, image_alt
                 from public.order_items
                where order_id = any ($1::uuid[])
                order by order_id, id`,
              [page.rows.map((row) => row.id)],
            );
            const byOrder = new Map<string, PreviewRow[]>();
            for (const line of lines.rows) {
              const list = byOrder.get(line.order_id) ?? [];
              list.push(line);
              byOrder.set(line.order_id, list);
            }
            const coupons = await couponsOf(client, discounted(page.rows));
            return {
              orders: conform(
                summariesSchema,
                page.rows.map((row) =>
                  toSummary(
                    row,
                    previewOf(byOrder.get(row.id), mediaBaseUrl),
                    coupons.get(row.order_number) ?? null,
                  ),
                ),
                'orders',
              ),
              total: Number(first.total),
            };
          }
          // A page past the end is empty, but the total still comes from a count.
          const counted = await client.query<{ total: string }>(
            `select count(*) as total from public.orders o ${condition}`,
            parameters.slice(0, limitIndex - 1),
          );
          return { orders: [], total: Number(counted.rows[0]?.total ?? 0) };
        });
      } catch (error) {
        throw failure(error, 'orders');
      }
      // Its own transaction: a failed parcel read must not abort the list's.
      return {
        orders: await withShipments(
          listed.orders,
          (orderNumbers) =>
            withUser(pool, userId, async (client) => {
              const result = await client.query<{ states: unknown }>(
                'select public.admin_order_shipment_states($1::text[]) as states',
                [orderNumbers],
              );
              return result.rows[0]?.states;
            }),
          logger,
        ),
        total: listed.total,
      };
    },

    async getOrder(_accessToken, userId, orderNumber) {
      try {
        return await withUser(pool, userId, async (client) => {
          const orders = await client.query<
            DetailRow & {
              id: string;
              customer_full_name: string | null;
              customer_phone: string | null;
            }
          >(
            `select ${SQL_DETAIL}, o.id
               from public.orders o
               left join public.profiles p on p.id = o.user_id
              where o.order_number = $1`,
            [orderNumber],
          );
          const row = orders.rows[0];
          if (!row) return null;

          const items = await client.query<DetailRow['order_items'][number]>(
            `select id, product_id, variant_id, variant_label, variant_options, product_name, product_slug, sku,
                    unit_price_minor, quantity, line_total_minor, image_key, image_alt,
                    regular_price_minor, catalog_price_minor, campaign_id,
                    campaign_title, campaign_discount_minor
               from public.order_items
              where order_id = $1
              order by id`,
            [row.id],
          );
          const history = await client.query<DetailRow['order_status_history'][number]>(
            `select from_status, to_status, actor_kind, note, created_at
               from public.order_status_history
              where order_id = $1
              order by created_at, id`,
            [row.id],
          );
          const coupons = await couponsOf(client, discounted([row]));
          return conform(
            recordSchema,
            toRecord(
              {
                ...row,
                customer:
                  row.customer_full_name === null && row.customer_phone === null
                    ? null
                    : { full_name: row.customer_full_name, phone: row.customer_phone },
                order_items: items.rows,
                order_status_history: history.rows,
              },
              mediaBaseUrl,
              coupons.get(row.order_number) ?? null,
            ),
            'orders',
          );
        });
      } catch (error) {
        throw failure(error, 'orders');
      }
    },

    async updateStatus(_accessToken, userId, orderNumber, status, note) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            'select public.admin_update_order_status($1, $2::public.order_status, $3)',
            [orderNumber, status, note ?? null],
          );
        });
      } catch (error) {
        throw failure(error, 'admin_update_order_status');
      }
    },

    async recordCollection(_accessToken, userId, orderNumber) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_record_cod_collection($1)', [orderNumber]);
        });
      } catch (error) {
        throw failure(error, 'admin_record_cod_collection');
      }
    },

    async internal(_accessToken, userId, orderNumber) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{
            notes: unknown;
            archived_at: string | Date | null;
            archive_reason: string | null;
          }>(
            'select public.admin_order_notes($1) as notes, o.archived_at, o.archive_reason from public.orders o where o.order_number = $1',
            [orderNumber],
          );
          const row = result.rows[0];
          return row ? internalOf(row.notes, row) : null;
        });
      } catch (error) {
        if (pgFailure(error).code === 'NZ404') return null;
        throw failure(error, 'admin_order_notes');
      }
    },

    async addNote(_accessToken, userId, orderNumber, body) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_add_order_note($1, $2)', [orderNumber, body]);
        });
      } catch (error) {
        throw failure(error, 'admin_add_order_note');
      }
    },

    async setArchived(_accessToken, userId, orderNumber, archive, reason) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_set_order_archived($1, $2, $3)', [
            orderNumber,
            archive,
            reason,
          ]);
        });
      } catch (error) {
        throw failure(error, 'admin_set_order_archived');
      }
    },
  };
}
