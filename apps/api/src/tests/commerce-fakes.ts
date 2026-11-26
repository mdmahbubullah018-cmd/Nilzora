import { randomUUID } from 'node:crypto';
import {
  MAX_ADDRESSES,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type Address,
  type CartItem,
  type CartLine,
  type CartLineProblem,
  type CartQuote,
  type CatalogSort,
  type DeliveryZone,
  type MediaPicture,
  type OrderDetail,
} from '@nilzora/contracts';
import type { CommerceStores } from '../app';
import type { AddressFields, AddressStore } from '../modules/addresses/store';
import type { CartStore } from '../modules/cart/store';
import {
  branchSlugs,
  stockView,
  type CatalogStore,
  type ProductSearch,
} from '../modules/catalog/store';
import { toStoreError } from '../modules/commerce/errors';
import type { OrderStore } from '../modules/orders/store';
import type { FakeIdentity } from './fakes';

/*
 * In-memory stand-ins for the commerce tables and SQL functions, for unit tests of
 * the API's routes. They follow the migration's rules (visibility, pricing, stock,
 * idempotency, limits, ownership) and fail the way the database does: with the
 * same SQLSTATEs, passed through the same toStoreError() mapping as the Supabase
 * stores. The real functions are covered by pgTAP and the integration tests.
 */

export interface FakeCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Parent category id; absent or null makes it a top-level department. */
  parentId?: string | null;
  /** Cover picture as tests want it returned; the fake does not build URLs. */
  image?: MediaPicture | null;
  isFeatured?: boolean;
}

export interface FakeProduct {
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
  status: 'draft' | 'active' | 'archived';
  isFeatured: boolean;
  publishedAt: string;
  /** Options this product sells as. Empty for a simple product. */
  variants: FakeVariant[];
  /** The product's active brand, when it has one. */
  brand?: { slug: string; name: string } | null;
}

/**
 * One option set of a product. The database prices and stocks each variant on its own, so
 * the fake does too: a variant line is priced from the variant, never from the product.
 */
export interface FakeVariant {
  id: string;
  label: string;
  priceMinor: number;
  stock: number;
  isActive: boolean;
  /** Defaults to the product's sku when not set. */
  sku: string | null;
}

interface FakeAddress extends Address {
  userId: string;
}

/** A shopping zone as the fake knows it: a slug and the products pinned to it. */
export interface FakeZone {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: string | null;
  productIds: string[];
}

interface FakeOrder {
  userId: string;
  idempotencyKey: string;
  fingerprint: string;
  detail: OrderDetail;
}

export interface FakeMovement {
  productId: string;
  change: number;
  stockAfter: number;
  reason: 'order_placed' | 'order_cancelled';
  orderNumber: string;
}

/** What a database error looks like, including text that must never reach clients. */
const DB_MESSAGE = 'internal detail: relation private.secret_table, host db.internal:5432';

function raise(code: string, details?: unknown): never {
  throw toStoreError(
    {
      code,
      message: DB_MESSAGE,
      details: details === undefined ? null : JSON.stringify(details),
    },
    'fake',
  );
}

export class FakeCommerce {
  readonly categories: FakeCategory[] = [];
  readonly products: FakeProduct[] = [];
  readonly deliveryCharges = new Map<DeliveryZone, number>([
    ['inside_dhaka', 6000],
    ['outside_dhaka', 12000],
  ]);
  readonly addresses: FakeAddress[] = [];
  readonly orders: FakeOrder[] = [];
  readonly movements: FakeMovement[] = [];
  /** Every catalog search that reached the "database". */
  readonly searches: ProductSearch[] = [];
  /** Every coupon code the routes handed to the store, for a quote or a placement. The fake
   * prices no coupons (that is SQL), so this is how a test proves the code was carried
   * through rather than dropped on the way.
   */
  readonly couponCodes: string[] = [];
  /** The shopping zones this fake knows: a slug, and the products pinned to it. */
  readonly zoneList: FakeZone[] = [];
  /** Simulates an unreachable database (a network failure with no SQLSTATE). */
  unavailable = false;
  private tick = 0;

