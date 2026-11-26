import type {
  AdminCategory,
  AdminOrderDetail,
  AdminOrderSummary,
  AdminProductDetail,
  AdminProductSummary,
  AnalyticsOverview,
  MediaAsset,
  ModerationTaskDetail,
  ModerationTaskSummary,
  SalesOverview,
  StaffMember,
  StoreSettings,
} from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from './client';

const TOKEN = 'staff-access-token';
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const CATEGORY = 'ca000000-0000-4000-8000-000000000001';
const CUSTOMER = 'c0000000-0000-4000-8000-000000000001';
const STAFF = '5f000000-0000-4000-8000-000000000001';
const TASK = '7a000000-0000-4000-8000-000000000001';
const AT = '2026-10-25T08:00:00.000Z';

const category: AdminCategory = {
  id: CATEGORY,
  slug: 'home-kitchen',
  name: 'Home & Kitchen',
  description: null,
  sortOrder: 0,
  isActive: true,
  parentId: null,
  isFeatured: false,
  imageUrl: null,
  productCount: 1,
};

const productSummary: AdminProductSummary = {
  id: PRODUCT,
  slug: 'desk-lamp',
  sku: 'DESK-LAMP',
  name: 'Desk Lamp',
  summary: null,
  status: 'draft',
  moderationStatus: 'not_submitted',
  priceMinor: 10_000,
  compareAtPriceMinor: null,
  stockQuantity: 12,
  maxOrderQuantity: 5,
  isFeatured: false,
  category: { id: CATEGORY, slug: 'home-kitchen', name: 'Home & Kitchen', isActive: true },
  publishedAt: null,
  updatedAt: AT,
  image: null,
};

const product: AdminProductDetail = {
  ...productSummary,
  description: null,
  createdAt: AT,
  latestReview: null,
  images: [],
};

const orderSummary: AdminOrderSummary = {
  orderNumber: 'NZ100042',
  status: 'delivered',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 1,
  totalMinor: 16_000,
  placedAt: AT,
  customerId: CUSTOMER,
  recipientName: 'Rahima Khatun',
  phone: '+8801712345678',
  deliveryZone: 'inside_dhaka',
  preview: [],
  // The order contracts default these (no coupon on this order).
  discountMinor: 0,
  coupon: null,
  shipment: null,
};

const {
  shipment: _shipment,
  customerId: _customerId,
  recipientName: _name,
  phone: _phone,
  ...orderBasics
} = orderSummary;
const order: AdminOrderDetail = {
  ...orderBasics,
  currency: 'BDT',
  subtotalMinor: 10_000,
  shippingFeeMinor: 6_000,
  discountMinor: 0,
  coupon: null,
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
  cancelledAt: null,
  items: [
    {
      orderItemId: 1,
      productId: PRODUCT,
      variantId: null,
      variantLabel: null,
      productName: 'Desk Lamp',
      productSlug: 'desk-lamp',
      sku: 'DESK-LAMP',
      unitPriceMinor: 10_000,
      quantity: 1,
      lineTotalMinor: 10_000,
      regularPriceMinor: 10_000,
      catalogPriceMinor: 10_000,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
      image: null,
    },
  ],
  customer: { id: CUSTOMER, fullName: 'Rahima Khatun', phone: null },
  history: [{ fromStatus: null, toStatus: 'pending', actorKind: 'customer', note: null, at: AT }],
  paymentCollectedAt: null,
  allowedStatuses: [],
  canRecordCollection: true,
};

const customer = {
  id: CUSTOMER,
  email: 'rahima@example.com',
  fullName: 'Rahima Khatun',
  phone: null,
  status: 'active' as const,
  createdAt: AT,
  orderCount: 1,
  lastOrderAt: AT,
  avatar: null,
  googleAvatar: null,
};

const member: StaffMember = {
  id: STAFF,
  email: 'staff@example.com',
  fullName: 'Sadia Staff',
  role: 'staff',
  status: 'active',
  grantedAt: AT,
  overrides: [{ permission: 'orders.cancel', effect: 'grant' }],
  permissions: ['orders.cancel', 'orders.read'],
  invitationPending: false,
};

const taskSummary: ModerationTaskSummary = {
  id: TASK,
  productId: PRODUCT,
  productName: 'Desk Lamp',
  productSku: 'DESK-LAMP',
  status: 'pending',
  submittedBy: { id: STAFF, name: 'Sadia Staff', email: 'staff@example.com' },
  submittedAt: AT,
  assignedTo: null,
  assignedAt: null,
  decidedAt: null,
};

