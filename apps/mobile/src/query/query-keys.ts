import type { CartItem, OrderListQuery, ProductFacetsQuery, ProductListQuery } from '@nilzora/contracts';

/*
 * Query keys
 * ----------
 * One factory for every key, so screens that fetch and screens that invalidate agree.
 *
 * - Public data (catalog, cart quote) is keyed by what was asked for.
 * - A signed-in customer's data lives under ['user', userId, ...]. The user id is part of
 *   the key, so one account can never read another's cached data, and AppQueryProvider
 *   removes the whole 'user' branch when the account changes or signs out.
 *
 * Prefix helpers (`all`) are for invalidateQueries / removeQueries.
 */

/** First key segment of everything that belongs to a signed-in account. */
export const USER_QUERY_ROOT = 'user';

/**
 * Stands in for the user id while nobody is signed in (`useSignedInUserId()` is null), so a
 * disabled account query still has a valid key. Such a query never holds data.
 */
export const ANONYMOUS_USER = 'anonymous';

/** Drops blank values so equivalent requests share a cache entry (`q: ' '` is no search). */
function definedOnly(query: object | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') result[key] = trimmed;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Only ids, variants and quantities identify a cart request; the server prices it. The
 * variant is part of the identity: two variants of one product have different prices.
 */
function cartKey(items: readonly CartItem[]): CartItem[] {
  return items.map(({ productId, variantId, quantity }) =>
    variantId ? { productId, variantId, quantity } : { productId, quantity },
  );
}

const user = (userId: string | null) => [USER_QUERY_ROOT, userId ?? ANONYMOUS_USER] as const;

export const queryKeys = {
  catalog: {
    all: ['catalog'] as const,
    categories: () => ['catalog', 'categories'] as const,
    /** The store's active shopping zones (collections), in display order. */
    shoppingZones: () => ['catalog', 'shopping-zones'] as const,
    /** One page of a listing (useQuery). Include `page` in the query. */
    products: (query?: ProductListQuery) => ['catalog', 'products', definedOnly(query)] as const,
    /** An endless listing (useInfiniteQuery). Pass the query WITHOUT `page`. */
    productFeed: (query?: Omit<ProductListQuery, 'page'>) =>
      ['catalog', 'product-feed', definedOnly(query)] as const,
    /** The size and colour values that can narrow a listing (useQuery). */
    productFacets: (query?: ProductFacetsQuery) =>
      ['catalog', 'product-facets', definedOnly(query)] as const,
    product: (slug: string) => ['catalog', 'product', slug] as const,
    /** GET /catalog/discovery: the sections the search screen shows before anyone types. */
    discovery: () => ['catalog', 'discovery'] as const,
    /** Approved reviews of one product and their rating summary (useInfiniteQuery). */
    reviews: (slug: string) => ['catalog', 'reviews', slug] as const,
  },
  cart: {
    /** POST /cart/quote for exactly these ids and quantities, in this order. */
    quote: (items: readonly CartItem[]) => ['cart', 'quote', cartKey(items)] as const,
  },
  /** The store's own published information: public, and the same for every account. */
  site: {
    storeProfile: () => ['site', 'store-profile'] as const,
  },
  /** The onboarding or promotional campaign this viewer may see. */
  onboarding: {
    /**
     * GET /onboarding resolved for this viewer: the server applies the audience, window and
     * history rules, so a guest and a customer get different answers and different keys.
     */
    campaign: (userId: string | null) =>
      ['onboarding', 'campaign', userId ?? ANONYMOUS_USER] as const,
    /** Device-local campaign history for a visitor without an account. */
    guestHistory: () => ['onboarding', 'guest-history'] as const,
  },
  /** The promotional popup the store is showing now, and this device's own record of it. */
  popup: {
    /** GET /popups: the same answer for every visitor, so no account in the key. */
    current: () => ['popup', 'current'] as const,
    /** GET /popups?platform=app: every popup live in the app, best first. */
    list: () => ['popup', 'list', 'app'] as const,
    /** Whether this device may be shown that popup, per its own frequency rule. */
    mayShow: (popupId: string) => ['popup', 'may-show', popupId] as const,
  },
  /** Everything of one account (`null`: nobody signed in); a prefix for removeQueries. */
  user,
  checkout: {
    /** POST /checkout/quote: the cart delivered to one of this account's addresses. */
    quote: (userId: string | null, items: readonly CartItem[], addressId: string) =>
      [...user(userId), 'checkout', 'quote', addressId, cartKey(items)] as const,
  },
  addresses: {
    all: (userId: string | null) => [...user(userId), 'addresses'] as const,
    list: (userId: string | null) => [...user(userId), 'addresses', 'list'] as const,
  },
  /** The account's saved products: one list, shared with the website. */
  wishlist: (userId: string | null) => [...user(userId), 'wishlist'] as const,
  /** Vouchers: the centre carries this account's state, so it is keyed by account too. */
  vouchers: {
    all: (userId: string | null) => [...user(userId), 'vouchers'] as const,
    center: (userId: string | null) => [...user(userId), 'vouchers', 'center'] as const,
    mine: (userId: string | null) => [...user(userId), 'vouchers', 'mine'] as const,
    product: (userId: string | null, slug: string) =>
      [...user(userId), 'vouchers', 'product', slug] as const,
  },
  /** The account's own notification history: one page per category, plus the unread count. */
  notifications: {
    all: (userId: string | null) => [...user(userId), 'notifications'] as const,
    list: (userId: string | null, kind: string | null) =>
      [...user(userId), 'notifications', 'list', kind ?? 'all'] as const,
    unread: (userId: string | null) => [...user(userId), 'notifications', 'unread'] as const,
    preferences: (userId: string | null) => [...user(userId), 'notification-preferences'] as const,
  },
  orders: {
    all: (userId: string | null) =>
      [
        ...user(userId),
        'orders',
      ] as const /** One page of the account's orders (useQuery). Include `page` in the query. */,
    list: (userId: string | null, query?: OrderListQuery) =>
      [...user(userId), 'orders', 'list', definedOnly(query)] as const,
    /** An endless order history (useInfiniteQuery). Pass the query WITHOUT `page`. */
    feed: (userId: string | null, query?: Omit<OrderListQuery, 'page'>) =>
      [...user(userId), 'orders', 'feed', definedOnly(query)] as const,
    detail: (userId: string | null, orderNumber: string) =>
      [...user(userId), 'orders', 'detail', orderNumber] as const,
    /** The courier shipments of one order (tracking); under `all`, so order refreshes reach it. */
    shipments: (userId: string | null, orderNumber: string) =>
      [...user(userId), 'orders', 'shipments', orderNumber] as const,
  },
  reviews: {
    /** This customer's own review of one product, and whether they may write one. */
    mine: (userId: string | null, productId: string) =>
      [...user(userId), 'reviews', productId] as const,
    /** The one delivered product the account page may ask about. */
    prompt: (userId: string | null) => [...user(userId), 'reviews', 'prompt'] as const,
    /** Delivered products this account has not reviewed yet. */
    pending: (userId: string | null) => [...user(userId), 'reviews', 'pending'] as const,
  },
  returns: {
    all: (userId: string | null) => [...user(userId), 'returns'] as const,
    /** The customer's own return requests. */
    list: (userId: string | null) => [...user(userId), 'returns', 'list'] as const,
    detail: (userId: string | null, returnId: string) =>
      [...user(userId), 'returns', 'detail', returnId] as const,
  },
  support: {
    all: (userId: string | null) => [...user(userId), 'support'] as const,
    /** The customer's own conversations. */
    conversations: (userId: string | null) =>
      [...user(userId), 'support', 'conversations'] as const,
    conversation: (userId: string | null, conversationId: string) =>
      [...user(userId), 'support', 'conversation', conversationId] as const,
    messages: (userId: string | null, conversationId: string) =>
      [...user(userId), 'support', 'messages', conversationId] as const,
    pins: (userId: string | null, conversationId: string) =>
      [...user(userId), 'support', 'pins', conversationId] as const,
    reactions: (userId: string | null, conversationId: string) =>
      [...user(userId), 'support', 'reactions', conversationId] as const,
    search: (userId: string | null, query: string) =>
      [...user(userId), 'support', 'search', query] as const,
  },
} as const;