  constructor(private readonly identity: FakeIdentity) {}

  /** Strictly increasing timestamps keep "newest first" orderings deterministic. */
  private now(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 9, 24, 8, 0, this.tick)).toISOString();
  }

  addZone(options: { slug: string; name?: string; productIds?: readonly string[] }): FakeZone {
    const zone: FakeZone = {
      id: randomUUID(),
      slug: options.slug,
      name: options.name ?? options.slug,
      description: null,
      audience: null,
      productIds: [...(options.productIds ?? [])],
    };
    this.zoneList.push(zone);
    return zone;
  }

  /** Whether a product belongs to a zone — pinned to it here, or nothing at all. */
  private inZone(slug: string, productId: string): boolean {
    const zone = this.zoneList.find((candidate) => candidate.slug === slug);
    return zone !== undefined && zone.productIds.includes(productId);
  }

  addCategory(options: Partial<FakeCategory> & { slug: string }): FakeCategory {
    const category: FakeCategory = {
      id: randomUUID(),
      name: options.slug,
      description: null,
      sortOrder: this.categories.length,
      isActive: true,
      ...options,
    };
    this.categories.push(category);
    return category;
  }

  addProduct(
    options: Partial<FakeProduct> & { slug: string; categoryId: string; priceMinor: number },
  ): FakeProduct {
    const product: FakeProduct = {
      id: randomUUID(),
      sku: options.slug.toUpperCase(),
      name: options.slug,
      summary: null,
      description: null,
      compareAtPriceMinor: null,
      stock: 10,
      maxOrderQuantity: 10,
      status: 'active',
      isFeatured: false,
      publishedAt: this.now(),
      variants: [],
      ...options,
    };
    this.products.push(product);
    return product;
  }

  private available(): void {
    if (this.unavailable) {
      throw toStoreError({ code: '', message: `TypeError: fetch failed (${DB_MESSAGE})` }, 'fake');
    }
  }

  /** auth.uid() for a token; no live session is an RLS denial, as in PostgreSQL. */
  private caller(accessToken: string): { id: string; active: boolean } {
    const user = this.identity.userFor(accessToken);
    if (!user) raise('42501');
    return { id: user.id, active: user.status === 'active' };
  }

  private onSale(productId: string): FakeProduct | undefined {
    const product = this.products.find((candidate) => candidate.id === productId);
    const category = this.categories.find((candidate) => candidate.id === product?.categoryId);
    return product?.status === 'active' && category?.isActive ? product : undefined;
  }

  private zoneOf(address: FakeAddress): DeliveryZone {
    return address.district === 'Dhaka' ? 'inside_dhaka' : 'outside_dhaka';
  }

  /**
   * private.cart_items: 1–30 distinct lines, quantities 1–100 (NZ412). A line is a product
   * and a variant, so two variants of one product are two lines.
   */
  private checkCart(items: CartItem[]): void {
    const ids = new Set(
      items.map(
        (item) => `${item.productId.toLowerCase()}:${(item.variantId ?? '').toLowerCase()}`,
      ),
    );
    if (
      items.length < 1 ||
      items.length > MAX_CART_LINES ||
      ids.size !== items.length ||
      items.some(
        (item) =>
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > MAX_LINE_QUANTITY,
      )
    ) {
      raise('NZ412');
    }
  }

  /** private.price_cart */
  private priceLines(items: CartItem[]): CartLine[] {
    this.checkCart(items);
    return items.map((item) => {
      const product = this.onSale(item.productId);
      const variant =
        product && item.variantId
          ? product.variants.find((v) => v.id === item.variantId)
          : undefined;
      if (!product || (item.variantId && (!variant || !variant.isActive))) {
        return {
          productId: item.productId,
          variantId: item.variantId ?? null,
          variantLabel: null,
          slug: null,
          name: null,
          sku: null,
          unitPriceMinor: null,
          compareAtPriceMinor: null,
          listPriceMinor: null,
          campaignDiscountMinor: 0,
          campaign: null,
          quantity: item.quantity,
          lineTotalMinor: null,
          availableQuantity: null,
          problem: 'unavailable',
          image: null,
        };
      }
      // A variant is priced and stocked on its own; a simple product uses its own two values.
      const unitPriceMinor = variant ? variant.priceMinor : product.priceMinor;
      const stock = variant ? variant.stock : product.stock;
      // price_cart: a product that has variants cannot be bought without choosing one.
      const problem: CartLineProblem | null =
        !variant && product.variants.length > 0
          ? 'variant_required'
          : item.quantity > product.maxOrderQuantity
            ? 'quantity_limit'
            : item.quantity > stock
              ? 'insufficient_stock'
              : null;
      return {
        productId: product.id,
        variantId: variant ? variant.id : null,
        variantLabel: variant ? variant.label : null,
        slug: product.slug,
        name: product.name,
        sku: variant?.sku ?? product.sku,
        unitPriceMinor,
        compareAtPriceMinor: variant ? null : product.compareAtPriceMinor,
        listPriceMinor: variant ? null : product.compareAtPriceMinor,
        campaignDiscountMinor: 0,
        campaign: null,
        quantity: item.quantity,
        lineTotalMinor: unitPriceMinor * item.quantity,
        availableQuantity: Math.min(stock, product.maxOrderQuantity),
        problem,
        image: null,
      };
    });
  }

  /** public.quote_cart */
  private quote(items: CartItem[], address?: FakeAddress): CartQuote {
    const lines = this.priceLines(items);
    const ok = lines.filter((line) => line.problem === null);
    const subtotal = ok.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
    const zone = address ? this.zoneOf(address) : null;
    const fee = zone ? (this.deliveryCharges.get(zone) ?? null) : null;
    return {
      lines,
      itemCount: ok.reduce((sum, line) => sum + line.quantity, 0),
      subtotalMinor: subtotal,
      campaignDiscountMinor: 0,
      deliveryZone: zone,
      shippingFeeMinor: fee,
      totalMinor: fee === null ? null : subtotal + fee,
      purchasable: ok.length === lines.length && (address === undefined || fee !== null),
    };
  }

  private ownAddress(userId: string, addressId: string): FakeAddress | undefined {
    return this.addresses.find((address) => address.id === addressId && address.userId === userId);
  }

  private ownOrder(userId: string, orderNumber: string): FakeOrder | undefined {
    return this.orders.find(
      (order) => order.userId === userId && order.detail.orderNumber === orderNumber,
    );
  }

  private publicAddress(address: FakeAddress): Address {
    const { userId: _userId, ...rest } = address;
    return structuredClone(rest);
  }

  private makeDefault(address: FakeAddress): void {
    for (const other of this.addresses) {
      if (other.userId === address.userId) other.isDefault = other === address;
    }
  }

  readonly catalog: CatalogStore = {
    listCategories: () => {
      this.available();
      const active = this.categories.filter((category) => category.isActive);
      const byId = new Map(active.map((category) => [category.id, category]));
      const childrenOf = (parentId: string | null) =>
        active
          .filter((category) => (category.parentId ?? null) === parentId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      // The published tree in path order: each department, then its descendants.
      const ordered: FakeCategory[] = [];
      const walk = (parentId: string | null, depth: number) => {
        if (depth > 3) return;
        for (const category of childrenOf(parentId)) {
          ordered.push(category);
          walk(category.id, depth + 1);
        }
      };
      walk(null, 1);
      return Promise.resolve(
        ordered.map((category) => {
          const parentId = category.parentId ?? null;
          const parent = parentId === null ? undefined : byId.get(parentId);
          let depth = 1;
          for (
            let cursor = parent;
            cursor !== undefined;
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
          ) {
            depth += 1;
          }
          return {
            slug: category.slug,
            name: category.name,
            description: category.description,
            productCount: this.products.filter(
              (product) => product.categoryId === category.id && product.status === 'active',
            ).length,
            image: category.image ?? null,
            parentSlug: parent?.slug ?? null,
            depth,
            isFeatured: category.isFeatured ?? false,
          };
        }),
      );
    },

    listProducts: async (search) => {
      this.available();
      this.searches.push(search);
      const terms = [...(search.prefixQuery ?? '').matchAll(/'([^']*)':\*/g)].map(
        (match) => match[1] ?? '',
      );
      const published = await this.catalog.listCategories();
      const inCategory =
        search.categorySlug === undefined
          ? null
          : search.includeSubcategories === true
            ? branchSlugs(published, search.categorySlug)
            : [search.categorySlug];
      const matches = this.products.filter((product) => {
        if (!this.onSale(product.id)) return false;
        // A zone filters by membership, exactly as the database's predicate does.
        if (search.zoneSlug !== undefined && !this.inZone(search.zoneSlug, product.id)) return false;
        const category = this.categories.find((candidate) => candidate.id === product.categoryId);
        if (inCategory !== null && !inCategory.includes(category?.slug ?? '')) return false;
        if (search.brandSlug !== undefined && product.brand?.slug !== search.brandSlug) {
          return false;
        }
        if (search.minPriceMinor !== undefined && product.priceMinor < search.minPriceMinor) {
          return false;
        }
        if (search.maxPriceMinor !== undefined && product.priceMinor > search.maxPriceMinor) {
          return false;
        }
        if (search.inStock === true && product.stock <= 0) return false;
        const words = [product.name, product.summary ?? '', product.description ?? '']
          .join(' ')
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u);
        return terms.every((term) => words.some((word) => word.startsWith(term)));
      });
      const newest = (a: FakeProduct, b: FakeProduct) => b.publishedAt.localeCompare(a.publishedAt);
      const order: Record<CatalogSort, (a: FakeProduct, b: FakeProduct) => number> = {
        featured: (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || newest(a, b),
        newest,
        price_asc: (a, b) => a.priceMinor - b.priceMinor || newest(a, b),
        price_desc: (a, b) => b.priceMinor - a.priceMinor || newest(a, b),
        relevance: newest,
      };
      matches.sort(order[search.sort]);
      const items = matches.slice(search.offset, search.offset + search.limit).map((product) => {
        const category = this.categories.find((candidate) => candidate.id === product.categoryId);
        return {
          id: product.id,
          slug: product.slug,
          sku: product.sku,
          name: product.name,
          summary: product.summary,
          priceMinor: product.priceMinor,
          compareAtPriceMinor: product.compareAtPriceMinor,
          ...stockView({
            stock_quantity: product.stock,
            max_order_quantity: product.maxOrderQuantity,
          }),
          isFeatured: product.isFeatured,
          category: { slug: category?.slug ?? '', name: category?.name ?? '' },
          image: null,
          brand: product.brand ?? null,
          campaign: null,
        };
      });
      return Promise.resolve({ items, total: matches.length });
    },

    // The same card shape, for a known set of ids: only products on sale come back.
    listProductsByIds: (ids) => {
      this.available();
      const wanted = new Set(ids);
      const items = this.products
        .filter((product) => wanted.has(product.id) && this.onSale(product.id))
        .map((product) => {
          const category = this.categories.find(
            (candidate) => candidate.id === product.categoryId,
          );
          return {
            id: product.id,
            slug: product.slug,
            sku: product.sku,
            name: product.name,
            summary: product.summary,
            priceMinor: product.priceMinor,
            compareAtPriceMinor: product.compareAtPriceMinor,
            ...stockView({
              stock_quantity: product.stock,
              max_order_quantity: product.maxOrderQuantity,
            }),
            isFeatured: product.isFeatured,
            category: { slug: category?.slug ?? '', name: category?.name ?? '' },
            image: null,
            brand: product.brand ?? null,
            campaign: null,
          };
        });
      return Promise.resolve(items);
    },

    // A scanned SKU or product slug, resolved through the same card shape.
    findProductByCode: async (code) => {
      this.available();
      const value = code.trim().toLowerCase();
      const product = this.products.find(
        (candidate) =>
          this.onSale(candidate.id) &&
          (candidate.sku.toLowerCase() === value || candidate.slug === value),
      );
      if (product === undefined) return null;
      const [card] = await this.catalog.listProductsByIds([product.id]);
      return card ?? null;
    },

    getProduct: (slug) => {
      this.available();
      const product = this.products.find(
        (candidate) => candidate.slug === slug && this.onSale(candidate.id),
      );
      if (!product) return Promise.resolve(null);
      const category = this.categories.find((candidate) => candidate.id === product.categoryId);
      return Promise.resolve({
        id: product.id,
        slug: product.slug,
        sku: product.sku,
        name: product.name,
        summary: product.summary,
        description: product.description,
        priceMinor: product.priceMinor,
        compareAtPriceMinor: product.compareAtPriceMinor,
        ...stockView({
          stock_quantity: product.stock,
          max_order_quantity: product.maxOrderQuantity,
        }),
        isFeatured: product.isFeatured,
        category: { slug: category?.slug ?? '', name: category?.name ?? '' },
        image: null,
        images: [],
        variants: [],
        campaign: null,
      });
    },

    // Campaigns are a database feature; a unit fake prices none of them.
    listCampaigns: () => {
      this.available();
      return Promise.resolve([]);
    },

    // Size and colour options come from the variant system: this fake holds no variants, so it
    // honestly offers none (a listing then shows no size or colour control).
    listFacets: () => {
      this.available();
      return Promise.resolve({ sizes: [], colors: [] });
    },

    // Shopping zones are a database feature: the fake holds only the collections a test adds.
    getZone: (slug) => {
      this.available();
      const zone = this.zoneList.find((candidate) => candidate.slug === slug);
      if (zone === undefined) return Promise.resolve(null);
      return Promise.resolve({
        id: zone.id,
        slug: zone.slug,
        name: zone.name,
        description: zone.description,
        audience: zone.audience,
        banner: null,
        bannerAlt: null,
        productCount: zone.productIds.filter((id) => this.onSale(id)).length,
      });
    },
  };

  readonly cart: CartStore = {
    quote: (items) => {
      this.available();
      return Promise.resolve(this.quote(items));
    },
    quoteForCustomer: (accessToken, userId, items, addressId, couponCode) => {
      this.available();
      const caller = this.caller(accessToken);
      this.priceLines(items);
      if (couponCode !== undefined) this.couponCodes.push(couponCode);
      // The verified account and the token must agree; only its own address counts.
      const address = caller.id === userId ? this.ownAddress(userId, addressId) : undefined;
      if (!address) raise('NZ411');
      const quote = this.quote(items, address);
      // The database prices coupons; this fake only carries the code, so a couponed
      // quote is the undiscounted one. Coupon rules are tested against the SQL.
      if (couponCode === undefined) {
        return Promise.resolve({ ...quote, discountMinor: 0, coupon: null, couponProblem: null });
      }
      return Promise.resolve({
        ...quote,
        discountMinor: 0,
        coupon: null,
        couponProblem: 'This fake prices no coupons',
      });
    },
  };

  readonly addressStore: AddressStore = {
    list: (accessToken, userId) => {
      this.available();
      const caller = this.caller(accessToken);
      const own = this.addresses
        .filter((address) => address.userId === caller.id && caller.id === userId)
        .sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) || b.createdAt.localeCompare(a.createdAt),
        );
      return Promise.resolve(own.map((address) => this.publicAddress(address)));
    },

    create: (accessToken, _userId, fields) => {
      this.available();
      const caller = this.caller(accessToken);
      // RLS: suspended accounts cannot add addresses.
      if (!caller.active) raise('42501');
      const existing = this.addresses.filter((address) => address.userId === caller.id);
      if (existing.length >= MAX_ADDRESSES) raise('NZ421');
      const now = this.now();
      const address: FakeAddress = {
        id: randomUUID(),
        userId: caller.id,
        ...this.columns(fields),
        isDefault: existing.length === 0 || fields.isDefault === true,
        deliveryZone: 'outside_dhaka',
        createdAt: now,
        updatedAt: now,
      };
      address.deliveryZone = this.zoneOf(address);
      this.addresses.push(address);
      if (address.isDefault) this.makeDefault(address);
      return Promise.resolve(this.publicAddress(address));
    },

    update: (accessToken, userId, addressId, fields) => {
      this.available();
      const caller = this.caller(accessToken);
      const address = caller.id === userId ? this.ownAddress(caller.id, addressId) : undefined;
      if (!address || !caller.active) return Promise.resolve(null);
      Object.assign(address, this.columns(fields), { updatedAt: this.now() });
      address.deliveryZone = this.zoneOf(address);
      if (fields.isDefault === true) this.makeDefault(address);
      return Promise.resolve(this.publicAddress(address));
    },

    remove: (accessToken, userId, addressId) => {
      this.available();
      const caller = this.caller(accessToken);
      const address = caller.id === userId ? this.ownAddress(caller.id, addressId) : undefined;
      if (!address || !caller.active) return Promise.resolve(false);
      this.addresses.splice(this.addresses.indexOf(address), 1);
      if (address.isDefault) {
        const next = this.addresses
          .filter((other) => other.userId === caller.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (next) next.isDefault = true;
      }
      return Promise.resolve(true);
    },
  };

  private columns(fields: AddressFields) {
    return {
      label: fields.label ?? null,
      recipientName: fields.recipientName,
      phone: fields.phone,
      division: fields.division,
      district: fields.district,
      area: fields.area,
      addressLine: fields.addressLine,
      postalCode: fields.postalCode ?? null,
      landmark: fields.landmark ?? null,
    };
  }

  /** Moves stock for every line of an order and records it in the ledger. */
  private moveStock(order: OrderDetail, sign: 1 | -1, reason: FakeMovement['reason']): void {
    for (const item of order.items) {
      const product = this.products.find((candidate) => candidate.id === item.productId);
      if (!product) continue;
      const variant = item.variantId
        ? product.variants.find((candidate) => candidate.id === item.variantId)
        : undefined;
      if (variant) variant.stock += sign * item.quantity;
      product.stock += sign * item.quantity;
      this.movements.push({
        productId: product.id,
        change: sign * item.quantity,
        stockAfter: product.stock,
        reason,
        orderNumber: order.orderNumber,
      });
    }
  }

  readonly orderStore: OrderStore = {
    place: (accessToken, userId, input) => {
      this.available();
      const caller = this.caller(accessToken);
      if (!caller.active) raise('NZ410');
      this.checkCart(input.items);
      if (input.couponCode !== undefined) this.couponCodes.push(input.couponCode);
      const fingerprint = JSON.stringify({
        address: input.addressId,
        note: input.note ?? null,
        items: input.items
          .map(
            (item) =>
              [
                item.productId.toLowerCase(),
                (item.variantId ?? '').toLowerCase(),
                item.quantity,
              ] as const,
          )
          .sort(([a, aVariant], [b, bVariant]) =>
            a === b ? aVariant.localeCompare(bVariant) : a.localeCompare(b),
          ),
      });

      const existing = this.orders.find(
        (order) => order.userId === caller.id && order.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint) raise('NZ416');
        return Promise.resolve({ order: structuredClone(existing.detail), created: false });
      }
      const pending = this.orders.filter(
        (order) => order.userId === caller.id && order.detail.status === 'pending',
      );
      if (pending.length >= 5) raise('NZ420');

      const address = this.ownAddress(caller.id, input.addressId);
      if (!address) raise('NZ411');
      const zone = this.zoneOf(address);
      const fee = this.deliveryCharges.get(zone);
      if (fee === undefined) raise('NZ417');

      const lines = this.priceLines(input.items);
      const problems = lines
        .filter((line) => line.problem !== null)
        .map((line) => ({ productId: line.productId, problem: line.problem }));
      if (problems.some((problem) => problem.problem === 'unavailable')) raise('NZ413', problems);
      if (problems.some((problem) => problem.problem === 'variant_required')) raise('NZ471');
      if (problems.some((problem) => problem.problem === 'quantity_limit')) {
        raise('NZ415', problems);
      }
      if (problems.length > 0) raise('NZ414', problems);

      const subtotal = lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
      if (input.expectedTotalMinor !== subtotal + fee) {
        raise('NZ418', { totalMinor: subtotal + fee });
      }

      const placedAt = this.now();
      const detail: OrderDetail = {
        orderNumber: `NZ${100001 + this.orders.length}`,
        status: 'pending',
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
        totalMinor: subtotal + fee,
        placedAt,
        preview: [],
        currency: 'BDT',
        subtotalMinor: subtotal,
        shippingFeeMinor: fee,
        discountMinor: 0,
        deliveryZone: zone,
        shippingAddress: {
          recipientName: address.recipientName,
          phone: address.phone,
          division: address.division,
          district: address.district,
          area: address.area,
          addressLine: address.addressLine,
          postalCode: address.postalCode,
          landmark: address.landmark,
        },
        customerNote: input.note ?? null,
        cancelReason: null,
        cancelledAt: null,
        items: lines.map((line, index) => ({
          orderItemId: index + 1,
          productId: line.productId,
          variantId: line.variantId,
          variantLabel: line.variantLabel,
          productName: line.name ?? '',
          productSlug: line.slug ?? '',
          sku: line.sku ?? '',
          unitPriceMinor: line.unitPriceMinor ?? 0,
          quantity: line.quantity,
          lineTotalMinor: line.lineTotalMinor ?? 0,
          image: null,
          regularPriceMinor: line.listPriceMinor ?? line.unitPriceMinor ?? 0,
          catalogPriceMinor: line.unitPriceMinor ?? 0,
          campaignId: line.campaign?.id ?? null,
          campaignTitle: line.campaign?.title ?? null,
          campaignDiscountMinor: line.campaignDiscountMinor,
        })),
        history: [{ fromStatus: null, toStatus: 'pending', at: placedAt }],
        canCancel: true,
      };
      this.orders.push({
        userId: caller.id,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        detail,
      });
      this.moveStock(detail, -1, 'order_placed');
      // Like the Supabase store, the answer is the order read back as the given user.
      const order = this.ownOrder(userId, detail.orderNumber);
      if (!order) raise('PGRST116');
      return Promise.resolve({ order: structuredClone(order.detail), created: true });
    },

    list: (accessToken, userId, { limit, offset }) => {
      this.available();
      const caller = this.caller(accessToken);
      const own = this.orders
        .filter((order) => order.userId === caller.id && caller.id === userId)
        .reverse();
      return Promise.resolve({
        orders: own.slice(offset, offset + limit).map(({ detail }) => ({
          orderNumber: detail.orderNumber,
          status: detail.status,
          paymentMethod: detail.paymentMethod,
          paymentStatus: detail.paymentStatus,
          itemCount: detail.itemCount,
          totalMinor: detail.totalMinor,
          placedAt: detail.placedAt,
          // The first three lines, as the real list reads them.
          preview: detail.items.slice(0, 3).map((item) => ({
            productName: item.productName,
            variantLabel: item.variantLabel,
            quantity: item.quantity,
            image: item.image,
          })),
        })),
        total: own.length,
      });
    },

    get: (accessToken, userId, orderNumber) => {
      this.available();
      const caller = this.caller(accessToken);
      const order = caller.id === userId ? this.ownOrder(caller.id, orderNumber) : undefined;
      return Promise.resolve(order ? structuredClone(order.detail) : null);
    },

    cancel: (accessToken, userId, orderNumber, reason) => {
      this.available();
      const caller = this.caller(accessToken);
      if (!caller.active) raise('NZ410');
      const order = this.ownOrder(caller.id, orderNumber);
      if (!order || caller.id !== userId) raise('NZ404');
      if (order.detail.status !== 'pending') raise('NZ419');
      const at = this.now();
      Object.assign(order.detail, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        cancelReason: reason ?? null,
        cancelledAt: at,
        canCancel: false,
      });
      order.detail.history.push({ fromStatus: 'pending', toStatus: 'cancelled', at });
      this.moveStock(order.detail, 1, 'order_cancelled');
      return Promise.resolve(structuredClone(order.detail));
    },
  };

  get stores(): CommerceStores {
    return {
      catalog: this.catalog,
      cart: this.cart,
      addresses: this.addressStore,
      orders: this.orderStore,
    };
  }
}