const task: ModerationTaskDetail = {
  ...taskSummary,
  content: {
    name: 'Desk Lamp',
    summary: null,
    description: null,
    slug: 'desk-lamp',
    sku: 'DESK-LAMP',
    categoryId: CATEGORY,
    categoryName: 'Home & Kitchen',
    priceMinor: 10_000,
    compareAtPriceMinor: null,
  },
  decidedBy: null,
  decisionNote: null,
  events: [{ kind: 'submitted', actor: null, note: null, at: AT }],
  product: { status: 'draft', moderationStatus: 'pending' },
  canDecide: false,
};

const overview: SalesOverview = {
  days: 7,
  orderCount: 1,
  cancelledCount: 0,
  salesMinor: 16_000,
  collectedMinor: 0,
  awaitingCollectionMinor: 16_000,
  averageOrderMinor: 16_000,
  byStatus: { delivered: 1 },
  daily: [{ day: '2026-10-25', orderCount: 1, salesMinor: 16_000 }],
  topProducts: [{ productId: PRODUCT, productName: 'Desk Lamp', unitsSold: 1, salesMinor: 10_000 }],
};

const mediaAsset: MediaAsset = {
  id: '0f000000-0000-4000-8000-000000000001',
  key: 'library/0f000000-0000-4000-8000-000000000001',
  url: 'https://media.example.com/library/0f000000-0000-4000-8000-000000000001/full.webp',
  thumbUrl: 'https://media.example.com/library/0f000000-0000-4000-8000-000000000001/thumb.webp',
  contentType: 'image/webp',
  width: 1600,
  height: 1200,
  bytes: 120_000,
  alt: 'Shop front',
  originalName: 'front.jpg',
  uploadedBy: { id: STAFF, name: 'Nusrat Owner', email: 'owner@example.com' },
  createdAt: AT,
};

const analyticsTotals = {
  orderCount: 1,
  cancelledCount: 0,
  revenueMinor: 16_000,
  averageOrderMinor: 16_000,
  newCustomers: 1,
  collectedMinor: 0,
  deliveredCount: 1,
  returnedOrderCount: 0,
};

const analytics: AnalyticsOverview = {
  range: { from: '2026-10-25', to: '2026-10-25', days: 1 },
  previousRange: null,
  totals: analyticsTotals,
  previousTotals: null,
  daily: [
    {
      day: '2026-10-25',
      revenueMinor: 16_000,
      orderCount: 1,
      newCustomers: 1,
      byStatus: { delivered: 1 },
    },
  ],
  previousDaily: [],
  snapshot: { codPendingMinor: 16_000, codPendingCount: 1, lowStockCount: 0, outOfStockCount: 0 },
  statusSplit: { delivered: 1 },
  paymentSplit: { pendingMinor: 16_000, pendingCount: 1, collectedMinor: 0, collectedCount: 0 },
  deliveryZones: [
    { zone: 'inside_dhaka', orderCount: 1, revenueMinor: 16_000 },
    { zone: 'outside_dhaka', orderCount: 0, revenueMinor: 0 },
  ],
  salesByCategory: [
    { categoryId: CATEGORY, categoryName: 'Home & Kitchen', unitsSold: 1, revenueMinor: 10_000 },
  ],
  topProducts: [
    { productId: PRODUCT, productName: 'Desk Lamp', unitsSold: 1, revenueMinor: 10_000 },
  ],
  heatmap: [{ weekday: 7, hour: 14, orderCount: 1 }],
  funnel: { carts: 1, checkouts: 1, orders: 1 },
  rates: { fulfillment: 1, returns: 0 },
  monthTarget: { month: '2026-10', targetMinor: null, revenueMinor: 16_000 },
  topCustomers: null,
};

const storeSettings: StoreSettings = {
  returnWindowDays: 7,
  cartInactivityMinutes: 120,
  repeatOrderThreshold: 2,
  highSpendThresholdMinor: 500_000,
  inactiveDays: 60,
  codEnabled: true,
  monthlySalesTargetMinor: null,
  updatedAt: AT,
};

const page = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
const productResponse = { product };
const orderResponse = { order };
const taskResponse = { task };
const taskList = { tasks: [taskSummary], ...page };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  };
  return { client, sent, fetchMock };
}

interface Case {
  call: (client: ApiClient) => Promise<unknown>;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  response: unknown;
  status?: number;
}

const productBody = {
  categoryId: CATEGORY,
  slug: 'desk-lamp',
  sku: 'DESK-LAMP',
  name: 'Desk Lamp',
  priceMinor: 10_000,
  initialStock: 12,
};
const { sku: _sku, initialStock: _stock, ...updateBody } = productBody;

