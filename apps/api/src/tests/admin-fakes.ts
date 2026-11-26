import { randomUUID } from 'node:crypto';
import {
  ANALYTICS_MAX_DAYS,
  DELIVERY_ZONES,
  LOW_STOCK_THRESHOLD,
  ORDER_TRANSITIONS,
  PERMISSIONS,
  RESERVED_BRAND_SLUGS,
  type AdminAttribute,
  type AdminCampaign,
  type AdminCampaignDetail,
  type AdminCategory,
  type CampaignCouponPolicy,
  type CampaignDiscountKind,
  type CampaignPreviewResponse,
  type CampaignScope,
  type CampaignState,
  type CampaignStatus,
  type AdminVariant,
  type AdminCoupon,
  type AnalyticsOverview,
  type AnalyticsTotals,
  type OrderGeography,
  type AdminReview,
  type AdminOrderSummary,
  type AdminProductDetail,
  type AdminProductSort,
  type AdminProductSummary,
  type AuditEntry,
  type CouponRedemption,
  type CouponSaveRequest,
  type CouponState,
  type DeliveryCharge,
  type DeliveryZone,
  type InventoryMovement,
  type InventoryReason,
  type ModerationContent,
  type ModerationEventKind,
  type ModerationStatus,
  type ModerationTaskStatus,
  type ModerationTaskSummary,
  type OrderStatus,
  type PaymentStatus,
  type Permission,
  type ProductStatus,
  type SalesOverview,
  type SizeChart,
  type StoreSettings,
  type SlugAvailabilityResponse,
} from '@nilzora/contracts';
import type { AdminAccountStore } from '../modules/admin/accounts-store';
import type { AdminCatalogStore, AdminProductFilters } from '../modules/admin/catalog-store';
import type { AdminCouponStore } from '../modules/admin/coupons-store';
import type { AdminDiscountStore } from '../modules/admin/discounts-store';
import type { MediaLibraryStore, StoredMediaAsset } from '../modules/admin/media-library-store';
import { ReviewRefusalError, type ReviewStore } from '../modules/reviews/store';
import { toAdminStoreError } from '../modules/admin/errors';
import { toStoreError } from '../modules/commerce/errors';
import type { ModerationStore, ModerationTaskRecord } from '../modules/admin/moderation-store';
import type {
  AdminOrderFilters,
  AdminOrderRecord,
  AdminOrderStore,
} from '../modules/admin/orders-store';
import type { AdminReportStore } from '../modules/admin/reports-store';
import type { AdminStores } from '../modules/admin/routes';
import type { Page } from '../modules/admin/shared';
import { FakeContent } from './content-fakes';
import { ROLE_PERMISSIONS } from './role-permissions';
import { FakeExports } from './export-fakes';
import type { FakeIdentity } from './fakes';

/*
 * In-memory stand-ins for the admin and moderation SQL functions and the staff RLS
 * policies, for unit tests of the admin routes. They check the CALLER's effective
 * permissions (from the token, as auth.uid() would) and refuse with the migration's
 * SQLSTATEs, passed through the same toAdminStoreError() mapping as the Supabase
 * stores. The real functions are covered by pgTAP and the integration tests.
 */

/** What a database error looks like, including text that must never reach clients. */
export const DB_MESSAGE = 'internal detail: relation private.permissions_of, host db.internal:5432';

function raise(code: string, details?: string): never {
  throw toAdminStoreError({ code, message: DB_MESSAGE, details: details ?? null }, 'fake');
}

/** Bangladesh has no daylight saving: Dhaka time is always UTC+6. */
const DHAKA_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

