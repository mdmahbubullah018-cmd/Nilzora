import {
  analyticsOverviewSchema,
  type AdminOrderSummary,
  type AdminReviewListResponse,
  type AnalyticsOverview,
  type AuditEntry,
  type DashboardResponse,
} from '@nilzora/contracts';

/*
 * Test data for the dashboard's tests only: shaped like the API's responses (parsed with
 * the contract's own schema, so it cannot drift), never shown in the app.
 */

/**
 * An analytics overview of `days` days ending 25 October 2026, one ৳1,000 order a day
 * (or `dailyRevenue` per day), compared with a previous period of ৳500 a day.
 */
export function analyticsOverview(
  days: number,
  { dailyRevenue, compare = true }: { dailyRevenue?: readonly number[]; compare?: boolean } = {},
): AnalyticsOverview {
  const dayOf = (offset: number) =>
    new Date(Date.UTC(2026, 9, 25 - offset)).toISOString().slice(0, 10);
  const daily = Array.from({ length: days }, (_, index) => ({
    day: dayOf(days - 1 - index),
    revenueMinor: dailyRevenue?.[index] ?? 100_000,
    orderCount: (dailyRevenue?.[index] ?? 1) > 0 ? 1 : 0,
    newCustomers: index % 3 === 0 ? 1 : 0,
    byStatus: { delivered: 1 },
  }));
  const revenueMinor = daily.reduce((sum, day) => sum + day.revenueMinor, 0);
  const orderCount = daily.reduce((sum, day) => sum + day.orderCount, 0);
  const totals = {
    orderCount,
    cancelledCount: 1,
    revenueMinor,
    averageOrderMinor: orderCount > 0 ? Math.round(revenueMinor / orderCount) : 0,
    newCustomers: daily.reduce((sum, day) => sum + day.newCustomers, 0),
    collectedMinor: Math.round(revenueMinor / 2),
    deliveredCount: orderCount,
    returnedOrderCount: orderCount > 0 ? 1 : 0,
  };
  return analyticsOverviewSchema.parse({
    range: { from: dayOf(days - 1), to: dayOf(0), days },
    previousRange: compare ? { from: dayOf(2 * days - 1), to: dayOf(days) } : null,
    totals,
    previousTotals: compare
      ? {
          ...totals,
          orderCount: days,
          revenueMinor: days * 50_000,
          averageOrderMinor: 50_000,
          newCustomers: 0,
        }
      : null,
    daily,
    previousDaily: compare
      ? daily.map((day, index) => ({
          day: dayOf(2 * days - 1 - index),
          revenueMinor: 50_000,
          orderCount: 1,
        }))
      : [],
    snapshot: {
      codPendingMinor: 250_000,
      codPendingCount: 4,
      lowStockCount: 2,
      outOfStockCount: 1,
    },
    statusSplit: orderCount > 0 ? { delivered: orderCount, cancelled: 1 } : {},
    paymentSplit: {
      pendingMinor: Math.round(revenueMinor / 2),
      pendingCount: Math.floor(orderCount / 2),
      collectedMinor: Math.round(revenueMinor / 2),
      collectedCount: Math.ceil(orderCount / 2),
    },
    deliveryZones: [
      { zone: 'inside_dhaka', orderCount, revenueMinor },
      { zone: 'outside_dhaka', orderCount: 0, revenueMinor: 0 },
    ],
    salesByCategory:
      orderCount > 0
        ? [
            {
              categoryId: '00000000-0000-4000-8000-0000000000e1',
              categoryName: 'Sarees',
              unitsSold: orderCount,
              revenueMinor,
            },
          ]
        : [],
    topProducts:
      orderCount > 0
        ? [
            {
              productId: '00000000-0000-4000-8000-0000000000a1',
              productName: 'Handloom cotton saree',
              unitsSold: 12,
              revenueMinor: 1_440_000,
            },
          ]
        : [],
    heatmap: orderCount > 0 ? [{ weekday: 5, hour: 20, orderCount: 3 }] : [],
    funnel: { carts: 40, checkouts: 20, orders: orderCount },
    rates: {
      fulfillment: orderCount > 0 ? 1 : null,
      returns: orderCount > 0 ? 1 / orderCount : null,
    },
    monthTarget: { month: '2026-10', targetMinor: 5_000_000, revenueMinor },
    topCustomers:
      orderCount > 0
        ? [
            {
              customerId: '00000000-0000-4000-8000-0000000000c1',
              name: 'Ayesha Rahman',
              email: 'ayesha@example.test',
              orderCount: 3,
              revenueMinor: 300_000,
              daily: daily.map(() => 10_000),
            },
          ]
        : [],
  });
}

export const dashboardSummary: DashboardResponse = {
  orders: { pending: 2, confirmed: 1, processing: 0, shipped: 3, awaitingCollection: 4 },
  stock: {
    lowStockCount: 2,
    products: [
      {
        id: '00000000-0000-4000-8000-0000000000b1',
        name: 'Jamdani scarf',
        sku: 'NZ-JS-01',
        stockQuantity: 0,
      },
      {
        id: '00000000-0000-4000-8000-0000000000b2',
        name: 'Clay mug',
        sku: 'NZ-CM-02',
        stockQuantity: 3,
      },
    ],
  },
  moderation: { assignedToMe: 1, unassigned: 2, pending: 3 },
  sales: { days: 7, orderCount: 7, salesMinor: 700_000, awaitingCollectionMinor: 250_000 },
};

export const recentOrder: AdminOrderSummary = {
  orderNumber: 'NZ100042',
  status: 'shipped',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 2,
  totalMinor: 245_000,
  placedAt: '2026-10-25T09:00:00.000Z',
  preview: [],
  customerId: '00000000-0000-4000-8000-0000000000c1',
  recipientName: 'Ayesha Rahman',
  phone: '+8801712345678',
  deliveryZone: 'inside_dhaka',
  discountMinor: 0,
  coupon: null,
  shipment: null,
};

export const auditEntry: AuditEntry = {
  id: 1,
  actor: { id: '00000000-0000-4000-8000-0000000000d1', name: 'Karim Hossain', email: null },
  action: 'order.status_changed',
  targetType: 'order',
  targetId: 'NZ100042',
  details: { from: 'processing', to: 'shipped' },
  createdAt: '2026-10-25T11:55:00.000Z',
};

export const pendingReviews: AdminReviewListResponse = {
  reviews: [
    {
      id: '00000000-0000-4000-8000-0000000000f1',
      rating: 4,
      title: 'Lovely weave',
      body: 'Soft fabric and true colours.',
      images: [],
      createdAt: '2026-10-25T10:00:00.000Z',
      reply: null,
      helpfulCount: 7,
      notHelpfulCount: 1,
      viewerVote: null,
      productId: '00000000-0000-4000-8000-0000000000a1',
      productName: 'Handloom cotton saree',
      productSlug: 'handloom-cotton-saree',
      authorId: '00000000-0000-4000-8000-0000000000c1',
      authorName: 'Ayesha R.',
      authorEmail: 'ayesha@example.test',
      status: 'pending',
      moderatedAt: null,
      moderationNote: null,
    },
  ],
  page: 1,
  pageSize: 4,
  total: 3,
  totalPages: 1,
};