const CASES: Record<string, Case> = {
  adminListProducts: {
    call: (c) =>
      c.adminListProducts(TOKEN, {
        q: 'lamp',
        status: 'draft',
        moderationStatus: 'pending',
        categoryId: CATEGORY,
        stock: 'low',
        sort: 'price_desc',
        page: 2,
        pageSize: 10,
      }),
    method: 'GET',
    path: `/admin/products?q=lamp&status=draft&moderationStatus=pending&categoryId=${CATEGORY}&stock=low&sort=price_desc&page=2&pageSize=10`,
    response: { products: [productSummary], ...page },
  },
  adminGetProduct: {
    call: (c) => c.adminGetProduct(TOKEN, PRODUCT),
    method: 'GET',
    path: `/admin/products/${PRODUCT}`,
    response: productResponse,
  },
  adminCreateProduct: {
    call: (c) => c.adminCreateProduct(TOKEN, productBody),
    method: 'POST',
    path: '/admin/products',
    body: productBody,
    response: productResponse,
    status: 201,
  },
  adminUpdateProduct: {
    call: (c) => c.adminUpdateProduct(TOKEN, PRODUCT, updateBody),
    method: 'PUT',
    path: `/admin/products/${PRODUCT}`,
    body: updateBody,
    response: productResponse,
  },
  adminSetProductStatus: {
    call: (c) => c.adminSetProductStatus(TOKEN, PRODUCT, { status: 'active' }),
    method: 'POST',
    path: `/admin/products/${PRODUCT}/status`,
    body: { status: 'active' },
    response: productResponse,
  },
  adminAdjustStock: {
    call: (c) => c.adminAdjustStock(TOKEN, PRODUCT, { change: -2, note: 'Damaged' }),
    method: 'POST',
    path: `/admin/products/${PRODUCT}/stock`,
    body: { change: -2, note: 'Damaged' },
    response: productResponse,
  },
  adminSubmitProduct: {
    call: (c) => c.adminSubmitProduct(TOKEN, PRODUCT),
    method: 'POST',
    path: `/admin/products/${PRODUCT}/submit`,
    body: {},
    response: productResponse,
  },
  adminListCategories: {
    call: (c) => c.adminListCategories(TOKEN),
    method: 'GET',
    path: '/admin/categories',
    response: { categories: [category] },
  },
  adminCreateCategory: {
    call: (c) => c.adminCreateCategory(TOKEN, { slug: 'garden', name: 'Garden' }),
    method: 'POST',
    path: '/admin/categories',
    body: { slug: 'garden', name: 'Garden' },
    response: { category },
    status: 201,
  },
  adminUpdateCategory: {
    call: (c) => c.adminUpdateCategory(TOKEN, CATEGORY, { slug: 'garden', name: 'Garden' }),
    method: 'PUT',
    path: `/admin/categories/${CATEGORY}`,
    body: { slug: 'garden', name: 'Garden' },
    response: { category },
  },
  adminListInventoryMovements: {
    call: (c) =>
      c.adminListInventoryMovements(TOKEN, { productId: PRODUCT, reason: 'adjustment', page: 3 }),
    method: 'GET',
    path: `/admin/inventory-movements?productId=${PRODUCT}&reason=adjustment&page=3`,
    response: {
      movements: [
        {
          id: 7,
          product: { id: PRODUCT, name: 'Desk Lamp', sku: 'DESK-LAMP' },
          change: -2,
          stockAfter: 10,
          reason: 'adjustment',
          note: 'Damaged',
          orderNumber: null,
          actor: { id: STAFF, name: null, email: null },
          createdAt: AT,
        },
      ],
      ...page,
    },
  },
  adminListOrders: {
    call: (c) =>
      c.adminListOrders(TOKEN, {
        status: 'delivered',
        paymentStatus: 'pending',
        q: 'NZ1000',
        from: '2026-10-01',
        to: '2026-10-25',
        customerId: CUSTOMER,
        pageSize: 50,
      }),
    method: 'GET',
    path: `/admin/orders?status=delivered&paymentStatus=pending&q=NZ1000&from=2026-10-01&to=2026-10-25&customerId=${CUSTOMER}&pageSize=50`,
    response: { orders: [orderSummary], ...page },
  },
  adminGetOrder: {
    call: (c) => c.adminGetOrder(TOKEN, 'NZ100042'),
    method: 'GET',
    path: '/admin/orders/NZ100042',
    response: orderResponse,
  },
  adminUpdateOrderStatus: {
    call: (c) =>
      c.adminUpdateOrderStatus(TOKEN, 'NZ100042', { status: 'cancelled', note: 'Customer asked' }),
    method: 'POST',
    path: '/admin/orders/NZ100042/status',
    body: { status: 'cancelled', note: 'Customer asked' },
    response: orderResponse,
  },
  adminRecordCodCollection: {
    call: (c) => c.adminRecordCodCollection(TOKEN, 'NZ100042', { amountMinor: 16_000 }),
    method: 'POST',
    path: '/admin/orders/NZ100042/cod-collection',
    body: { amountMinor: 16_000 },
    response: orderResponse,
  },
  adminListCustomers: {
    call: (c) => c.adminListCustomers(TOKEN, { q: 'rahima', status: 'suspended' }),
    method: 'GET',
    path: '/admin/customers?q=rahima&status=suspended',
    response: { customers: [customer], ...page },
  },
  adminGetCustomer: {
    call: (c) => c.adminGetCustomer(TOKEN, CUSTOMER),
    method: 'GET',
    path: `/admin/customers/${CUSTOMER}`,
    response: { customer: { ...customer, recentOrders: null } },
  },
  adminSetCustomerStatus: {
    call: (c) =>
      c.adminSetCustomerStatus(TOKEN, CUSTOMER, { status: 'suspended', reason: 'Fake orders' }),
    method: 'POST',
    path: `/admin/customers/${CUSTOMER}/status`,
    body: { status: 'suspended', reason: 'Fake orders' },
    response: { customer: { ...customer, status: 'suspended', recentOrders: [orderSummary] } },
  },
  adminListStaff: {
    call: (c) => c.adminListStaff(TOKEN),
    method: 'GET',
    path: '/admin/staff',
    response: {
      staff: [member],
      permissions: [{ name: 'orders.read', description: 'See every order' }],
    },
  },
  adminInviteStaff: {
    call: (c) => c.adminInviteStaff(TOKEN, { email: 'nadia@example.com', role: 'moderator' }),
    method: 'POST',
    path: '/admin/staff/invitations',
    body: { email: 'nadia@example.com', role: 'moderator' },
    response: {
      invitation: { id: STAFF, email: 'nadia@example.com', role: 'moderator', expiresAt: AT },
      emailSent: true,
    },
    status: 201,
  },
  adminStaffInvitations: {
    call: (c) => c.adminStaffInvitations(TOKEN),
    method: 'GET',
    path: '/admin/staff/invitations',
    response: {
      invitations: [
        {
          id: STAFF,
          email: 'nadia@example.com',
          fullName: null,
          role: 'staff',
          status: 'pending',
          createdAt: AT,
          expiresAt: AT,
          acceptedAt: null,
          revokedAt: null,
          sendCount: 1,
          invitedBy: 'Owner',
        },
      ],
    },
  },
  adminResendStaffInvitation: {
    call: (c) => c.adminResendStaffInvitation(TOKEN, STAFF),
    method: 'POST',
    path: `/admin/staff/invitations/${STAFF}/resend`,
    body: {},
    response: {
      invitation: { id: STAFF, email: 'nadia@example.com', role: 'staff', expiresAt: AT },
      emailSent: false,
    },
  },
  resendStaffInvitation: {
    call: (c) => c.resendStaffInvitation(TOKEN, STAFF),
    method: 'POST',
    path: `/admin/staff/${STAFF}/invitation`,
    body: {},
    response: { invitation: { userId: STAFF, email: 'nadia@example.com' } },
  },
  adminSetPermission: {
    call: (c) => c.adminSetPermission(TOKEN, STAFF, { permission: 'orders.cancel', effect: null }),
    method: 'PUT',
    path: `/admin/staff/${STAFF}/permissions`,
    body: { permission: 'orders.cancel', effect: null },
    response: { member },
  },
  assignRole: {
    call: (c) => c.assignRole(TOKEN, STAFF, { role: 'moderator' }),
    method: 'PUT',
    path: `/admin/users/${STAFF}/role`,
    body: { role: 'moderator' },
    response: { userId: STAFF, role: 'moderator', grantedAt: AT },
  },
  moderatorQueue: {
    call: (c) => c.moderatorQueue(TOKEN, { status: 'pending', page: 1 }),
    method: 'GET',
    path: '/moderator/queue?status=pending&page=1',
    response: taskList,
  },
  moderatorGetTask: {
    call: (c) => c.moderatorGetTask(TOKEN, TASK),
    method: 'GET',
    path: `/moderator/tasks/${TASK}`,
    response: taskResponse,
  },
  moderatorDecide: {
    call: (c) =>
      c.moderatorDecide(TOKEN, TASK, { decision: 'changes_requested', note: 'Add the wattage.' }),
    method: 'POST',
    path: `/moderator/tasks/${TASK}/decision`,
    body: { decision: 'changes_requested', note: 'Add the wattage.' },
    response: taskResponse,
  },
  adminListModeration: {
    call: (c) => c.adminListModeration(TOKEN, { scope: 'unassigned', status: 'pending' }),
    method: 'GET',
    path: '/admin/moderation?scope=unassigned&status=pending',
    response: taskList,
  },
  adminListReviewers: {
    call: (c) => c.adminListReviewers(TOKEN),
    method: 'GET',
    path: '/admin/moderation/reviewers',
    response: { reviewers: [{ id: STAFF, name: null, email: 'mitu@example.com', openReviews: 2 }] },
  },
  adminGetModerationTask: {
    call: (c) => c.adminGetModerationTask(TOKEN, TASK),
    method: 'GET',
    path: `/admin/moderation/${TASK}`,
    response: taskResponse,
  },
  adminAssignModeration: {
    call: (c) => c.adminAssignModeration(TOKEN, TASK, { moderatorId: STAFF }),
    method: 'POST',
    path: `/admin/moderation/${TASK}/assignment`,
    body: { moderatorId: STAFF },
    response: taskResponse,
  },
  adminWithdrawModeration: {
    call: (c) => c.adminWithdrawModeration(TOKEN, TASK),
    method: 'POST',
    path: `/admin/moderation/${TASK}/withdraw`,
    body: {},
    response: taskResponse,
  },
  adminAuditLog: {
    call: (c) => c.adminAuditLog(TOKEN, { action: 'order.', actorId: STAFF, pageSize: 50 }),
    method: 'GET',
    path: `/admin/audit-log?action=order.&actorId=${STAFF}&pageSize=50`,
    response: {
      entries: [
        {
          id: 1,
          actor: { id: STAFF, name: 'Sadia Staff', email: 'staff@example.com' },
          action: 'order.status_changed',
          targetType: 'order',
          targetId: 'NZ100042',
          details: { from: 'pending', to: 'confirmed' },
          createdAt: AT,
        },
      ],
      ...page,
    },
  },
  adminSalesOverview: {
    call: (c) => c.adminSalesOverview(TOKEN, { days: 7 }),
    method: 'GET',
    path: '/admin/analytics/sales?days=7',
    response: { overview },
  },
  adminDashboard: {
    call: (c) => c.adminDashboard(TOKEN),
    method: 'GET',
    path: '/admin/dashboard',
    response: {
      orders: { pending: 1, confirmed: 0, processing: 0, shipped: 0, awaitingCollection: 1 },
      stock: null,
      moderation: { assignedToMe: 2, unassigned: null, pending: null },
      sales: null,
    },
  },
  adminListDeliveryCharges: {
    call: (c) => c.adminListDeliveryCharges(TOKEN),
    method: 'GET',
    path: '/admin/settings/delivery-charges',
    response: {
      charges: [
        { zone: 'inside_dhaka', amountMinor: 6_000, updatedAt: AT },
        { zone: 'outside_dhaka', amountMinor: null, updatedAt: null },
      ],
    },
  },
  adminSetDeliveryCharge: {
    call: (c) => c.adminSetDeliveryCharge(TOKEN, 'outside_dhaka', { amountMinor: 12_000 }),
    method: 'PUT',
    path: '/admin/settings/delivery-charges/outside_dhaka',
    body: { amountMinor: 12_000 },
    response: { charge: { zone: 'outside_dhaka', amountMinor: 12_000, updatedAt: AT } },
  },
  adminAnalyticsOverview: {
    call: (c) =>
      c.adminAnalyticsOverview(TOKEN, { from: '2026-10-25', to: '2026-10-25', compare: false }),
    method: 'GET',
    path: '/admin/analytics/overview?from=2026-10-25&to=2026-10-25&compare=false',
    response: { overview: analytics },
  },
  adminSlugAvailability: {
    call: (c) =>
      c.adminSlugAvailability(TOKEN, { kind: 'product', slug: 'desk-lamp', excludeId: PRODUCT }),
    method: 'GET',
    path: `/admin/slugs/availability?kind=product&slug=desk-lamp&excludeId=${PRODUCT}`,
    response: { available: false, reason: 'taken', suggestion: 'desk-lamp-2' },
  },
  adminListMedia: {
    call: (c) => c.adminListMedia(TOKEN, { q: 'shop front', page: 2, pageSize: 10 }),
    method: 'GET',
    path: '/admin/media?q=shop+front&page=2&pageSize=10',
    response: { assets: [mediaAsset], page: 2, pageSize: 10, total: 11, totalPages: 2 },
  },
  adminListRoles: {
    call: (c) => c.adminListRoles(TOKEN),
    method: 'GET',
    path: '/admin/roles',
    response: {
      roles: [
        { role: 'super_admin', permissions: ['orders.read', 'settings.manage'] },
        { role: 'customer', permissions: [] },
      ],
    },
  },
  adminGetStoreSettings: {
    call: (c) => c.adminGetStoreSettings(TOKEN),
    method: 'GET',
    path: '/admin/settings/store',
    response: { settings: storeSettings },
  },
  adminSaveStoreSettings: {
    call: (c) =>
      c.adminSaveStoreSettings(TOKEN, {
        returnWindowDays: 14,
        cartInactivityMinutes: 300,
        inactiveDays: 90,
      }),
    method: 'PUT',
    path: '/admin/settings/store',
    body: { returnWindowDays: 14, cartInactivityMinutes: 300, inactiveDays: 90 },
    response: { settings: { ...storeSettings, returnWindowDays: 14, inactiveDays: 90 } },
  },
  adminSetSalesTarget: {
    call: (c) => c.adminSetSalesTarget(TOKEN, { targetMinor: 5_000_000 }),
    method: 'PUT',
    path: '/admin/settings/sales-target',
    body: { targetMinor: 5_000_000 },
    response: { target: { targetMinor: 5_000_000, updatedAt: AT } },
  },
};