/** The Dhaka calendar day (YYYY-MM-DD) of an instant. */
function dhakaDay(instant: string | number): string {
  return new Date(new Date(instant).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

function sumOf(orders: readonly FakeAdminOrder[]): number {
  return orders.reduce((sum, order) => sum + order.totalMinor, 0);
}

/* The reference geography the database holds in public.bd_districts. The fake carries a
 * representative slice — every division and the districts the tests use — because the real
 * function reads all sixty-four from the table. */
const FAKE_DIVISIONS = [
  'Barishal',
  'Chattogram',
  'Dhaka',
  'Khulna',
  'Mymensingh',
  'Rajshahi',
  'Rangpur',
  'Sylhet',
] as const;

const FAKE_DISTRICTS = new Map<string, string>([
  ['Barishal', 'Barishal'],
  ['Chattogram', 'Chattogram'],
  ['Cumilla', 'Chattogram'],
  ["Cox's Bazar", 'Chattogram'],
  ['Feni', 'Chattogram'],
  ['Dhaka', 'Dhaka'],
  ['Gazipur', 'Dhaka'],
  ['Narayanganj', 'Dhaka'],
  ['Khulna', 'Khulna'],
  ['Jashore', 'Khulna'],
  ['Mymensingh', 'Mymensingh'],
  ['Rajshahi', 'Rajshahi'],
  ['Bogura', 'Rajshahi'],
  ['Rangpur', 'Rangpur'],
  ['Sylhet', 'Sylhet'],
]);

const FAKE_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const;

function countBy<K extends string>(keys: readonly K[]): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

/** analyticsTotals over one period's orders, as private.analytics_totals computes them. */
function fakeTotals(orders: readonly FakeAdminOrder[]): AnalyticsTotals {
  const sold = orders.filter((order) => order.status !== 'cancelled');
  const revenueMinor = sumOf(sold);
  return {
    orderCount: sold.length,
    cancelledCount: orders.length - sold.length,
    revenueMinor,
    averageOrderMinor: sold.length === 0 ? 0 : Math.round(revenueMinor / sold.length),
    // The fake identity keeps no sign-up dates.
    newCustomers: 0,
    collectedMinor: sumOf(orders.filter((order) => order.paymentStatus === 'collected')),
    deliveredCount: orders.filter((order) => order.status === 'delivered').length,
    // The fake keeps no return requests.
    returnedOrderCount: 0,
  };
}

export interface FakeAdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  isFeatured: boolean;
  imageUrl: string | null;
  /** The stored picture's base key, as the database keeps it (the URL is built from it). */
  /** The page banner's URL (the fake keeps its key in `banners`). */
  bannerUrl?: string | null;
  imageKey?: string | null;
}

/** A discount campaign as the fake keeps it, targets included. */
export interface FakeCampaign {
  id: string;
  name: string;
  customerTitle: string;
  internalNotes: string | null;
  scope: CampaignScope;
  discountKind: CampaignDiscountKind;
  discountValue: number;
  maxDiscountMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
  status: CampaignStatus;
  priority: number;
  isVisible: boolean;
  bannerImageKey: string | null;
  couponPolicy: CampaignCouponPolicy;
  version: number;
  categoryIds: string[];
  brandIds: string[];
  productIds: string[];
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface FakeAdminProduct {
  id: string;
  categoryId: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  description: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  stock: number;
  maxOrderQuantity: number;
  isFeatured: boolean;
  status: ProductStatus;
  moderationStatus: ModerationStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who last wrote the content (products.content_updated_by). */
  contentUpdatedBy: string | null;
  tags: string[];
  sizeChart: SizeChart | null;
}

export interface FakeTask {
  id: string;
  productId: string;
  status: ModerationTaskStatus;
  content: ModerationContent;
  submittedBy: string | null;
  submittedAt: string;
  assignedTo: string | null;
  assignedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Who last wrote the content when it was submitted (moderation_tasks.content_editor). */
  contentEditor: string | null;
  events: { kind: ModerationEventKind; actorId: string | null; note: string | null; at: string }[];
}

interface FakeMovement {
  id: number;
  productId: string;
  change: number;
  stockAfter: number;
  reason: InventoryReason;
  note: string | null;
  orderNumber: string | null;
  actorId: string | null;
  createdAt: string;
}

export type FakeAdminOrder = AdminOrderRecord;

/** The admin product orders, as the Supabase catalog store applies them. */
function productOrder(sort: AdminProductSort, a: FakeAdminProduct, b: FakeAdminProduct): number {
  switch (sort) {
    case 'updated_desc':
      return b.updatedAt.localeCompare(a.updatedAt);
    case 'name_asc':
      return a.name.localeCompare(b.name);
    case 'name_desc':
      return b.name.localeCompare(a.name);
    case 'price_asc':
      return a.priceMinor - b.priceMinor;
    case 'price_desc':
      return b.priceMinor - a.priceMinor;
    case 'stock_asc':
      return a.stock - b.stock;
    case 'stock_desc':
      return b.stock - a.stock;
  }
}

export class FakeAdmin {
  readonly categories: FakeAdminCategory[] = [];
  /** Category banner keys by category id (the real store keeps them in a nullable column). */
  readonly banners = new Map<string, string>();
  readonly products: FakeAdminProduct[] = [];
  readonly movements: FakeMovement[] = [];
  readonly tasks: FakeTask[] = [];
  readonly orders: FakeAdminOrder[] = [];
  readonly audit: (AuditEntry & { actorId: string | null })[] = [];
  readonly deliveryCharges = new Map<DeliveryZone, { amountMinor: number; updatedAt: string }>();
  readonly attributes: AdminAttribute[] = [];
  readonly variants: (AdminVariant & { productId: string })[] = [];
  /** Variants the database would refuse to delete, because orders or stock changes exist. */
  readonly variantHistory = new Set<string>();
  /** media_assets rows, oldest first. */
  readonly mediaAssets: StoredMediaAsset[] = [];
  /** Base keys an image field still stores (store profile, SEO, onboarding, banners). */
  readonly mediaInUse = new Set<string>();
  /** The store settings row (defaults as the migrations seed them). */
  settings: Omit<StoreSettings, 'updatedAt'> = {
    returnWindowDays: 7,
    cartInactivityMinutes: 120,
    repeatOrderThreshold: 2,
    highSpendThresholdMinor: 500_000,
    inactiveDays: 60,
    codEnabled: true,
    monthlySalesTargetMinor: null,
  };
  /** store_settings.monthly_sales_target_minor and the row's updated_at. */
  salesTarget: { targetMinor: number | null; updatedAt: string | null } = {
    targetMinor: null,
    updatedAt: null,
  };
  /** Every call that reached the "database", by operation name. */
  readonly calls: string[] = [];
  /** admin_order_shipment_states rows, by order number. */
  readonly orderShipments = new Map<string, NonNullable<AdminOrderSummary['shipment']>>();
  /** The next store call fails with this SQLSTATE (and DETAIL), as the database would. */
  nextFailure: { code: string; details?: string } | undefined;
  private tick = 0;
  private sequence = 100_000;

  /** Reports, exports and order documents. */
  readonly exports: FakeExports;
  /** Static pages, navigation links and homepage sections. */
  readonly content: FakeContent;

  constructor(private readonly identity: FakeIdentity) {
    this.exports = new FakeExports(identity, (operation) => {
      this.enter(operation);
    });
    this.content = new FakeContent(identity, (operation) => {
      this.enter(operation);
    });
  }

  /** Strictly increasing timestamps keep "newest first" orderings deterministic. */
  private now(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 9, 25, 8, 0, this.tick)).toISOString();
  }

  private enter(operation: string): void {
    this.calls.push(operation);
    const failure = this.nextFailure;
    if (failure) {
      this.nextFailure = undefined;
      raise(failure.code, failure.details);
    }
  }

  /** The signed-in caller, as auth.uid() reads them from the token. */
  private caller(accessToken: string) {
    const user = this.identity.userFor(accessToken);
    if (!user) raise('42501');
    return user;
  }

  private has(accessToken: string, permission: Permission): boolean {
    return this.identity.permissionsOf(this.caller(accessToken)).has(permission);
  }

  /** private.require_permission(): the caller's id, or NZ403. */
  private require(accessToken: string, permission: Permission): string {
    if (!this.has(accessToken, permission)) raise('NZ403');
    return this.caller(accessToken).id;
  }

  /** A fresh uuid-shaped id for rows the fake creates. */
  private newId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
  }

  /** One product's variants, in display order, as the contract shapes them. */
  private variantsOf(productId: string): AdminVariant[] {
    return this.variants
      .filter((variant) => variant.productId === productId)
      .sort((a, b) => a.position - b.position || a.sku.localeCompare(b.sku))
      .map(({ productId: _productId, ...variant }) => ({ ...variant }));
  }

  private record(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown> = {},
  ): void {
    this.audit.push({
      id: this.audit.length + 1,
      actorId,
      actor: { id: actorId, name: null, email: null },
      action,
      targetType,
      targetId,
      details,
      createdAt: this.now(),
    });
  }

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  addCategory(options: Partial<FakeAdminCategory> & { slug: string }): FakeAdminCategory {
    const category: FakeAdminCategory = {
      id: randomUUID(),
      name: options.slug,
      description: null,
      sortOrder: this.categories.length,
      isActive: true,
      parentId: null,
      isFeatured: false,
      imageUrl: null,
      ...options,
    };
    this.categories.push(category);
    return category;
  }

  addProduct(
    options: Partial<FakeAdminProduct> & { slug: string; categoryId: string },
  ): FakeAdminProduct {
    const at = this.now();
    const product: FakeAdminProduct = {
      id: randomUUID(),
      sku: options.slug.toUpperCase(),
      name: options.slug,
      summary: null,
      description: null,
      priceMinor: 10_000,
      compareAtPriceMinor: null,
      stock: 10,
      maxOrderQuantity: 10,
      isFeatured: false,
      status: 'draft',
      moderationStatus: 'not_submitted',
      publishedAt: null,
      createdAt: at,
      updatedAt: at,
      contentUpdatedBy: null,
      tags: [],
      sizeChart: null,
      ...options,
    };
    this.products.push(product);
    return product;
  }

  addTask(product: FakeAdminProduct, options: Partial<FakeTask> = {}): FakeTask {
    const task: FakeTask = {
      id: randomUUID(),
      productId: product.id,
      status: 'pending',
      content: this.snapshot(product),
      submittedBy: null,
      submittedAt: this.now(),
      assignedTo: null,
      assignedAt: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      contentEditor: product.contentUpdatedBy,
      events: [],
      ...options,
    };
    this.tasks.push(task);
    return task;
  }

  /** A Cash-on-Delivery order of one product for a customer. */
  addOrder(
    customerId: string,
    product: FakeAdminProduct,
    options: { quantity?: number; status?: OrderStatus; paymentStatus?: PaymentStatus } = {},
  ): FakeAdminOrder {
    this.sequence += 1;
    const quantity = options.quantity ?? 1;
    const subtotal = product.priceMinor * quantity;
    const status = options.status ?? 'pending';
    const placedAt = this.now();
    const order: FakeAdminOrder = {
      orderNumber: `NZ${this.sequence}`,
      status,
      paymentMethod: 'cod',
      paymentStatus: options.paymentStatus ?? (status === 'cancelled' ? 'cancelled' : 'pending'),
      itemCount: quantity,
      totalMinor: subtotal + 6000,
      placedAt,
      preview: [],
      currency: 'BDT',
      subtotalMinor: subtotal,
      shippingFeeMinor: 6000,
      discountMinor: 0,
      coupon: null,
      deliveryZone: 'inside_dhaka',
      shippingAddress: {
        recipientName: 'Rahima Khatun',
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        area: 'Dhanmondi',
        addressLine: 'House 12, Road 5',
        postalCode: null,
        landmark: null,
      },
      customerNote: null,
      cancelReason: null,
      cancelledAt: status === 'cancelled' ? placedAt : null,
      items: [
        {
          orderItemId: 1,
          productId: product.id,
          variantId: null,
          variantLabel: null,
          productName: product.name,
          productSlug: product.slug,
          sku: product.sku,
          unitPriceMinor: product.priceMinor,
          quantity,
          lineTotalMinor: subtotal,
          image: null,
          regularPriceMinor: product.compareAtPriceMinor ?? product.priceMinor,
          catalogPriceMinor: product.priceMinor,
          campaignId: null,
          campaignTitle: null,
          campaignDiscountMinor: 0,
        },
      ],
      customer: { id: customerId, fullName: null, phone: null },
      history: [
        { fromStatus: null, toStatus: 'pending', actorKind: 'customer', note: null, at: placedAt },
      ],
      paymentCollectedAt: options.paymentStatus === 'collected' ? placedAt : null,
    };
    this.orders.push(order);
    return order;
  }

  private snapshot(product: FakeAdminProduct): ModerationContent {
    return {
      name: product.name,
      summary: product.summary,
      description: product.description,
      slug: product.slug,
      sku: product.sku,
      categoryId: product.categoryId,
      categoryName: this.categories.find((c) => c.id === product.categoryId)?.name ?? null,
      priceMinor: product.priceMinor,
      compareAtPriceMinor: product.compareAtPriceMinor,
    };
  }

  // -------------------------------------------------------------------------
  // Views, as Row Level Security shows them to the caller
  // -------------------------------------------------------------------------

  private visibleProducts(accessToken: string): FakeAdminProduct[] {
    if (this.has(accessToken, 'products.read')) return this.products;
    return this.products.filter(
      (p) => p.status === 'active' && this.categories.find((c) => c.id === p.categoryId)?.isActive,
    );
  }

  private visibleTasks(accessToken: string): FakeTask[] {
    const callerId = this.caller(accessToken).id;
    const all =
      this.has(accessToken, 'moderation.assign') || this.has(accessToken, 'products.update');
    const reviews = this.has(accessToken, 'content.approve');
    return this.tasks.filter((t) => all || (reviews && t.assignedTo === callerId));
  }

  private visibleOrders(accessToken: string): FakeAdminOrder[] {
    if (this.has(accessToken, 'orders.read')) return this.orders;
    const callerId = this.caller(accessToken).id;
    return this.orders.filter((o) => o.customer.id === callerId);
  }

  private names(accessToken: string, id: string | null) {
    if (id === null) return null;
    const user = this.identity.users.get(id);
    const permitted = (
      ['moderation.assign', 'content.approve', 'products.update', 'orders.read'] as const
    ).some((permission) => this.has(accessToken, permission));
    const named = permitted && user !== undefined && user.role !== 'customer';
    return {
      id,
      name: named ? (user.profile?.fullName ?? null) : null,
      email: named ? user.email : null,
    };
  }

  private summary(product: FakeAdminProduct): AdminProductSummary {
    const category = this.categories.find((c) => c.id === product.categoryId);
    if (!category) throw new Error('fake product without category');
    return {
      id: product.id,
      slug: product.slug,
      sku: product.sku,
      name: product.name,
      summary: product.summary,
      status: product.status,
      moderationStatus: product.moderationStatus,
      priceMinor: product.priceMinor,
      compareAtPriceMinor: product.compareAtPriceMinor,
      stockQuantity: product.stock,
      maxOrderQuantity: product.maxOrderQuantity,
      isFeatured: product.isFeatured,
      category: {
        id: category.id,
        slug: category.slug,
        name: category.name,
        isActive: category.isActive,
      },
      publishedAt: product.publishedAt,
      updatedAt: product.updatedAt,
      image: null,
    };
  }

  private detail(accessToken: string, product: FakeAdminProduct): AdminProductDetail {
    const review = this.visibleTasks(accessToken)
      .filter((t) => t.productId === product.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return {
      ...this.summary(product),
      description: product.description,
      images: [],
      createdAt: product.createdAt,
      tags: [...product.tags],
      sizeChart: product.sizeChart,
      latestReview: review
        ? {
            taskId: review.id,
            status: review.status,
            note: review.decisionNote,
            submittedAt: review.submittedAt,
            decidedAt: review.decidedAt,
            assigned: review.assignedTo !== null,
          }
        : null,
    };
  }

  private productOrThrow(productId: string): FakeAdminProduct {
    const product = this.products.find((p) => p.id === productId);
    if (!product) raise('NZ404');
    return product;
  }

  private assertUnique(kind: 'slug' | 'sku', value: string, exceptId?: string): void {
    if (this.products.some((p) => p[kind] === value && p.id !== exceptId)) {
      raise('23505', `Key (${kind})=(${value}) already exists.`);
    }
  }

  private move(
    product: FakeAdminProduct,
    change: number,
    reason: InventoryReason,
    actorId: string | null,
    extra: { note?: string; orderNumber?: string } = {},
  ): void {
    product.stock += change;
    this.movements.push({
      id: this.movements.length + 1,
      productId: product.id,
      change,
      stockAfter: product.stock,
      reason,
      note: extra.note ?? null,
      orderNumber: extra.orderNumber ?? null,
      actorId,
      createdAt: this.now(),
    });
  }

  private taskRecord(accessToken: string, task: FakeTask): ModerationTaskRecord {
    const product = this.visibleProducts(accessToken).find((p) => p.id === task.productId);
    return {
      ...this.taskSummary(accessToken, task),
      content: task.content,
      decidedBy: this.names(accessToken, task.decidedBy),
      decisionNote: task.decisionNote,
      events: task.events.map((event) => ({
        kind: event.kind,
        actor: this.names(accessToken, event.actorId),
        note: event.note,
        at: event.at,
      })),
      product: product
        ? { status: product.status, moderationStatus: product.moderationStatus }
        : null,
    };
  }

  private taskSummary(accessToken: string, task: FakeTask): ModerationTaskSummary {
    return {
      id: task.id,
      productId: task.productId,
      productName: task.content.name,
      productSku: task.content.sku,
      status: task.status,
      submittedBy: this.names(accessToken, task.submittedBy),
      submittedAt: task.submittedAt,
      assignedTo: this.names(accessToken, task.assignedTo),
      assignedAt: task.assignedAt,
      decidedAt: task.decidedAt,
    };
  }

  private orderView(accessToken: string, order: FakeAdminOrder): AdminOrderRecord {
    const customer = this.identity.users.get(order.customer.id);
    const seesProfile =
      this.has(accessToken, 'customers.read') || this.caller(accessToken).id === order.customer.id;
    return {
      ...order,
      customer: {
        id: order.customer.id,
        fullName: seesProfile ? (customer?.profile?.fullName ?? null) : null,
        phone: seesProfile ? (customer?.profile?.phone ?? null) : null,
      },
    };
  }

  private orderSummary(order: FakeAdminOrder, accessToken?: string): AdminOrderSummary {
    // admin_order_shipment_states: parcels only for callers who may read shipments.
    const shipment =
      accessToken !== undefined && this.has(accessToken, 'shipments.read')
        ? (this.orderShipments.get(order.orderNumber) ?? null)
        : null;
    return {
      shipment,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemCount: order.itemCount,
      totalMinor: order.totalMinor,
      placedAt: order.placedAt,
      preview: order.items.slice(0, 3).map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        image: item.image,
      })),
      discountMinor: order.discountMinor,
      coupon: order.coupon,
      customerId: order.customer.id,
      recipientName: order.shippingAddress.recipientName,
      phone: order.shippingAddress.phone,
      deliveryZone: order.deliveryZone,
    };
  }

  // -------------------------------------------------------------------------
  // Stores
  // -------------------------------------------------------------------------

  readonly catalog: AdminCatalogStore = {
    listProducts: (
      accessToken,
      _userId,
      filters: AdminProductFilters,
      sort: AdminProductSort,
      { limit, offset }: Page,
    ) => {
      this.enter('listProducts');
      const search = filters.search?.toLowerCase();
      const matching = this.visibleProducts(accessToken)
        .filter(
          (p) =>
            (!filters.status || p.status === filters.status) &&
            (!filters.moderationStatus || p.moderationStatus === filters.moderationStatus) &&
            // The chosen category and everything beneath it, as the real stores filter.
            (!filters.categoryId || this.inBranch(p.categoryId, filters.categoryId)) &&
            (filters.stock !== 'out' || p.stock === 0) &&
            (filters.stock !== 'low' || p.stock <= LOW_STOCK_THRESHOLD) &&
            (!search || [p.name, p.sku, p.slug].some((v) => v.toLowerCase().includes(search))),
        )
        .sort((a, b) => productOrder(sort, a, b) || a.id.localeCompare(b.id));
      return Promise.resolve({
        products: matching.slice(offset, offset + limit).map((p) => this.summary(p)),
        total: matching.length,
      });
    },

    getProduct: (accessToken, _userId, productId) => {
      this.enter('getProduct');
      const product = this.visibleProducts(accessToken).find((p) => p.id === productId);
      return Promise.resolve(product ? this.detail(accessToken, product) : null);
    },

    createProduct: (accessToken, _userId, input) => {
      this.enter('createProduct');
      const actor = this.require(accessToken, 'products.create');
      if (!this.categories.some((c) => c.id === input.categoryId)) raise('NZ412');
      this.assertUnique('slug', input.slug);
      this.assertUnique('sku', input.sku);
      const product = this.addProduct({
        categoryId: input.categoryId,
        slug: input.slug,
        sku: input.sku,
        name: input.name,
        summary: input.summary ?? null,
        description: input.description ?? null,
        priceMinor: input.priceMinor,
        compareAtPriceMinor: input.compareAtPriceMinor ?? null,
        stock: 0,
        maxOrderQuantity: input.maxOrderQuantity,
        isFeatured: input.isFeatured,
        contentUpdatedBy: actor,
        tags: input.tags ?? [],
        sizeChart: input.sizeChart ?? null,
      });
      if (input.initialStock > 0) {
        this.move(product, input.initialStock, 'initial_stock', actor, { note: 'Initial stock' });
      }
      this.record(actor, 'product.created', 'product', product.id);
      return Promise.resolve(this.detail(accessToken, product));
    },

    updateProduct: (accessToken, _userId, productId, input) => {
      this.enter('updateProduct');
      const actor = this.require(accessToken, 'products.update');
      const product = this.productOrThrow(productId);
      if (!this.categories.some((c) => c.id === input.categoryId)) raise('NZ412');
      // Left out, the tags and the size chart are kept (admin_update_product's overload).
      const tags = input.tags ?? product.tags;
      const sizeChart = input.sizeChart === undefined ? product.sizeChart : input.sizeChart;
      const tagsChanged = JSON.stringify(tags) !== JSON.stringify(product.tags);
      const chartChanged = JSON.stringify(sizeChart) !== JSON.stringify(product.sizeChart);
      const contentChanged =
        product.categoryId !== input.categoryId ||
        product.slug !== input.slug ||
        product.name !== input.name ||
        product.summary !== (input.summary ?? null) ||
        product.description !== (input.description ?? null) ||
        chartChanged;
      if (contentChanged && product.status === 'active') raise('NZ430');
      if (contentChanged && product.moderationStatus === 'pending') raise('NZ431');
      const operationsChanged =
        product.priceMinor !== input.priceMinor ||
        product.compareAtPriceMinor !== (input.compareAtPriceMinor ?? null) ||
        product.maxOrderQuantity !== input.maxOrderQuantity ||
        product.isFeatured !== input.isFeatured ||
        tagsChanged;
      if (
        operationsChanged &&
        product.status === 'active' &&
        !this.has(accessToken, 'products.publish')
      ) {
        raise('NZ403');
      }
      this.assertUnique('slug', input.slug, product.id);
      Object.assign(product, {
        categoryId: input.categoryId,
        slug: input.slug,
        name: input.name,
        summary: input.summary ?? null,
        description: input.description ?? null,
        priceMinor: input.priceMinor,
        compareAtPriceMinor: input.compareAtPriceMinor ?? null,
        maxOrderQuantity: input.maxOrderQuantity,
        isFeatured: input.isFeatured,
        tags: [...tags],
        sizeChart,
        moderationStatus: contentChanged ? 'not_submitted' : product.moderationStatus,
        contentUpdatedBy: contentChanged ? actor : product.contentUpdatedBy,
        updatedAt: this.now(),
      });
      this.record(actor, 'product.updated', 'product', product.id, { contentChanged });
      return Promise.resolve(this.detail(accessToken, product));
    },

    setProductStatus: (accessToken, _userId, productId, status) => {
      this.enter('setProductStatus');
      const actor = this.require(accessToken, 'products.publish');
      const product = this.productOrThrow(productId);
      if (status === 'active' && product.moderationStatus !== 'approved') raise('NZ432');
      product.status = status;
      product.publishedAt ??= status === 'active' ? this.now() : null;
      product.updatedAt = this.now();
      this.record(actor, 'product.status_changed', 'product', product.id, { to: status });
      return Promise.resolve(this.detail(accessToken, product));
    },

    adjustStock: (accessToken, _userId, productId, change, note) => {
      this.enter('adjustStock');
      const actor = this.require(accessToken, 'inventory.adjust');
      const product = this.productOrThrow(productId);
      if (product.stock + change < 0) raise('NZ433');
      this.move(product, change, 'adjustment', actor, { note });
      product.updatedAt = this.now();
      this.record(actor, 'inventory.adjusted', 'product', product.id, { change });
      return Promise.resolve(this.detail(accessToken, product));
    },

    submitForReview: (accessToken, _userId, productId) => {
      this.enter('submitForReview');
      const actor = this.require(accessToken, 'products.update');
      const product = this.productOrThrow(productId);
      if (product.status !== 'draft') raise('NZ430');
      if (product.moderationStatus === 'pending' || product.moderationStatus === 'approved') {
        raise('NZ431');
      }
      const task = this.addTask(product, { submittedBy: actor });
      task.events.push({ kind: 'submitted', actorId: actor, note: null, at: task.submittedAt });
      product.moderationStatus = 'pending';
      product.updatedAt = this.now();
      this.record(actor, 'moderation.submitted', 'product', product.id, { taskId: task.id });
      return Promise.resolve(this.detail(accessToken, product));
    },

    slugAvailability: (accessToken, _userId, { kind, slug, excludeId }) => {
      this.enter('slugAvailability');
      this.require(accessToken, 'products.read');
      const [min, max] = kind === 'product' ? [1, 120] : kind === 'category' ? [1, 80] : [2, 60];
      const reserved = (candidate: string) =>
        kind === 'brand' && (RESERVED_BRAND_SLUGS as readonly string[]).includes(candidate);
      const taken = (candidate: string) =>
        kind === 'product'
          ? this.products.some((p) => p.slug === candidate && p.id !== excludeId)
          : kind === 'category'
            ? this.categories.some((c) => c.slug === candidate && c.id !== excludeId)
            : false;
      const answer = (value: SlugAvailabilityResponse) => Promise.resolve(value);
      if (slug.length < min || slug.length > max || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        return answer({ available: false, reason: 'invalid', suggestion: null });
      }
      const reason = reserved(slug) ? 'reserved' : taken(slug) ? 'taken' : null;
      if (reason === null) return answer({ available: true, reason: null, suggestion: null });
      for (let n = 2; n < 1000; n += 1) {
        const suffix = `-${String(n)}`;
        const candidate = slug.slice(0, max - suffix.length).replace(/-+$/, '') + suffix;
        if (!reserved(candidate) && !taken(candidate)) {
          return answer({ available: false, reason, suggestion: candidate });
        }
      }
      return answer({ available: false, reason, suggestion: null });
    },

    listCategories: (accessToken, _userId) => {
      this.enter('listCategories');
      const all = this.has(accessToken, 'products.read');
      const categories: AdminCategory[] = this.categories
        .filter((c) => all || c.isActive)
        .map((c) => ({
          ...c,
          productCount: this.products.filter((p) => p.categoryId === c.id).length,
        }));
      return Promise.resolve(categories);
    },

    saveCategory: (accessToken, _userId, categoryId, input) => {
      this.enter('saveCategory');
      const actor = this.require(accessToken, 'products.publish');
      if (this.categories.some((c) => c.slug === input.slug && c.id !== categoryId)) {
        raise('23505', `Key (slug)=(${input.slug}) already exists.`);
      }
      let category = this.categories.find((c) => c.id === categoryId);
      if (categoryId !== null && !category) raise('NZ404');
      const fields = {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        parentId: input.parentId ?? null,
        isFeatured: input.isFeatured,
        imageUrl: null,
      };
      if (category) Object.assign(category, fields);
      else category = this.addCategory(fields);
      this.record(
        actor,
        categoryId ? 'category.updated' : 'category.created',
        'category',
        category.id,
      );
      const saved = category;
      return Promise.resolve({
        ...saved,
        productCount: this.products.filter((p) => p.categoryId === saved.id).length,
      });
    },

    deleteProduct: (accessToken, _userId, productId) => {
      this.enter('deleteProduct');
      const actor = this.require(accessToken, 'products.publish');
      const index = this.products.findIndex((p) => p.id === productId);
      if (index < 0) raise('NZ404');
      if (this.products[index]?.status === 'active') raise('NZ430');
      this.products.splice(index, 1);
      this.record(actor, 'product.deleted', 'product', productId);
      return Promise.resolve({ imageKeys: [], videoKeys: [] });
    },

    reorderCategories: (accessToken, _userId, parentId, ids) => {
      this.enter('reorderCategories');
      const actor = this.require(accessToken, 'products.publish');
      const group = this.categories.filter((c) => (c.parentId ?? null) === parentId);
      const exact =
        group.length === ids.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => group.some((c) => c.id === id));
      if (!exact) raise('NZ422');
      ids.forEach((id, index) => {
        const category = this.categories.find((c) => c.id === id);
        if (category) category.sortOrder = index * 10;
      });
      this.record(actor, 'category.reordered', 'category', parentId ?? 'top-level');
      return Promise.resolve();
    },

    deleteCategory: (accessToken, _userId, categoryId) => {
      this.enter('deleteCategory');
      const actor = this.require(accessToken, 'products.publish');
      const category = this.categories.find((c) => c.id === categoryId);
      if (!category) raise('NZ404');
      if (this.products.some((p) => p.categoryId === categoryId)) raise('NZ409');
      if (this.categories.some((c) => c.parentId === categoryId)) raise('NZ409');
      this.categories.splice(
        this.categories.findIndex((c) => c.id === categoryId),
        1,
      );
      this.record(actor, 'category.deleted', 'category', categoryId);
      // The cover picture's key travels back so the route can release its files.
      return Promise.resolve(category.imageKey ?? null);
    },

    setCategoryImage: (accessToken, _userId, categoryId, imageKey) => {
      this.enter('setCategoryImage');
      this.require(accessToken, 'products.publish');
      const category = this.categories.find((c) => c.id === categoryId);
      if (!category) raise('NZ404');
      const previous = category.imageKey ?? null;
      category.imageKey = imageKey;
      category.imageUrl = imageKey === null ? null : `https://media.test/${imageKey}/full.webp`;
      this.record(
        accessToken,
        imageKey === null ? 'category.image_cleared' : 'category.image_changed',
        'category',
        categoryId,
      );
      return Promise.resolve(previous);
    },

    setCategoryBanner: (accessToken, _userId, categoryId, bannerKey) => {
      this.enter('setCategoryBanner');
      this.require(accessToken, 'products.publish');
      const category = this.categories.find((c) => c.id === categoryId);
      if (!category) raise('NZ404');
      const previous = this.banners.get(categoryId) ?? null;
      if (bannerKey === null) this.banners.delete(categoryId);
      else this.banners.set(categoryId, bannerKey);
      category.bannerUrl = bannerKey === null ? null : `https://media.test/${bannerKey}/full.webp`;
      this.record(
        accessToken,
        bannerKey === null ? 'category.banner_removed' : 'category.banner_set',
        'category',
        categoryId,
      );
      return Promise.resolve(previous);
    },

    categoryBannerKey: (_accessToken, _userId, categoryId) =>
      Promise.resolve(this.banners.get(categoryId) ?? null),

    listMovements: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('listMovements');
      const visible =
        this.has(accessToken, 'inventory.adjust') || this.has(accessToken, 'products.update')
          ? this.movements
          : [];
      const matching = visible
        .filter(
          (m) =>
            (!filters.productId || m.productId === filters.productId) &&
            (!filters.reason || m.reason === filters.reason),
        )
        .reverse();
      const movements: InventoryMovement[] = matching.slice(offset, offset + limit).map((m) => {
        const product = this.productOrThrow(m.productId);
        return {
          id: m.id,
          product: { id: product.id, name: product.name, sku: product.sku },
          change: m.change,
          stockAfter: m.stockAfter,
          reason: m.reason,
          note: m.note,
          orderNumber: m.orderNumber,
          actor: this.names(accessToken, m.actorId),
          createdAt: m.createdAt,
        };
      });
      return Promise.resolve({ movements, total: matching.length });
    },

    listAttributes: (accessToken) => {
      this.enter('listAttributes');
      this.require(accessToken, 'products.read');
      return Promise.resolve(this.attributes.map((a) => ({ ...a, values: [...a.values] })));
    },

    saveAttribute: (accessToken, _userId, attributeId, input) => {
      this.enter('saveAttribute');
      this.require(accessToken, 'products.update');
      const clash = this.attributes.find((a) => a.slug === input.slug && a.id !== attributeId);
      if (clash) raise('NZ441');
      if (attributeId === null) {
        this.attributes.push({
          id: this.newId(),
          slug: input.slug,
          name: input.name,
          position: input.position,
          isActive: input.isActive,
          values: [],
        });
      } else {
        const attribute = this.attributes.find((a) => a.id === attributeId);
        if (!attribute) raise('NZ404');
        Object.assign(attribute, {
          slug: input.slug,
          name: input.name,
          position: input.position,
          isActive: input.isActive,
        });
      }
      return Promise.resolve(this.attributes.map((a) => ({ ...a, values: [...a.values] })));
    },

    saveAttributeValue: (accessToken, _userId, input) => {
      this.enter('saveAttributeValue');
      this.require(accessToken, 'products.update');
      const attribute = this.attributes.find((a) => a.id === input.attributeId);
      if (!attribute) raise('NZ404');
      const clash = attribute.values.find(
        (v) => v.slug === input.slug && v.id !== (input.valueId ?? null),
      );
      if (clash) raise('NZ441');
      if (!input.valueId) {
        attribute.values.push({
          id: this.newId(),
          slug: input.slug,
          value: input.value,
          position: input.position,
        });
      } else {
        const value = attribute.values.find((v) => v.id === input.valueId);
        if (!value) raise('NZ404');
        Object.assign(value, { slug: input.slug, value: input.value, position: input.position });
      }
      return Promise.resolve(this.attributes.map((a) => ({ ...a, values: [...a.values] })));
    },

    listVariants: (accessToken, _userId, productId) => {
      this.enter('listVariants');
      this.require(accessToken, 'products.read');
      this.productOrThrow(productId);
      return Promise.resolve(this.variantsOf(productId));
    },

    saveVariant: (accessToken, _userId, productId, input) => {
      this.enter('saveVariant');
      this.require(accessToken, 'products.update');
      this.productOrThrow(productId);
      if (this.variants.some((v) => v.sku === input.sku && v.id !== (input.variantId ?? null))) {
        raise('NZ472');
      }
      // As admin_save_variant: every variant of a product names the same attributes.
      const attributeOf = (valueId: string) =>
        this.attributes.find((a) => a.values.some((v) => v.id === valueId))?.id ?? valueId;
      const setOf = (ids: readonly string[]) => [...new Set(ids.map(attributeOf))].sort().join(',');
      const wanted = setOf(input.attributeValueIds);
      if (
        input.attributeValueIds.length === 0 ||
        this.variants.some(
          (v) =>
            v.productId === productId &&
            v.id !== (input.variantId ?? null) &&
            setOf(v.attributeValueIds) !== wanted,
        )
      ) {
        raise('NZ471');
      }
      const label = input.attributeValueIds
        .map((valueId) => {
          const attribute = this.attributes.find((a) => a.values.some((v) => v.id === valueId));
          const value = attribute?.values.find((v) => v.id === valueId);
          return attribute && value ? `${attribute.name}: ${value.value}` : null;
        })
        .filter((part): part is string => part !== null)
        .join(' / ');
      if (input.variantId) {
        const variant = this.variants.find((v) => v.id === input.variantId);
        if (!variant) raise('NZ404');
        Object.assign(variant, {
          sku: input.sku,
          priceMinor: input.priceMinor ?? null,
          compareAtPriceMinor: input.compareAtPriceMinor ?? null,
          imageUrl: input.imageUrl ?? null,
          position: input.position ?? 0,
          isActive: input.isActive ?? true,
          label,
          attributeValueIds: [...input.attributeValueIds],
        });
      } else {
        this.variants.push({
          id: this.newId(),
          productId,
          sku: input.sku,
          priceMinor: input.priceMinor ?? null,
          compareAtPriceMinor: input.compareAtPriceMinor ?? null,
          stockQuantity: 0,
          imageUrl: input.imageUrl ?? null,
          position: input.position ?? 0,
          isActive: input.isActive ?? true,
          label,
          attributeValueIds: [...input.attributeValueIds],
        });
      }
      return Promise.resolve(this.variantsOf(productId));
    },

    setVariantActive: (accessToken, _userId, variantId, isActive) => {
      this.enter('setVariantActive');
      this.require(accessToken, 'products.update');
      const variant = this.variants.find((v) => v.id === variantId);
      if (!variant) raise('NZ404');
      variant.isActive = isActive;
      return Promise.resolve();
    },

    deleteVariant: (accessToken, _userId, variantId) => {
      this.enter('deleteVariant');
      this.require(accessToken, 'products.publish');
      const index = this.variants.findIndex((v) => v.id === variantId);
      if (index < 0) raise('NZ404');
      if (this.variantHistory.has(variantId)) raise('NZ473');
      this.variants.splice(index, 1);
      return Promise.resolve();
    },

    adjustVariantStock: (accessToken, _userId, variantId, change, note) => {
      this.enter('adjustVariantStock');
      this.require(accessToken, 'inventory.adjust');
      const variant = this.variants.find((v) => v.id === variantId);
      if (!variant) raise('NZ404');
      if (note.trim().length < 3) raise('NZ412');
      if (variant.stockQuantity + change < 0) raise('NZ433');
      variant.stockQuantity += change;
      return Promise.resolve();
    },

    setVariantStock: (accessToken, _userId, variantId, stock, note) => {
      this.enter('setVariantStock');
      this.require(accessToken, 'inventory.adjust');
      const variant = this.variants.find((v) => v.id === variantId);
      if (!variant) raise('NZ404');
      if (note.trim().length < 3) raise('NZ412');
      if (stock < 0) raise('NZ412');
      variant.stockQuantity = stock;
      return Promise.resolve();
    },
  };

  readonly ordersStore: AdminOrderStore = {
    listOrders: (accessToken, _userId, filters: AdminOrderFilters, { limit, offset }: Page) => {
      this.enter('listOrders');
      const search = filters.search;
      const sorted = this.visibleOrders(accessToken)
        .filter(
          (o) =>
            (!filters.status || o.status === filters.status) &&
            (!filters.deliveryZone || o.deliveryZone === filters.deliveryZone) &&
            (!filters.orderNumbers || filters.orderNumbers.includes(o.orderNumber)) &&
            (!filters.paymentStatus || o.paymentStatus === filters.paymentStatus) &&
            (!filters.customerId || o.customer.id === filters.customerId) &&
            (!filters.placedFrom || o.placedAt >= filters.placedFrom) &&
            (!filters.placedBefore || o.placedAt < filters.placedBefore) &&
            (!search ||
              (search.kind === 'order_number' && o.orderNumber.startsWith(search.prefix)) ||
              (search.kind === 'phone' && o.shippingAddress.phone.includes(search.digits)) ||
              (search.kind === 'recipient' &&
                o.shippingAddress.recipientName.toLowerCase().includes(search.term.toLowerCase()))),
        )
        .reverse();
      const sort = filters.sort ?? 'newest';
      const matching =
        sort === 'oldest'
          ? [...sorted].reverse()
          : sort === 'total_high'
            ? [...sorted].sort((a, b) => b.totalMinor - a.totalMinor)
            : sort === 'total_low'
              ? [...sorted].sort((a, b) => a.totalMinor - b.totalMinor)
              : sorted;
      return Promise.resolve({
        orders: matching
          .slice(offset, offset + limit)
          .map((o) => this.orderSummary(o, accessToken)),
        total: matching.length,
      });
    },

    getOrder: (accessToken, _userId, orderNumber) => {
      this.enter('getOrder');
      const order = this.visibleOrders(accessToken).find((o) => o.orderNumber === orderNumber);
      return Promise.resolve(order ? this.orderView(accessToken, order) : null);
    },

    updateStatus: (accessToken, _userId, orderNumber, status, note) => {
      this.enter('updateStatus');
      const actor = this.require(
        accessToken,
        status === 'cancelled' ? 'orders.cancel' : 'orders.update_status',
      );
      if (status === 'cancelled' && (note?.length ?? 0) < 5) raise('NZ412');
      const order = this.orders.find((o) => o.orderNumber === orderNumber);
      if (!order) raise('NZ404');
      if (!ORDER_TRANSITIONS[order.status].includes(status)) raise('NZ434');
      const at = this.now();
      if (status === 'cancelled') {
        order.paymentStatus = 'cancelled';
        order.cancelledAt = at;
        order.cancelReason = note ?? null;
        for (const item of order.items) {
          const product = this.products.find((p) => p.id === item.productId);
          if (product) {
            this.move(product, item.quantity, 'order_cancelled', actor, {
              orderNumber: order.orderNumber,
            });
          }
        }
      }
      order.history.push({
        fromStatus: order.status,
        toStatus: status,
        actorKind: 'staff',
        note: note ?? null,
        at,
      });
      order.status = status;
      this.record(actor, 'order.status_changed', 'order', orderNumber, { to: status });
      return Promise.resolve();
    },

    internal: () => Promise.resolve({ notes: [], archive: null }),
    addNote: () => Promise.resolve(),
    setArchived: () => Promise.resolve(),
    recordCollection: (accessToken, _userId, orderNumber) => {
      this.enter('recordCollection');
      const actor = this.require(accessToken, 'payments.collect');
      const order = this.orders.find((o) => o.orderNumber === orderNumber);
      if (!order) raise('NZ404');
      if (order.status !== 'delivered' || order.paymentStatus !== 'pending') raise('NZ435');
      order.paymentStatus = 'collected';
      order.paymentCollectedAt = this.now();
      this.record(actor, 'order.payment_collected', 'order', orderNumber);
      return Promise.resolve();
    },
  };

  private customerRow(userId: string) {
    const user = this.identity.users.get(userId);
    if (!user?.profile || user.role !== 'customer') return null;
    const orders = this.orders.filter((o) => o.customer.id === userId);
    return {
      id: user.id,
      email: user.email,
      fullName: user.profile.fullName,
      phone: user.profile.phone,
      status: user.status,
      createdAt: user.profile.createdAt,
      orderCount: orders.length,
      lastOrderAt: orders.at(-1)?.placedAt ?? null,
      avatar: null,
      googleAvatar: null,
    };
  }

  readonly accounts: AdminAccountStore = {
    listCustomers: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('listCustomers');
      this.require(accessToken, 'customers.read');
      const query = filters.query?.toLowerCase();
      const matching = [...this.identity.users.values()]
        .map((user) => this.customerRow(user.id))
        .filter((row) => row !== null)
        .filter(
          (row) =>
            (!filters.status || row.status === filters.status) &&
            (!query ||
              [row.email, row.fullName ?? '', row.phone ?? ''].some((v) =>
                v.toLowerCase().includes(query),
              )),
        );
      return Promise.resolve({
        customers: matching.slice(offset, offset + limit),
        total: matching.length,
      });
    },

    getCustomer: (accessToken, _userId, customerId) => {
      this.enter('getCustomer');
      this.require(accessToken, 'customers.read');
      return Promise.resolve(this.customerRow(customerId));
    },

    setCustomerStatus: (accessToken, _userId, customerId, status, reason) => {
      this.enter('setCustomerStatus');
      const actor = this.require(accessToken, 'customers.update');
      if (customerId === actor) raise('NZ438');
      if (status === 'suspended' && (reason?.length ?? 0) < 5) raise('NZ412');
      const user = this.identity.users.get(customerId);
      if (!user || user.role !== 'customer') raise('NZ404');
      user.status = status;
      this.record(actor, 'customer.status_changed', 'account', customerId, { to: status });
      return Promise.resolve();
    },

    listRoles: (accessToken, _userId) => {
      this.enter('listRoles');
      if (
        !this.has(accessToken, 'staff.roles.assign') &&
        !this.has(accessToken, 'staff.permissions.manage')
      ) {
        raise('NZ403');
      }
      return Promise.resolve(
        (['super_admin', 'admin', 'staff', 'moderator', 'customer'] as const).map((role) => ({
          role,
          // The owner holds the whole catalogue; the others their stored defaults.
          permissions: [...(role === 'super_admin' ? PERMISSIONS : ROLE_PERMISSIONS[role])].sort(),
        })),
      );
    },

    listStaff: (accessToken, _userId) => {
      this.enter('listStaff');
      if (
        !this.has(accessToken, 'staff.roles.assign') &&
        !this.has(accessToken, 'staff.permissions.manage')
      ) {
        raise('NZ403');
      }
      const order = ['super_admin', 'admin', 'staff', 'moderator'];
      return Promise.resolve(
        [...this.identity.users.values()]
          .filter((user) => user.role !== 'customer' && user.profile)
          .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
          .map((user) => ({
            id: user.id,
            email: user.email,
            fullName: user.profile?.fullName ?? null,
            role: user.role as 'super_admin' | 'admin' | 'staff' | 'moderator',
            status: user.status,
            grantedAt: '2026-10-23T09:30:00.000Z',
            overrides: [...user.overrides].map(([permission, effect]) => ({ permission, effect })),
            permissions: [...this.identity.permissionsOf(user)].sort(),
            invitationPending: !user.confirmed,
          })),
      );
    },

    listPermissions: (accessToken, _userId) => {
      this.enter('listPermissions');
      this.caller(accessToken);
      return Promise.resolve(
        [...PERMISSIONS].sort().map((name) => ({ name, description: `Allows ${name}` })),
      );
    },

    prepareInvitationResend: (accessToken, _userId, userId) => {
      this.enter('prepareInvitationResend');
      const actor = this.require(accessToken, 'staff.invite');
      const target = this.identity.users.get(userId);
      if (!target || target.role === 'customer' || target.status !== 'active') raise('NZ404');
      if (target.confirmed) raise('NZ412');
      const actorRole = this.caller(accessToken).role;
      if (
        target.role === 'super_admin' ||
        (target.role === 'admin' && actorRole !== 'super_admin')
      ) {
        raise('NZ403');
      }
      this.record(actor, 'staff.invitation_resent', 'account', userId, { role: target.role });
      return Promise.resolve(target.email);
    },

    setPermission: (accessToken, _userId, userId, permission, effect) => {
      this.enter('setPermission');
      const actor = this.require(accessToken, 'staff.permissions.manage');
      if (userId === actor) raise('NZ438');
      const target = this.identity.users.get(userId);
      if (!target) raise('NZ404');
      if (target.role === 'customer') raise('NZ439');
      const actorRole = this.caller(accessToken).role;
      if (
        (target.role === 'super_admin' || target.role === 'admin') &&
        actorRole !== 'super_admin'
      ) {
        raise('NZ439');
      }
      if (!this.has(accessToken, permission)) raise('NZ403');
      if (effect === null) target.overrides.delete(permission);
      else target.overrides.set(permission, effect);
      this.record(actor, 'staff.permission_changed', 'account', userId, { permission, to: effect });
      return Promise.resolve();
    },
  };

  readonly moderation: ModerationStore = {
    listTasks: (accessToken, callerId, filters, { limit, offset }) => {
      this.enter('listTasks');
      const pending = filters.status === 'pending';
      const matching = this.visibleTasks(accessToken)
        .filter(
          (t) =>
            (filters.scope !== 'mine' || t.assignedTo === callerId) &&
            (filters.scope !== 'unassigned' || t.assignedTo === null) &&
            (!filters.status || t.status === filters.status),
        )
        .sort((a, b) =>
          pending
            ? a.submittedAt.localeCompare(b.submittedAt)
            : b.submittedAt.localeCompare(a.submittedAt),
        );
      return Promise.resolve({
        tasks: matching.slice(offset, offset + limit).map((t) => this.taskSummary(accessToken, t)),
        total: matching.length,
      });
    },

    getTask: (accessToken, _userId, taskId) => {
      this.enter('getTask');
      const task = this.visibleTasks(accessToken).find((t) => t.id === taskId);
      return Promise.resolve(task ? this.taskRecord(accessToken, task) : null);
    },

    assign: (accessToken, _userId, taskId, moderatorId) => {
      this.enter('assign');
      const actor = this.require(accessToken, 'moderation.assign');
      const task = this.tasks.find((t) => t.id === taskId);
      if (!task) raise('NZ404');
      if (task.status !== 'pending') raise('NZ436');
      const moderator = this.identity.users.get(moderatorId);
      if (!moderator || !this.identity.permissionsOf(moderator).has('content.approve')) {
        raise('NZ436');
      }
      if (moderatorId === task.submittedBy || moderatorId === task.contentEditor) raise('NZ437');
      if (moderatorId === actor && this.caller(accessToken).role !== 'super_admin') {
        raise('NZ437');
      }
      task.assignedTo = moderatorId;
      task.assignedAt = this.now();
      task.events.push({ kind: 'assigned', actorId: actor, note: null, at: task.assignedAt });
      this.record(actor, 'moderation.assigned', 'moderation_task', taskId, { moderatorId });
      return Promise.resolve();
    },

    decide: (accessToken, _userId, taskId, decision, note) => {
      this.enter('decide');
      const actor = this.require(accessToken, 'content.approve');
      if (decision !== 'approved' && (note?.length ?? 0) < 10) raise('NZ412');
      const task = this.tasks.find((t) => t.id === taskId);
      if (!task || task.assignedTo !== actor) raise('NZ404');
      if (task.status !== 'pending') raise('NZ436');
      if (task.submittedBy === actor || task.contentEditor === actor) raise('NZ437');
      const at = this.now();
      Object.assign(task, {
        status: decision,
        decidedBy: actor,
        decidedAt: at,
        decisionNote: note ?? null,
      });
      task.events.push({ kind: decision, actorId: actor, note: note ?? null, at });
      const product = this.productOrThrow(task.productId);
      product.moderationStatus = decision;
      this.record(actor, 'moderation.decided', 'moderation_task', taskId, { decision });
      return Promise.resolve();
    },

    withdraw: (accessToken, _userId, taskId) => {
      this.enter('withdraw');
      const actor = this.require(accessToken, 'products.update');
      const task = this.tasks.find((t) => t.id === taskId);
      if (!task) raise('NZ404');
      if (task.status !== 'pending') raise('NZ436');
      if (task.submittedBy !== actor && !this.has(accessToken, 'moderation.assign')) raise('NZ403');
      const at = this.now();
      Object.assign(task, { status: 'withdrawn', decidedBy: actor, decidedAt: at });
      task.events.push({ kind: 'withdrawn', actorId: actor, note: null, at });
      this.productOrThrow(task.productId).moderationStatus = 'not_submitted';
      this.record(actor, 'moderation.withdrawn', 'moderation_task', taskId);
      return Promise.resolve();
    },

    listReviewers: (accessToken, _userId) => {
      this.enter('listReviewers');
      this.require(accessToken, 'moderation.assign');
      return Promise.resolve(
        [...this.identity.users.values()]
          .filter(
            (user) =>
              user.status === 'active' && this.identity.permissionsOf(user).has('content.approve'),
          )
          .map((user) => ({
            id: user.id,
            name: user.profile?.fullName ?? null,
            email: user.email,
            openReviews: this.tasks.filter(
              (task) => task.assignedTo === user.id && task.status === 'pending',
            ).length,
          })),
      );
    },
  };

  private charge(zone: DeliveryZone): DeliveryCharge {
    const set = this.deliveryCharges.get(zone);
    return { zone, amountMinor: set?.amountMinor ?? null, updatedAt: set?.updatedAt ?? null };
  }

  readonly reports: AdminReportStore = {
    auditLog: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('auditLog');
      this.require(accessToken, 'audit_logs.read');
      if (
        filters.from !== undefined &&
        filters.to !== undefined &&
        (filters.from > filters.to || daysOf(filters.from, filters.to).length > ANALYTICS_MAX_DAYS)
      ) {
        raise('NZ412');
      }
      const term = filters.q?.toLowerCase();
      const matching = this.audit
        .filter(
          (entry) =>
            (!filters.actionPrefix || entry.action.startsWith(filters.actionPrefix)) &&
            (!filters.actorId || entry.actorId === filters.actorId) &&
            (filters.from === undefined || dhakaDay(entry.createdAt) >= filters.from) &&
            (filters.to === undefined || dhakaDay(entry.createdAt) <= filters.to) &&
            (term === undefined ||
              [entry.action, entry.targetId, entry.actor?.name, entry.actor?.email].some((text) =>
                text?.toLowerCase().includes(term),
              )),
        )
        .reverse();
      return Promise.resolve({
        entries: matching
          .slice(offset, offset + limit)
          .map(({ actorId: _actorId, ...entry }) => entry),
        total: matching.length,
      });
    },

    salesOverview: (accessToken, _userId, days) => {
      this.enter('salesOverview');
      this.require(accessToken, 'finance.read');
      if (days < 1 || days > 365) raise('NZ412');
      const sold = this.orders.filter((o) => o.status !== 'cancelled');
      const salesMinor = sold.reduce((sum, o) => sum + o.totalMinor, 0);
      const overview: SalesOverview = {
        days,
        orderCount: sold.length,
        cancelledCount: this.orders.length - sold.length,
        salesMinor,
        collectedMinor: this.orders
          .filter((o) => o.paymentStatus === 'collected')
          .reduce((sum, o) => sum + o.totalMinor, 0),
        awaitingCollectionMinor: this.orders
          .filter((o) => o.status === 'delivered' && o.paymentStatus === 'pending')
          .reduce((sum, o) => sum + o.totalMinor, 0),
        averageOrderMinor: sold.length === 0 ? 0 : Math.round(salesMinor / sold.length),
        byStatus: Object.fromEntries(
          [...new Set(this.orders.map((o) => o.status))].map((status) => [
            status,
            this.orders.filter((o) => o.status === status).length,
          ]),
        ),
        daily: [{ day: '2026-10-25', orderCount: sold.length, salesMinor }],
        topProducts: [],
      };
      return Promise.resolve(overview);
    },

    analyticsOverview: (accessToken, _userId, { from, to, compare }) => {
      this.enter('analyticsOverview');
      this.require(accessToken, 'finance.read');
      const days = daysOf(from, to);
      if (days.length < 1 || days.length > ANALYTICS_MAX_DAYS) raise('NZ412');
      const within = (first: string, last: string) =>
        this.orders.filter((o) => dhakaDay(o.placedAt) >= first && dhakaDay(o.placedAt) <= last);
      const ranged = within(from, to);
      const sold = ranged.filter((o) => o.status !== 'cancelled');
      const previousFrom = addDays(from, -days.length);
      const previousTo = addDays(from, -1);
      const delivered = ranged.filter((o) => o.status === 'delivered').length;
      const users = [...this.identity.users.values()];
      const tally = (key: (productId: string) => string | undefined) => {
        const totals = new Map<string, { units: number; revenue: number }>();
        for (const item of sold.flatMap((o) => o.items)) {
          const id = key(item.productId);
          if (!id) continue;
          const entry = totals.get(id) ?? { units: 0, revenue: 0 };
          entry.units += item.quantity;
          entry.revenue += item.lineTotalMinor;
          totals.set(id, entry);
        }
        return [...totals.entries()];
      };
      const productOf = (id: string) => this.products.find((p) => p.id === id);
      const cells = new Map<string, { weekday: number; hour: number; orderCount: number }>();
      for (const order of ranged) {
        const local = new Date(new Date(order.placedAt).getTime() + DHAKA_OFFSET_MS);
        const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
        const hour = local.getUTCHours();
        const cell = cells.get(`${String(weekday)}:${String(hour)}`) ?? {
          weekday,
          hour,
          orderCount: 0,
        };
        cell.orderCount += 1;
        cells.set(`${String(weekday)}:${String(hour)}`, cell);
      }
      const month = dhakaDay(Date.now()).slice(0, 7);
      const awaitingCash = this.orders.filter(
        (o) => o.status === 'delivered' && o.paymentStatus === 'pending',
      );
      const onSale = this.products.filter((p) => p.status === 'active');
      const customerIds = [...new Set(sold.map((o) => o.customer.id))].filter(
        (id) => users.find((user) => user.id === id)?.role === 'customer',
      );
      const overview: AnalyticsOverview = {
        range: { from, to, days: days.length },
        previousRange: compare ? { from: previousFrom, to: previousTo } : null,
        totals: fakeTotals(ranged),
        previousTotals: compare ? fakeTotals(within(previousFrom, previousTo)) : null,
        daily: days.map((day) => {
          const placed = ranged.filter((o) => dhakaDay(o.placedAt) === day);
          const daySold = placed.filter((o) => o.status !== 'cancelled');
          return {
            day,
            revenueMinor: sumOf(daySold),
            orderCount: daySold.length,
            newCustomers: 0,
            byStatus: countBy(placed.map((o) => o.status)),
          };
        }),
        previousDaily: compare
          ? daysOf(previousFrom, previousTo).map((day) => {
              const daySold = this.orders.filter(
                (o) => o.status !== 'cancelled' && dhakaDay(o.placedAt) === day,
              );
              return { day, revenueMinor: sumOf(daySold), orderCount: daySold.length };
            })
          : [],
        snapshot: {
          codPendingMinor: sumOf(awaitingCash),
          codPendingCount: awaitingCash.length,
          lowStockCount: onSale.filter((p) => p.stock <= LOW_STOCK_THRESHOLD).length,
          outOfStockCount: onSale.filter((p) => p.stock <= 0).length,
        },
        statusSplit: countBy(ranged.map((o) => o.status)),
        paymentSplit: {
          pendingMinor: sumOf(sold.filter((o) => o.paymentStatus === 'pending')),
          pendingCount: sold.filter((o) => o.paymentStatus === 'pending').length,
          collectedMinor: sumOf(sold.filter((o) => o.paymentStatus === 'collected')),
          collectedCount: sold.filter((o) => o.paymentStatus === 'collected').length,
        },
        deliveryZones: DELIVERY_ZONES.map((zone) => {
          const inZone = sold.filter((o) => o.deliveryZone === zone);
          return { zone, orderCount: inZone.length, revenueMinor: sumOf(inZone) };
        }),
        salesByCategory: tally((id) => productOf(id)?.categoryId)
          .sort(([, a], [, b]) => b.revenue - a.revenue)
          .slice(0, 10)
          .map(([categoryId, entry]) => ({
            categoryId,
            categoryName: this.categories.find((c) => c.id === categoryId)?.name ?? 'Uncategorised',
            unitsSold: entry.units,
            revenueMinor: entry.revenue,
          })),
        topProducts: tally((id) => id)
          .sort(([, a], [, b]) => b.units - a.units)
          .slice(0, 10)
          .map(([productId, entry]) => ({
            productId,
            productName: productOf(productId)?.name ?? productId,
            unitsSold: entry.units,
            revenueMinor: entry.revenue,
          })),
        heatmap: [...cells.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour),
        funnel: { carts: 0, checkouts: 0, orders: ranged.length },
        rates: {
          fulfillment: sold.length === 0 ? null : delivered / sold.length,
          returns: delivered === 0 ? null : 0,
        },
        monthTarget: {
          month,
          targetMinor: this.salesTarget.targetMinor,
          revenueMinor: sumOf(
            this.orders.filter(
              (o) => o.status !== 'cancelled' && dhakaDay(o.placedAt).slice(0, 7) === month,
            ),
          ),
        },
        topCustomers: this.has(accessToken, 'customers.read')
          ? customerIds
              .map((id) => {
                const own = sold.filter((o) => o.customer.id === id);
                const user = users.find((candidate) => candidate.id === id);
                return {
                  customerId: id,
                  name: user?.profile?.fullName ?? null,
                  email: user?.email ?? null,
                  orderCount: own.length,
                  revenueMinor: sumOf(own),
                  daily: days.map((day) => sumOf(own.filter((o) => dhakaDay(o.placedAt) === day))),
                };
              })
              .sort((a, b) => b.revenueMinor - a.revenueMinor)
              .slice(0, 10)
          : null,
      };
      return Promise.resolve(overview);
    },

    /**
     * The fake mirrors the database function's rules: the population includes cancelled
     * orders, the demand population does not, the location comes from the order's own
     * snapshot, and anything outside the reference pairs is reported as unmapped.
     */
    orderGeography: (accessToken, _userId, { from, to, division, district, status, metric }) => {
      this.enter('orderGeography');
      this.require(accessToken, 'finance.read');
      const days = daysOf(from, to);
      if (days.length < 1 || days.length > ANALYTICS_MAX_DAYS) raise('NZ412');
      if (metric !== 'orders' && metric !== 'revenue' && metric !== 'delivered') raise('NZ412');
      if (status !== undefined && !FAKE_ORDER_STATUSES.includes(status)) raise('NZ412');

      let placedIn = division;
      if (district !== undefined) {
        const known = FAKE_DISTRICTS.get(district);
        if (!known) raise('NZ412');
        if (division !== undefined && division !== known) raise('NZ412');
        placedIn = known;
      } else if (division !== undefined && !FAKE_DIVISIONS.some((name) => name === division)) {
        raise('NZ412');
      }

      const ranged = this.orders.filter(
        (order) =>
          dhakaDay(order.placedAt) >= from &&
          dhakaDay(order.placedAt) <= to &&
          (placedIn === undefined || order.shippingAddress.division === placedIn) &&
          (district === undefined || order.shippingAddress.district === district) &&
          (status === undefined || order.status === status),
      );
      const eligible = ranged.filter((order) => order.status !== 'cancelled');
      const mapped = (order: FakeAdminOrder) =>
        FAKE_DISTRICTS.get(order.shippingAddress.district) === order.shippingAddress.division;
      const mappedOrders = eligible.filter((order) => mapped(order));
      const unmappedOrders = eligible.filter((order) => !mapped(order));

      const group = (key: (order: FakeAdminOrder) => string) => {
        const totals = new Map<string, { orders: number; delivered: number; revenue: number }>();
        for (const order of mappedOrders) {
          const id = key(order);
          const entry = totals.get(id) ?? { orders: 0, delivered: 0, revenue: 0 };
          entry.orders += 1;
          entry.delivered += order.status === 'delivered' ? 1 : 0;
          entry.revenue += order.totalMinor;
          totals.set(id, entry);
        }
        return totals;
      };
      const byDistrict = group((order) => order.shippingAddress.district);
      const byDivision = group((order) => order.shippingAddress.division);
      const revenue = eligible.reduce((sum, order) => sum + order.totalMinor, 0);
      const share = (part: number) =>
        mappedOrders.length === 0 ? null : part / mappedOrders.length;
      const delivered = ranged.filter((order) => order.status === 'delivered').length;
      const badValues = new Map<string, { division: string; orders: number; revenue: number }>();
      for (const order of unmappedOrders) {
        const key = order.shippingAddress.district;
        const entry = badValues.get(key) ?? {
          division: order.shippingAddress.division,
          orders: 0,
          revenue: 0,
        };
        entry.orders += 1;
        entry.revenue += order.totalMinor;
        badValues.set(key, entry);
      }

      const geography: OrderGeography = {
        generatedAt: new Date().toISOString(),
        timezone: 'Asia/Dhaka',
        filters: {
          from,
          to,
          division: placedIn ?? null,
          district: district ?? null,
          status: status ?? null,
          metric,
        },
        summary: {
          totalOrders: ranged.length,
          eligibleOrders: eligible.length,
          deliveredOrders: delivered,
          pendingOrders: ranged.filter((order) => order.status === 'pending').length,
          processingOrders: ranged.filter((order) => order.status === 'processing').length,
          shippedOrders: ranged.filter((order) => order.status === 'shipped').length,
          cancelledOrders: ranged.filter((order) => order.status === 'cancelled').length,
          returnedOrders: 0,
          revenueMinor: revenue,
          averageOrderMinor: eligible.length === 0 ? 0 : Math.round(revenue / eligible.length),
          deliveredRate: eligible.length === 0 ? null : delivered / eligible.length,
          mappedOrders: mappedOrders.length,
          unmappedOrders: unmappedOrders.length,
        },
        divisions: FAKE_DIVISIONS.map((name) => {
          const totals = byDivision.get(name);
          return {
            division: name,
            orderCount: totals?.orders ?? 0,
            deliveredCount: totals?.delivered ?? 0,
            revenueMinor: totals?.revenue ?? 0,
            share: share(totals?.orders ?? 0),
          };
        }),
        districts: [...FAKE_DISTRICTS.entries()].map(([name, divisionName]) => {
          const totals = byDistrict.get(name);
          return {
            district: name,
            division: divisionName,
            orderCount: totals?.orders ?? 0,
            deliveredCount: totals?.delivered ?? 0,
            revenueMinor: totals?.revenue ?? 0,
            share: share(totals?.orders ?? 0),
          };
        }),
        timeline: days.map((day) => {
          const placed = eligible.filter((order) => dhakaDay(order.placedAt) === day);
          return {
            day,
            orderCount: placed.length,
            deliveredCount: placed.filter((order) => order.status === 'delivered').length,
            revenueMinor: placed.reduce((sum, order) => sum + order.totalMinor, 0),
          };
        }),
        statusBreakdown: FAKE_ORDER_STATUSES.map((entry) => ({
          status: entry,
          count: ranged.filter((order) => order.status === entry).length,
        })).filter((entry) => entry.count > 0),
        unmapped: {
          orderCount: unmappedOrders.length,
          revenueMinor: unmappedOrders.reduce((sum, order) => sum + order.totalMinor, 0),
          missingDistrictCount: unmappedOrders.filter(
            (order) => order.shippingAddress.district === '',
          ).length,
          unknownDistrictCount: unmappedOrders.filter(
            (order) => order.shippingAddress.district !== '',
          ).length,
          values: [...badValues.entries()]
            .map(([name, entry]) => ({
              district: name,
              division: entry.division,
              orderCount: entry.orders,
            }))
            .sort((a, b) => b.orderCount - a.orderCount)
            .slice(0, 10),
        },
      };
      return Promise.resolve(geography);
    },

    setSalesTarget: (accessToken, _userId, targetMinor) => {
      this.enter('setSalesTarget');
      const actor = this.require(accessToken, 'settings.manage');
      if (targetMinor !== null && (targetMinor < 0 || targetMinor > 100_000_000_000)) {
        raise('NZ412');
      }
      const before = this.salesTarget.targetMinor;
      this.salesTarget = { targetMinor, updatedAt: this.now() };
      this.record(actor, 'settings.sales_target_changed', 'store_settings', 'settings', {
        before,
        after: targetMinor,
      });
      return Promise.resolve({ ...this.salesTarget });
    },

    deliveryCharges: () => {
      this.enter('deliveryCharges');
      return Promise.resolve([this.charge('inside_dhaka'), this.charge('outside_dhaka')]);
    },

    storeSettings: (accessToken) => {
      this.enter('storeSettings');
      this.require(accessToken, 'settings.manage');
      return Promise.resolve({
        ...this.settings,
        monthlySalesTargetMinor: this.salesTarget.targetMinor,
        updatedAt: this.now(),
      });
    },

    saveStoreSettings: (accessToken, _userId, input) => {
      this.enter('saveStoreSettings');
      const actor = this.require(accessToken, 'settings.manage');
      const within = (value: number | undefined, min: number, max: number) =>
        value === undefined || (Number.isInteger(value) && value >= min && value <= max);
      // Everything is checked before anything is saved, as the single database function does.
      if (
        !within(input.returnWindowDays, 1, 90) ||
        !within(input.cartInactivityMinutes, 15, 10_080) ||
        !within(input.repeatOrderThreshold, 2, 20) ||
        !within(input.highSpendThresholdMinor, 1, 1_000_000_000) ||
        !within(input.inactiveDays, 7, 730)
      ) {
        raise('NZ412');
      }
      this.settings = {
        ...this.settings,
        returnWindowDays: input.returnWindowDays,
        cartInactivityMinutes: input.cartInactivityMinutes,
        repeatOrderThreshold: input.repeatOrderThreshold ?? this.settings.repeatOrderThreshold,
        highSpendThresholdMinor:
          input.highSpendThresholdMinor ?? this.settings.highSpendThresholdMinor,
        inactiveDays: input.inactiveDays ?? this.settings.inactiveDays,
      };
      this.record(actor, 'settings.saved', 'store_settings', 'settings');
      if (
        input.repeatOrderThreshold !== undefined ||
        input.highSpendThresholdMinor !== undefined ||
        input.inactiveDays !== undefined
      ) {
        this.record(actor, 'settings.insight_thresholds_saved', 'store_settings', 'settings');
      }
      return Promise.resolve({
        ...this.settings,
        monthlySalesTargetMinor: this.salesTarget.targetMinor,
        updatedAt: this.now(),
      });
    },

    setDeliveryCharge: (accessToken, _userId, zone, amountMinor) => {
      this.enter('setDeliveryCharge');
      const actor = this.require(accessToken, 'settings.manage');
      if (amountMinor < 0 || amountMinor > 10_000_000) raise('NZ412');
      this.deliveryCharges.set(zone, { amountMinor, updatedAt: this.now() });
      this.record(actor, 'settings.delivery_charge_changed', 'delivery_zone', zone);
      return Promise.resolve(this.charge(zone));
    },

    orderCounts: (accessToken) => {
      this.enter('orderCounts');
      const visible = this.visibleOrders(accessToken);
      const count = (status: OrderStatus) => visible.filter((o) => o.status === status).length;
      return Promise.resolve({
        pending: count('pending'),
        confirmed: count('confirmed'),
        processing: count('processing'),
        shipped: count('shipped'),
        awaitingCollection: visible.filter(
          (o) => o.status === 'delivered' && o.paymentStatus === 'pending',
        ).length,
      });
    },

    lowStock: (accessToken) => {
      this.enter('lowStock');
      const low = this.visibleProducts(accessToken)
        .filter((p) => p.status === 'active' && p.stock <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.stock - b.stock);
      return Promise.resolve({
        lowStockCount: low.length,
        products: low
          .slice(0, 10)
          .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stockQuantity: p.stock })),
      });
    },

    reviewCounts: (accessToken, _userId, callerId) => {
      this.enter('reviewCounts');
      const pending = this.visibleTasks(accessToken).filter((t) => t.status === 'pending');
      return Promise.resolve({
        assignedToMe: pending.filter((t) => t.assignedTo === callerId).length,
        unassigned: pending.filter((t) => t.assignedTo === null).length,
        pending: pending.length,
      });
    },
  };

  /**
   * Coupons, with the same rules the SQL enforces: a unique code, a forward time
   * window, percentages at most 100, no cap on a fixed discount, and a state derived
   * from the window, the switch and the total limit.
   */
  readonly coupons: AdminCouponStore = {
    list: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('coupons.list');
      this.visible(accessToken);
      const search = (filters.q ?? '').trim().toUpperCase();
      const rows = this.couponRows
        .filter((coupon) => search === '' || coupon.code.includes(search))
        .filter(
          (coupon) => !filters.state || filters.state === 'all' || coupon.state === filters.state,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return Promise.resolve({
        coupons: rows.slice(offset, offset + limit),
        total: rows.length,
      });
    },

    get: (accessToken, _userId, couponId) => {
      this.enter('coupons.get');
      this.visible(accessToken);
      return Promise.resolve(this.couponRows.find((coupon) => coupon.id === couponId) ?? null);
    },

    save: (accessToken, _userId, couponId, input) => {
      this.enter('coupons.save');
      // As admin_save_coupon: a new coupon needs coupons.create, a change needs coupons.update.
      if (couponId === null) {
        if (!this.has(accessToken, 'coupons.create')) raise('NZ403');
      } else {
        this.visible(accessToken);
      }
      const code = input.code.toUpperCase();
      if (this.couponRows.some((coupon) => coupon.code === code && coupon.id !== couponId)) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ458', message: 'duplicate' }, 'admin_save_coupon'),
        );
      }
      if (
        (input.kind === 'percent' && input.value > 100) ||
        (input.kind === 'fixed' && (input.maxDiscountMinor ?? null) !== null)
      ) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ412', message: 'invalid' }, 'admin_save_coupon'),
        );
      }
      if (couponId === null) {
        const created = this.addCoupon(input, code);
        return Promise.resolve(created.id);
      }
      const index = this.couponRows.findIndex((coupon) => coupon.id === couponId);
      if (index === -1) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ404', message: 'missing' }, 'admin_save_coupon'),
        );
      }
      const previous = this.couponRows[index];
      if (!previous) throw new Error('coupon index drifted');
      // As admin_save_coupon (20261204200000): a redeemed coupon keeps its code and discount.
      const cap = input.kind === 'percent' ? (input.maxDiscountMinor ?? null) : null;
      if (
        previous.redemptionCount > 0 &&
        (previous.code !== code ||
          previous.kind !== input.kind ||
          previous.value !== input.value ||
          previous.maxDiscountMinor !== cap)
      ) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ442', message: 'redeemed' }, 'admin_save_coupon'),
        );
      }
      this.couponRows[index] = this.couponFrom(input, code, previous);
      return Promise.resolve(couponId);
    },

    remove: (accessToken, _userId, couponId) => {
      this.enter('coupons.remove');
      this.visible(accessToken);
      const index = this.couponRows.findIndex((coupon) => coupon.id === couponId);
      if (index === -1) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ404', message: 'missing' }, 'admin_delete_coupon'),
        );
      }
      if ((this.couponRows[index]?.redemptionCount ?? 0) > 0) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ442', message: 'used' }, 'admin_delete_coupon'),
        );
      }
      this.couponRows.splice(index, 1);
      return Promise.resolve();
    },

    setActive: (accessToken, _userId, couponId, isActive) => {
      this.enter('coupons.setActive');
      this.visible(accessToken);
      const index = this.couponRows.findIndex((coupon) => coupon.id === couponId);
      if (index === -1) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ404', message: 'missing' }, 'admin_set_coupon_active'),
        );
      }
      const previous = this.couponRows[index];
      if (!previous) throw new Error('coupon index drifted');
      this.couponRows[index] = {
        ...previous,
        isActive,
        state: this.stateOf({ ...previous, isActive }),
      };
      return Promise.resolve();
    },

    redemptions: (accessToken, _userId, couponId, { limit, offset }) => {
      this.enter('coupons.redemptions');
      this.visible(accessToken);
      const rows = this.redemptionRows
        .filter((row) => row.couponId === couponId)
        .sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));
      return Promise.resolve({
        redemptions: rows
          .slice(offset, offset + limit)
          .map(({ couponId: _ignored, ...rest }) => rest),
        total: rows.length,
      });
    },
  };

  /** Coupon rows as the store keeps them; tests may add or inspect them directly. */
  readonly couponRows: AdminCoupon[] = [];
  readonly redemptionRows: (CouponRedemption & { couponId: string })[] = [];

  private visible(accessToken: string): void {
    if (!this.has(accessToken, 'coupons.update')) raise('NZ403');
  }

  private stateOf(coupon: AdminCoupon): CouponState {
    const now = Date.now();
    if (!coupon.isActive) return 'inactive';
    if (coupon.startsAt !== null && Date.parse(coupon.startsAt) > now) return 'scheduled';
    if (coupon.endsAt !== null && Date.parse(coupon.endsAt) <= now) return 'expired';
    if (coupon.totalLimit !== null && coupon.redemptionCount >= coupon.totalLimit)
      return 'exhausted';
    return 'active';
  }

  private couponFrom(input: CouponSaveRequest, code: string, previous?: AdminCoupon): AdminCoupon {
    const now = new Date().toISOString();
    const base: AdminCoupon = {
      id: previous?.id ?? randomUUID(),
      code,
      description: input.description ?? null,
      kind: input.kind,
      value: input.value,
      minOrderMinor: input.minOrderMinor ?? 0,
      maxDiscountMinor: input.kind === 'percent' ? (input.maxDiscountMinor ?? null) : null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      totalLimit: input.totalLimit ?? null,
      perCustomerLimit: input.perCustomerLimit ?? 1,
      isActive: input.isActive ?? true,
      state: 'active',
      redemptionCount: previous?.redemptionCount ?? 0,
      totalDiscountMinor: previous?.totalDiscountMinor ?? 0,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    return { ...base, state: this.stateOf(base) };
  }

  private addCoupon(input: CouponSaveRequest, code: string): AdminCoupon {
    const created = this.couponFrom(input, code);
    this.couponRows.push(created);
    return created;
  }

  /** Records a redemption, as the order transaction would, and updates its figures. */
  recordRedemption(couponId: string, redemption: CouponRedemption): void {
    this.redemptionRows.push({ ...redemption, couponId });
    const index = this.couponRows.findIndex((coupon) => coupon.id === couponId);
    const previous = this.couponRows[index];
    if (index === -1 || !previous) return;
    const next: AdminCoupon = {
      ...previous,
      redemptionCount: previous.redemptionCount + 1,
      totalDiscountMinor: previous.totalDiscountMinor + redemption.discountMinor,
    };
    this.couponRows[index] = { ...next, state: this.stateOf(next) };
  }

  /**
   * Product reviews: the public read returns approved rows only, submission and
   * moderation follow the SQL rules (eligibility, one per customer, no self-moderation).
   */
  readonly reviewRows: AdminReview[] = [];
  /** Votes recorded through the fake, so a test can assert one-per-account behaviour. */
  readonly reviewVotes: { reviewId: string; voterId: string; helpful: boolean }[] = [];
  readonly reviews: ReviewStore = {
    publicForProduct: (slug, { limit, offset }) => {
      this.enter('reviews.publicForProduct');
      const approved = this.reviewRows.filter(
        (review) => review.productSlug === slug && review.status === 'approved',
      );
      const count = approved.length;
      const average =
        count === 0
          ? 0
          : Math.round((approved.reduce((sum, r) => sum + r.rating, 0) / count) * 100) / 100;
      const distribution: Record<string, number> = {};
      for (const star of ['1', '2', '3', '4', '5']) {
        distribution[star] = approved.filter((r) => String(r.rating) === star).length;
      }
      return Promise.resolve({
        summary: { averageRating: average, reviewCount: count, distribution },
        reviews: approved.slice(offset, offset + limit).map((review) => ({
          id: review.id,
          rating: review.rating,
          title: review.title,
          body: review.body,
          authorName: review.authorName ?? 'Customer',
          verified: true,
          images: [],
          createdAt: review.createdAt,
          reply: review.reply ?? null,
          helpfulCount: this.reviewVotes.filter((vote) => vote.reviewId === review.id).length,
          notHelpfulCount: 0,
          viewerVote: null,
        })),
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
        total: count,
        totalPages: count === 0 ? 0 : Math.ceil(count / limit),
      });
    },

    myReview: (accessToken, userId) => {
      this.enter('reviews.myReview');
      this.caller(accessToken);
      const review = this.reviewRows.find((row) => row.authorId === userId);
      return Promise.resolve({
        eligible: true,
        review:
          review === undefined
            ? null
            : {
                id: review.id,
                rating: review.rating,
                title: review.title,
                body: review.body,
                status: review.status,
                moderationNote: review.moderationNote,
                images: [],
                createdAt: review.createdAt,
                updatedAt: review.createdAt,
              },
      });
    },

    submit: (accessToken, userId, productId, input) => {
      this.enter('reviews.submit');
      this.caller(accessToken);
      if (this.reviewRows.some((row) => row.authorId === userId && row.productId === productId)) {
        return Promise.reject(new ReviewRefusalError('review_duplicate'));
      }
      const id = randomUUID();
      this.reviewRows.push({
        id,
        productId,
        productName: 'Product',
        productSlug: 'product',
        authorId: userId,
        authorName: 'Customer',
        authorEmail: null,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        status: 'pending',
        moderatedAt: null,
        moderationNote: null,
        images: [],
        createdAt: new Date().toISOString(),
        reply: null,
        helpfulCount: 0,
        notHelpfulCount: 0,
        viewerVote: null,
      });
      return Promise.resolve(id);
    },

    list: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('reviews.list');
      if (!this.has(accessToken, 'reviews.moderate')) raise('NZ403');
      const rows = this.reviewRows.filter(
        (row) => !filters.status || filters.status === 'all' || row.status === filters.status,
      );
      return Promise.resolve({ reviews: rows.slice(offset, offset + limit), total: rows.length });
    },

    moderate: (accessToken, userId, reviewId, input) => {
      this.enter('reviews.moderate');
      if (!this.has(accessToken, 'reviews.moderate')) raise('NZ403');
      const row = this.reviewRows.find((review) => review.id === reviewId);
      if (!row)
        return Promise.reject(
          toAdminStoreError(
            { code: 'NZ404', message: 'missing' },
            'admin_set_product_review_status',
          ),
        );
      if (row.authorId === userId) return Promise.reject(new ReviewRefusalError('review_own'));
      row.status = input.status;
      row.moderationNote = input.note ?? null;
      row.moderatedAt = new Date().toISOString();
      return Promise.resolve();
    },

    /** The customer's delivered lines without a review; the fake keeps none of its own. */
    reviewable: (accessToken, userId) => {
      this.enter('reviews.reviewable');
      this.caller(accessToken);
      void userId;
      return Promise.resolve([]);
    },

    /** Nothing to ask: the fake keeps no delivered lines. */
    reviewPrompt: (accessToken, userId) => {
      this.enter('reviews.reviewPrompt');
      this.caller(accessToken);
      void userId;
      return Promise.resolve(null);
    },

    dismissReviewPrompt: (accessToken, userId, productId) => {
      this.enter('reviews.dismissReviewPrompt');
      this.caller(accessToken);
      void userId;
      void productId;
      return Promise.resolve();
    },

    reply: (accessToken, _userId, reviewId, body) => {
      this.enter('reviews.reply');
      if (!this.has(accessToken, 'reviews.reply')) raise('NZ403');
      const row = this.reviewRows.find((review) => review.id === reviewId);
      if (!row)
        return Promise.reject(
          toAdminStoreError({ code: 'NZ404', message: 'missing' }, 'admin_reply_to_review'),
        );
      if (row.status === 'rejected') {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ412', message: 'refused' }, 'admin_reply_to_review'),
        );
      }
      const at = new Date().toISOString();
      row.reply = {
        body,
        authorName: 'Nilzora',
        createdAt: row.reply?.createdAt ?? at,
        updatedAt: at,
      };
      return Promise.resolve(row.reply);
    },

    clearReply: (accessToken, _userId, reviewId) => {
      this.enter('reviews.clearReply');
      if (!this.has(accessToken, 'reviews.reply')) raise('NZ403');
      const row = this.reviewRows.find((review) => review.id === reviewId);
      if (!row) {
        return Promise.reject(
          toAdminStoreError({ code: 'NZ404', message: 'missing' }, 'admin_clear_review_reply'),
        );
      }
      row.reply = null;
      return Promise.resolve();
    },

    /** One vote per account per review, and never on one's own review — the database's rules. */
    vote: (accessToken, userId, reviewId, verdict) => {
      this.enter('reviews.vote');
      this.caller(accessToken);
      const row = this.reviewRows.find((review) => review.id === reviewId);
      if (!row)
        return Promise.reject(
          toStoreError({ code: 'NZ404', message: 'missing' }, 'vote_product_review'),
        );
      if (row.status !== 'approved') {
        return Promise.reject(
          toStoreError({ code: 'NZ412', message: 'refused' }, 'vote_product_review'),
        );
      }
      if (row.authorId === userId) {
        return Promise.reject(
          toStoreError({ code: 'NZ465', message: 'own review' }, 'vote_product_review'),
        );
      }
      const index = this.reviewVotes.findIndex(
        (vote) => vote.reviewId === reviewId && vote.voterId === userId,
      );
      if (verdict === null) {
        if (index >= 0) this.reviewVotes.splice(index, 1);
      } else if (index >= 0) {
        const existing = this.reviewVotes[index];
        if (existing !== undefined) existing.helpful = verdict === 'helpful';
      } else {
        this.reviewVotes.push({ reviewId, voterId: userId, helpful: verdict === 'helpful' });
      }
      const mine = this.reviewVotes.filter((vote) => vote.reviewId === reviewId);
      const own = mine.find((vote) => vote.voterId === userId);
      return Promise.resolve({
        reviewId,
        helpfulCount: mine.filter((vote) => vote.helpful).length,
        notHelpfulCount: mine.filter((vote) => !vote.helpful).length,
        viewerVote: own === undefined ? null : own.helpful ? 'helpful' : 'not_helpful',
      });
    },
  };

  /** The admin_*_media functions: reads need settings.manage or products.update. */
  readonly mediaLibrary: MediaLibraryStore = {
    list: (accessToken, _userId, search, { page, pageSize }) => {
      this.enter('media.list');
      this.caller(accessToken);
      if (!this.has(accessToken, 'settings.manage') && !this.has(accessToken, 'products.update')) {
        raise('NZ403');
      }
      const term = search?.toLowerCase();
      const matching = [...this.mediaAssets]
        .reverse()
        .filter(
          (asset) =>
            term === undefined ||
            [asset.alt, asset.originalName].some((text) => text?.toLowerCase().includes(term)),
        );
      return Promise.resolve({
        assets: matching.slice((page - 1) * pageSize, page * pageSize).map((a) => ({ ...a })),
        total: matching.length,
      });
    },

    record: (accessToken, _userId, input) => {
      this.enter('media.record');
      const actor = this.require(accessToken, 'settings.manage');
      if (input.alt !== null && input.alt.length > 250) raise('NZ412');
      const user = this.identity.userFor(accessToken);
      const asset: StoredMediaAsset = {
        id: input.id,
        key: `library/${input.id}`,
        fullKey: `library/${input.id}/full.webp`,
        thumbKey: `library/${input.id}/thumb.webp`,
        contentType: input.contentType,
        width: input.width,
        height: input.height,
        bytes: input.bytes,
        alt: input.alt,
        originalName: input.originalName,
        uploadedBy: {
          id: actor,
          name: user?.profile?.fullName ?? null,
          email: user?.email ?? null,
        },
        createdAt: this.now(),
      };
      this.mediaAssets.push(asset);
      this.record(actor, 'media.uploaded', 'media_asset', input.id);
      return Promise.resolve({ ...asset });
    },

    updateAlt: (accessToken, _userId, id, alt) => {
      this.enter('media.updateAlt');
      const actor = this.require(accessToken, 'settings.manage');
      const asset = this.mediaAssets.find((candidate) => candidate.id === id);
      if (!asset) raise('NZ404');
      const trimmed = alt?.trim() ?? '';
      if (trimmed.length > 250) raise('NZ412');
      asset.alt = trimmed === '' ? null : trimmed;
      this.record(actor, 'media.alt_changed', 'media_asset', id);
      return Promise.resolve({ ...asset });
    },

    remove: (accessToken, _userId, id) => {
      this.enter('media.remove');
      const actor = this.require(accessToken, 'settings.manage');
      const asset = this.mediaAssets.find((candidate) => candidate.id === id);
      if (!asset) raise('NZ404');
      if (this.mediaInUse.has(asset.key)) raise('NZ442');
      this.mediaAssets.splice(this.mediaAssets.indexOf(asset), 1);
      this.record(actor, 'media.deleted', 'media_asset', id);
      return Promise.resolve([asset.fullKey, asset.thumbKey]);
    },
  };

  /** campaigns rows, oldest first. */
  readonly campaigns: FakeCampaign[] = [];

  private campaignState(campaign: FakeCampaign): CampaignState {
    if (campaign.status === 'draft') return 'draft';
    if (campaign.status === 'archived') return 'archived';
    if (campaign.status === 'ended') return 'ended';
    if (campaign.status === 'paused') return 'paused';
    const now = this.now();
    if (campaign.startsAt !== null && now < campaign.startsAt) return 'scheduled';
    if (campaign.endsAt !== null && now >= campaign.endsAt) return 'expired';
    return 'active';
  }

  /** The categories a product sits in, plus every ancestor (categories are three deep). */
  /** Whether `categoryId` is `rootId` itself or sits anywhere beneath it. */
  private inBranch(categoryId: string, rootId: string): boolean {
    let cursor: string | null = categoryId;
    for (let depth = 0; cursor !== null && depth < 4; depth += 1) {
      if (cursor === rootId) return true;
      cursor = this.categories.find((c) => c.id === cursor)?.parentId ?? null;
    }
    return false;
  }

  private ancestryOf(categoryId: string): string[] {
    const ids: string[] = [];
    let current: string | null = categoryId;
    for (let depth = 0; current !== null && depth < 4; depth += 1) {
      ids.push(current);
      current = this.categories.find((category) => category.id === current)?.parentId ?? null;
    }
    return ids;
  }

  private campaignReaches(campaign: FakeCampaign, product: FakeAdminProduct): boolean {
    if (campaign.scope === 'storewide') return true;
    if (campaign.scope === 'products') return campaign.productIds.includes(product.id);
    if (campaign.scope === 'categories') {
      const ancestry = this.ancestryOf(product.categoryId);
      return campaign.categoryIds.some((id) => ancestry.includes(id));
    }
    return false;
  }

  private campaignProducts(campaign: FakeCampaign): FakeAdminProduct[] {
    return this.products
      .filter((product) => this.campaignReaches(campaign, product))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  private campaignView(campaign: FakeCampaign): AdminCampaign {
    return {
      id: campaign.id,
      name: campaign.name,
      customerTitle: campaign.customerTitle,
      internalNotes: campaign.internalNotes,
      scope: campaign.scope,
      discountKind: campaign.discountKind,
      discountValue: campaign.discountValue,
      maxDiscountMinor: campaign.maxDiscountMinor,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      status: campaign.status,
      state: this.campaignState(campaign),
      priority: campaign.priority,
      isVisible: campaign.isVisible,
      bannerImageKey: campaign.bannerImageKey,
      banner: null,
      couponPolicy: campaign.couponPolicy,
      version: campaign.version,
      productCount: this.campaignProducts(campaign).filter((row) => row.status === 'active').length,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      endedAt: campaign.endedAt,
    };
  }

  private campaignDetail(campaign: FakeCampaign): AdminCampaignDetail {
    const refs = (ids: readonly string[], pool: { id: string; slug: string; name: string }[]) =>
      ids.flatMap((id) => {
        const found = pool.find((row) => row.id === id);
        return found ? [{ id: found.id, slug: found.slug, name: found.name }] : [];
      });
    return {
      ...this.campaignView(campaign),
      categories: refs(campaign.categoryIds, this.categories),
      // A product in this fake carries no brand row, so brand targets have no name here.
      brands: [],
      products: refs(
        campaign.productIds,
        this.products.map((product) => ({
          id: product.id,
          slug: product.slug,
          name: product.name,
        })),
      ),
    };
  }

  /** The fake's campaign_discount(): poisha off a price, capped and never negative. */
  private campaignDiscount(
    priceMinor: number,
    kind: CampaignDiscountKind,
    value: number,
    capMinor: number | null,
  ): number {
    const raw =
      kind === 'fixed'
        ? value
        : Math.min(Math.floor((priceMinor * value) / 100), capMinor ?? priceMinor);
    return Math.max(0, Math.min(priceMinor - 1, raw));
  }

  private campaignPreview(
    scope: CampaignScope,
    discountKind: CampaignDiscountKind,
    discountValue: number,
    maxDiscountMinor: number | null,
    categoryIds: readonly string[],
    productIds: readonly string[],
    page: { page: number; pageSize: number },
  ): CampaignPreviewResponse {
    const staging: FakeCampaign = {
      id: '00000000-0000-4000-8000-000000000000',
      name: '',
      customerTitle: '',
      internalNotes: null,
      scope,
      discountKind,
      discountValue,
      maxDiscountMinor,
      startsAt: null,
      endsAt: null,
      status: 'active',
      priority: 0,
      isVisible: true,
      bannerImageKey: null,
      couponPolicy: 'stackable',
      version: 1,
      categoryIds: [...categoryIds],
      brandIds: [],
      productIds: [...productIds],
      createdAt: '',
      updatedAt: '',
      endedAt: null,
    };
    const reached = this.campaignProducts(staging);
    const rows = reached
      .slice((page.page - 1) * page.pageSize, page.page * page.pageSize)
      .map((product) => {
        const listMinor = product.compareAtPriceMinor ?? product.priceMinor;
        const campaignPriceMinor =
          listMinor -
          this.campaignDiscount(listMinor, discountKind, discountValue, maxDiscountMinor);
        return {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          sku: product.sku,
          categoryName:
            this.categories.find((category) => category.id === product.categoryId)?.name ?? '',
          status: product.status,
          regularPriceMinor: listMinor,
          productPriceMinor: product.priceMinor,
          campaignPriceMinor,
          campaignDiscountMinor: listMinor - campaignPriceMinor,
          overridesProductDiscount: listMinor > product.priceMinor,
          governedBy: null,
          wins: true,
        };
      });
    return {
      products: rows,
      page: page.page,
      pageSize: page.pageSize,
      total: reached.length,
      totalPages: Math.ceil(reached.length / page.pageSize),
      activeTotal: reached.filter((product) => product.status === 'active').length,
    };
  }

  /**
   * Discount campaigns, with the rules the SQL enforces: an open name, a forward time
   * window, percentages at most 100, a cap only on a percentage, targets that match the
   * scope, a stale version refused, and the permission each transition needs.
   */
  readonly discounts: AdminDiscountStore = {
    list: (accessToken, _userId, filters, { limit, offset }) => {
      this.enter('discounts.list');
      this.require(accessToken, 'discounts.view');
      const search = (filters.q ?? '').trim().toLowerCase();
      const rows = this.campaigns
        .filter(
          (campaign) =>
            search === '' ||
            campaign.name.toLowerCase().includes(search) ||
            campaign.customerTitle.toLowerCase().includes(search),
        )
        .filter(
          (campaign) =>
            !filters.state ||
            filters.state === 'all' ||
            this.campaignState(campaign) === filters.state,
        )
        .filter(
          (campaign) =>
            !filters.scope || filters.scope === 'all' || campaign.scope === filters.scope,
        )
        .map((campaign) => this.campaignView(campaign))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return Promise.resolve({ campaigns: rows.slice(offset, offset + limit), total: rows.length });
    },

    get: (accessToken, _userId, campaignId) => {
      this.enter('discounts.get');
      this.require(accessToken, 'discounts.view');
      const campaign = this.campaigns.find((candidate) => candidate.id === campaignId);
      return Promise.resolve(campaign ? this.campaignDetail(campaign) : null);
    },

    save: (accessToken, _userId, campaignId, input) => {
      this.enter('discounts.save');
      this.require(accessToken, campaignId === null ? 'discounts.create' : 'discounts.edit');
      if (input.discountKind === 'percent' && input.discountValue > 100) raise('NZ491');
      if (input.discountKind === 'fixed' && (input.maxDiscountMinor ?? null) !== null)
        raise('NZ491');
      if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
        raise('NZ491');
      }
      const targets =
        input.scope === 'categories'
          ? (input.categoryIds ?? [])
          : input.scope === 'products'
            ? (input.productIds ?? [])
            : [];
      if (input.scope !== 'storewide' && targets.length === 0) raise('NZ491');
      if (
        this.campaigns.some(
          (campaign) =>
            campaign.id !== campaignId &&
            campaign.name.toLowerCase() === input.name.trim().toLowerCase() &&
            campaign.status !== 'archived' &&
            campaign.status !== 'ended',
        )
      ) {
        raise('NZ491');
      }

      const existing = this.campaigns.find((candidate) => candidate.id === campaignId);
      if (campaignId !== null) {
        if (!existing) raise('NZ490');
        if (existing.status === 'archived') raise('NZ491');
        if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
          raise('NZ492');
        }
        if ((input.priority ?? 0) !== existing.priority) {
          this.require(accessToken, 'discounts.manage_priority');
        }
        if ((input.couponPolicy ?? 'stackable') !== existing.couponPolicy) {
          this.require(accessToken, 'discounts.manage_coupon_policy');
        }
        Object.assign(existing, {
          name: input.name.trim(),
          customerTitle: input.customerTitle.trim(),
          internalNotes: input.internalNotes ?? null,
          scope: input.scope,
          discountKind: input.discountKind,
          discountValue: input.discountValue,
          maxDiscountMinor:
            input.discountKind === 'percent' ? (input.maxDiscountMinor ?? null) : null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          priority: input.priority ?? 0,
          isVisible: input.isVisible ?? true,
          bannerImageKey: input.bannerImageKey ?? null,
          couponPolicy: input.couponPolicy ?? 'stackable',
          categoryIds: [...(input.categoryIds ?? [])],
          brandIds: [...(input.brandIds ?? [])],
          productIds: [...(input.productIds ?? [])],
          version: existing.version + 1,
          updatedAt: this.now(),
        });
        return Promise.resolve(this.campaignDetail(existing));
      }

      const created: FakeCampaign = {
        id: this.newId(),
        name: input.name.trim(),
        customerTitle: input.customerTitle.trim(),
        internalNotes: input.internalNotes ?? null,
        scope: input.scope,
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        maxDiscountMinor:
          input.discountKind === 'percent' ? (input.maxDiscountMinor ?? null) : null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        status: 'draft',
        priority: input.priority ?? 0,
        isVisible: input.isVisible ?? true,
        bannerImageKey: input.bannerImageKey ?? null,
        couponPolicy: input.couponPolicy ?? 'stackable',
        version: 1,
        categoryIds: [...(input.categoryIds ?? [])],
        brandIds: [...(input.brandIds ?? [])],
        productIds: [...(input.productIds ?? [])],
        createdAt: this.now(),
        updatedAt: this.now(),
        endedAt: null,
      };
      this.campaigns.push(created);
      return Promise.resolve(this.campaignDetail(created));
    },

    setStatus: (accessToken, _userId, campaignId, status, expectedVersion) => {
      this.enter('discounts.setStatus');
      const permission: Record<CampaignStatus, Permission> = {
        draft: 'discounts.edit',
        scheduled: 'discounts.schedule',
        active: 'discounts.activate',
        paused: 'discounts.pause',
        ended: 'discounts.end',
        archived: 'discounts.archive',
      };
      this.require(accessToken, permission[status]);
      const campaign = this.campaigns.find((candidate) => candidate.id === campaignId);
      if (!campaign) raise('NZ490');
      if (campaign.status === 'archived' && status !== 'archived') raise('NZ491');
      if (campaign.status === 'ended' && status !== 'archived') raise('NZ491');
      if (expectedVersion !== null && expectedVersion !== campaign.version) raise('NZ492');
      campaign.status = status;
      campaign.version += 1;
      campaign.updatedAt = this.now();
      if (status === 'ended') campaign.endedAt = this.now();
      return Promise.resolve(this.campaignDetail(campaign));
    },

    duplicate: (accessToken, _userId, campaignId) => {
      this.enter('discounts.duplicate');
      this.require(accessToken, 'discounts.create');
      const source = this.campaigns.find((candidate) => candidate.id === campaignId);
      if (!source) raise('NZ490');
      const copy: FakeCampaign = {
        ...source,
        id: this.newId(),
        name: `${source.name} (copy)`.slice(0, 120),
        status: 'draft',
        version: 1,
        categoryIds: [...source.categoryIds],
        brandIds: [...source.brandIds],
        productIds: [...source.productIds],
        createdAt: this.now(),
        updatedAt: this.now(),
        endedAt: null,
      };
      this.campaigns.push(copy);
      return Promise.resolve(this.campaignDetail(copy));
    },

    preview: (accessToken, _userId, input) => {
      this.enter('discounts.preview');
      this.require(accessToken, 'discounts.view');
      return Promise.resolve(
        this.campaignPreview(
          input.scope,
          input.discountKind,
          input.discountValue,
          input.maxDiscountMinor ?? null,
          input.categoryIds ?? [],
          input.productIds ?? [],
          { page: input.page ?? 1, pageSize: input.pageSize ?? 25 },
        ),
      );
    },

    products: (accessToken, _userId, campaignId, page) => {
      this.enter('discounts.products');
      this.require(accessToken, 'discounts.view');
      const campaign = this.campaigns.find((candidate) => candidate.id === campaignId);
      if (!campaign) raise('NZ490');
      return Promise.resolve(
        this.campaignPreview(
          campaign.scope,
          campaign.discountKind,
          campaign.discountValue,
          campaign.maxDiscountMinor,
          campaign.categoryIds,
          campaign.productIds,
          { page: Math.floor(page.offset / page.limit) + 1, pageSize: page.limit },
        ),
      );
    },

    conflicts: (accessToken, _userId, campaignId) => {
      this.enter('discounts.conflicts');
      this.require(accessToken, 'discounts.view');
      const campaign = this.campaigns.find((candidate) => candidate.id === campaignId);
      if (!campaign) raise('NZ490');
      const mine = new Set(this.campaignProducts(campaign).map((product) => product.id));
      const conflicts = this.campaigns
        .filter(
          (other) =>
            other.id !== campaignId && (other.status === 'active' || other.status === 'scheduled'),
        )
        .flatMap((other) => {
          const shared = this.campaignProducts(other).filter((product) => mine.has(product.id));
          if (shared.length === 0) return [];
          return [
            {
              campaignId: other.id,
              name: other.name,
              customerTitle: other.customerTitle,
              scope: other.scope,
              discountKind: other.discountKind,
              discountValue: other.discountValue,
              priority: other.priority,
              status: other.status,
              startsAt: other.startsAt,
              endsAt: other.endsAt,
              sharedProducts: shared.length,
            },
          ];
        });
      return Promise.resolve(conflicts);
    },

    history: (accessToken, _userId, campaignId, page) => {
      this.enter('discounts.history');
      this.require(accessToken, 'discounts.view');
      const entries = this.audit
        .filter(
          (entry) => entry.targetType === 'discount_campaign' && entry.targetId === campaignId,
        )
        .map((entry) => ({
          id: entry.id,
          action: entry.action,
          actorId: entry.actorId,
          actorName: null,
          actorEmail: null,
          details: entry.details,
          createdAt: entry.createdAt,
        }))
        .reverse();
      return Promise.resolve({
        entries: entries.slice((page.page - 1) * page.pageSize, page.page * page.pageSize),
        total: entries.length,
      });
    },

    categoryCampaigns: (accessToken, _userId, categoryIds) => {
      this.enter('discounts.categoryCampaigns');
      this.require(accessToken, 'discounts.view');
      const wanted =
        categoryIds === null ? this.categories.map((category) => category.id) : [...categoryIds];
      const rows = this.campaigns
        .filter((campaign) => campaign.status === 'active' || campaign.status === 'scheduled')
        .flatMap((campaign) =>
          wanted.flatMap((categoryId) => {
            const reached = this.campaignProducts(campaign).filter(
              (product) =>
                product.status === 'active' &&
                this.ancestryOf(product.categoryId).includes(categoryId),
            );
            if (reached.length === 0) return [];
            return [
              {
                categoryId,
                campaignId: campaign.id,
                customerTitle: campaign.customerTitle,
                scope: campaign.scope,
                discountKind: campaign.discountKind,
                discountValue: campaign.discountValue,
                startsAt: campaign.startsAt,
                endsAt: campaign.endsAt,
                status: campaign.status,
                productCount: reached.length,
              },
            ];
          }),
        );
      return Promise.resolve(rows);
    },
  };

  get stores(): AdminStores {
    return {
      mediaLibrary: this.mediaLibrary,
      exports: { reports: this.exports.reports, jobs: this.exports.jobStore },
      content: this.content,
      catalog: this.catalog,
      orders: this.ordersStore,
      accounts: this.accounts,
      moderation: this.moderation,
      reports: this.reports,
      coupons: this.coupons,
      discounts: this.discounts,
      reviews: this.reviews,
    };
  }
}