describe.each(Object.entries(CASES))('%s', (_name, route) => {
  it('sends the right method, path, bearer token and body, and validates the answer', async () => {
    const { client, sent } = setup(() => jsonResponse(route.response, route.status));

    await expect(route.call(client)).resolves.toStrictEqual(route.response);
    const request = sent();
    expect(request.url).toBe(`http://localhost:4000/api/v1${route.path}`);
    expect(request.method).toBe(route.method);
    expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.headers.get('Accept')).toBe('application/json');
    if (route.body === undefined) {
      expect(request.body).toBeUndefined();
    } else {
      expect(request.body).toStrictEqual(route.body);
      expect(request.headers.get('Content-Type')).toBe('application/json');
    }
  });

  it('refuses an answer outside the contract', async () => {
    const { client } = setup(() => jsonResponse({ unexpected: true }, route.status));

    await expect(route.call(client)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_response',
    });
  });

  it('raises the API error code, request id and details', async () => {
    const { client } = setup(() =>
      jsonResponse(
        {
          error: {
            code: 'forbidden',
            message: 'You do not have permission to do this',
            requestId: 'req-12345678',
          },
        },
        403,
      ),
    );

    const failure = await route.call(client).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: 'forbidden', requestId: 'req-12345678' });
  });
});

describe('admin path and query safety', () => {
  it('encodes path segments so an id cannot reach another route', async () => {
    const { client, sent } = setup(() => jsonResponse(productResponse));
    await client.adminGetProduct(TOKEN, 'a/b?status=active#x');

    expect(sent().url).toBe(
      'http://localhost:4000/api/v1/admin/products/a%2Fb%3Fstatus%3Dactive%23x',
    );
  });

  it.each(['..', '.', ''])('refuses the id %j without sending anything', async (id) => {
    const { client, fetchMock } = setup(() => jsonResponse(taskResponse));

    await expect(client.moderatorGetTask(TOKEN, id)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])(
    'refuses the dot segment %j in every position, including before a sub-route',
    async (id) => {
      const { client, fetchMock } = setup(() => jsonResponse({}));
      const calls = [
        client.resendStaffInvitation(TOKEN, id),
        client.adminSetPermission(TOKEN, id, { permission: 'orders.read', effect: null }),
        client.adminAdjustStock(TOKEN, id, { change: 1, note: 'Recount' }),
        client.adminUpdateOrderStatus(TOKEN, id, { status: 'confirmed' }),
        client.adminSetDeliveryCharge(TOKEN, id as 'inside_dhaka', { amountMinor: 1 }),
      ];

      for (const pending of calls) {
        await expect(pending).rejects.toMatchObject({ status: 0, code: 'invalid_request' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps encoded dots and percent signs as one literal segment', async () => {
    const { client, sent } = setup(() => jsonResponse(productResponse));
    await client.adminGetProduct(TOKEN, '%2e%2E');

    expect(sent().url).toBe('http://localhost:4000/api/v1/admin/products/%252e%252E');
  });

  it('leaves out blank searches and unset filters, and encodes the rest', async () => {
    const { client, sent } = setup(() => jsonResponse({ orders: [], ...page, total: 0 }));
    await client.adminListOrders(TOKEN, { q: '  ', status: undefined, page: 2 });
    const second = setup(() => jsonResponse({ customers: [], ...page, total: 0 }));
    await second.client.adminListCustomers(TOKEN, { q: 'a&b=c' });

    expect(sent().url).toBe('http://localhost:4000/api/v1/admin/orders?page=2');
    expect(second.sent().url).toBe('http://localhost:4000/api/v1/admin/customers?q=a%26b%3Dc');
  });

  it.each([
    [true, '&compare=true'],
    ['false' as const, '&compare=false'],
    [undefined, ''],
  ])('sends compare=%s as the server reads it', async (compare, suffix) => {
    const { client, sent } = setup(() => jsonResponse({ overview: analytics }));
    await client.adminAnalyticsOverview(TOKEN, { from: '2026-10-01', to: '2026-10-31', compare });

    expect(sent().url).toBe(
      `http://localhost:4000/api/v1/admin/analytics/overview?from=2026-10-01&to=2026-10-31${suffix}`,
    );
  });

  it('sends every audit-log filter, encoded, and leaves out the ones not set', async () => {
    const { client, sent } = setup(() => jsonResponse({ entries: [], ...page, total: 0 }));
    await client.adminAuditLog(TOKEN, {
      from: '2026-10-01',
      to: '2026-10-31',
      q: '100% & more',
      page: 2,
    });
    const plain = setup(() => jsonResponse({ entries: [], ...page, total: 0 }));
    await plain.client.adminAuditLog(TOKEN, { q: '  ' });
    const bare = setup(() => jsonResponse({ entries: [], ...page, total: 0 }));
    await bare.client.adminAuditLog(TOKEN);

    expect(sent().url).toBe(
      'http://localhost:4000/api/v1/admin/audit-log?from=2026-10-01&to=2026-10-31&q=100%25+%26+more&page=2',
    );
    expect(plain.sent().url).toBe('http://localhost:4000/api/v1/admin/audit-log');
    expect(bare.sent().url).toBe('http://localhost:4000/api/v1/admin/audit-log');
  });

  it('refuses a roles answer that names a role or permission the contract does not know', async () => {
    const roles = setup(() => jsonResponse({ roles: [{ role: 'root', permissions: [] }] }));
    const permissions = setup(() =>
      jsonResponse({ roles: [{ role: 'admin', permissions: ['everything.all'] }] }),
    );

    await expect(roles.client.adminListRoles(TOKEN)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(permissions.client.adminListRoles(TOKEN)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends only the settings given and refuses settings answered outside their ranges', async () => {
    const { client, sent } = setup(() => jsonResponse({ settings: storeSettings }));
    await client.adminSaveStoreSettings(TOKEN, { returnWindowDays: 7, cartInactivityMinutes: 120 });
    const outside = setup(() =>
      jsonResponse({ settings: { ...storeSettings, repeatOrderThreshold: 99 } }),
    );

    expect(sent().body).toStrictEqual({ returnWindowDays: 7, cartInactivityMinutes: 120 });
    await expect(outside.client.adminGetStoreSettings(TOKEN)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends null to clear the sales target', async () => {
    const { client, sent } = setup(() =>
      jsonResponse({ target: { targetMinor: null, updatedAt: AT } }),
    );

    await expect(client.adminSetSalesTarget(TOKEN, { targetMinor: null })).resolves.toStrictEqual({
      target: { targetMinor: null, updatedAt: AT },
    });
    expect(sent().body).toStrictEqual({ targetMinor: null });
  });

  it('sends the collection amount but never derives it', async () => {
    const { client, sent } = setup(() =>
      jsonResponse(
        {
          error: {
            code: 'collection_amount_mismatch',
            message: 'The amount collected differs from the order total',
            details: { totalMinor: 16_000 },
          },
        },
        409,
      ),
    );

    await expect(
      client.adminRecordCodCollection(TOKEN, 'NZ100042', { amountMinor: 15_000 }),
    ).rejects.toMatchObject({
      code: 'collection_amount_mismatch',
      details: { totalMinor: 16_000 },
    });
    expect(sent().body).toStrictEqual({ amountMinor: 15_000 });
  });
});

describe('acceptInvitation', () => {
  it('posts the token hash and password without credentials and resolves on 204', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }));

    await expect(
      client.acceptInvitation({ tokenHash: 'invite-hash-0000000001', password: 'team-2026-pass' }),
    ).resolves.toBeUndefined();
    const request = sent();
    expect(request).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/accept-invite',
      method: 'POST',
      body: { tokenHash: 'invite-hash-0000000001', password: 'team-2026-pass' },
    });
    expect(request.headers.get('Authorization')).toBeNull();
  });

  it('raises invitation_invalid for a used link', async () => {
    const { client } = setup(() =>
      jsonResponse(
        {
          error: {
            code: 'invitation_invalid',
            message: 'This invitation link is invalid or has expired',
          },
        },
        400,
      ),
    );

    await expect(
      client.acceptInvitation({ tokenHash: 'invite-hash-0000000001', password: 'team-2026-pass' }),
    ).rejects.toMatchObject({ status: 400, code: 'invitation_invalid' });
  });

  it('refuses a body where no content was expected', async () => {
    const { client } = setup(() => jsonResponse({ accessToken: 'leaked' }));

    await expect(
      client.acceptInvitation({ tokenHash: 'invite-hash-0000000001', password: 'team-2026-pass' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('the media library and brand deletion', () => {
  it('uploads a library picture as raw bytes with its description and file name', async () => {
    const { client, fetchMock } = setup(() => jsonResponse({ asset: mediaAsset }, 201));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    await expect(
      client.adminUploadMedia(TOKEN, {
        bytes,
        contentType: 'image/jpeg',
        alt: 'Shop front',
        name: 'front & back.jpg',
      }),
    ).resolves.toStrictEqual({ asset: mediaAsset });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'http://localhost:4000/api/v1/admin/media?alt=Shop+front&name=front+%26+back.jpg',
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(bytes);
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('sends no query for an upload without description or name', async () => {
    const { client, sent } = setup(() => jsonResponse({ asset: mediaAsset }, 201));
    await client.adminUploadMedia(TOKEN, { bytes: new Uint8Array([1]), contentType: 'image/png' });

    expect(sent().url).toBe('http://localhost:4000/api/v1/admin/media');
  });

  it('changes a description with PATCH', async () => {
    const { client, sent } = setup(() => jsonResponse({ asset: { ...mediaAsset, alt: null } }));

    await expect(client.adminUpdateMedia(TOKEN, mediaAsset.id, { alt: '' })).resolves.toMatchObject(
      { asset: { alt: null } },
    );
    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/media/${mediaAsset.id}`,
      method: 'PATCH',
      body: { alt: '' },
    });
  });

  it.each([
    [
      'adminDeleteMedia',
      `/admin/media/${PRODUCT}`,
      (c: ApiClient) => c.adminDeleteMedia(TOKEN, PRODUCT),
    ],
    [
      'adminDeleteBrand',
      `/admin/brands/${PRODUCT}`,
      (c: ApiClient) => c.adminDeleteBrand(TOKEN, PRODUCT),
    ],
  ])('%s sends DELETE and resolves on 204', async (_name, path, call) => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }));

    await expect(call(client)).resolves.toBeUndefined();
    expect(sent()).toMatchObject({ url: `http://localhost:4000/api/v1${path}`, method: 'DELETE' });
    expect(sent().headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ['in_use', (c: ApiClient) => c.adminDeleteMedia(TOKEN, PRODUCT)],
    ['brand_in_use', (c: ApiClient) => c.adminDeleteBrand(TOKEN, PRODUCT)],
  ])('raises %s when the item is still used', async (code, call) => {
    const { client } = setup(() => jsonResponse({ error: { code, message: 'Still in use' } }, 409));

    await expect(call(client)).rejects.toMatchObject({ name: 'ApiError', status: 409, code });
  });

  it('revokes an invitation with a POST and resolves on 204', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }));

    await expect(client.adminRevokeStaffInvitation(TOKEN, STAFF)).resolves.toBeUndefined();
    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/staff/invitations/${STAFF}/revoke`,
      method: 'POST',
    });
    expect(sent().headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses ids that would change the path, without sending anything', async () => {
    const { client, fetchMock } = setup(() => new Response(null, { status: 204 }));

    for (const pending of [
      client.adminDeleteMedia(TOKEN, '..'),
      client.adminDeleteBrand(TOKEN, '.'),
      client.adminUpdateMedia(TOKEN, '..', { alt: null }),
    ]) {
      await expect(pending).rejects.toMatchObject({ status: 0, code: 'invalid_request' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a slug answer that contradicts itself', async () => {
    const { client } = setup(() =>
      jsonResponse({ available: true, reason: 'taken', suggestion: null }),
    );

    await expect(
      client.adminSlugAvailability(TOKEN, { kind: 'brand', slug: 'north' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
