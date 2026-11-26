import type {
  AdminCheckoutListQuery,
  CheckoutDetail,
  CheckoutRecoveryChannel,
  CheckoutRecoveryLink,
  CheckoutRecoveryMetrics,
  CheckoutRecoveryPreview,
  CheckoutRecoveryState,
  CheckoutSummary,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import type { SavedCartStore } from '../modules/carts/store';
import { CommerceRefusalError } from '../modules/commerce/errors';

/** One catalog product the fake can price, so admin details are not blank. */
export interface FakeProduct {
  name: string;
  sku: string;
  priceMinor: number;
  /** variant id → label, for the products that have options. */
  variants?: Record<string, string>;
  /** Variant ids that are switched off (the SQL refuses to add them). */
  inactiveVariants?: string[];
  /** A draft or hidden-category product: the SQL refuses to add it. Defaults to on sale. */
  offSale?: boolean;
}

interface Line {
  productId: string;
  variantId: string | null;
  quantity: number;
}

interface FakeCart {
  id: string;
  status: 'active' | 'checkout' | 'converted' | 'expired';
  lines: Line[];
  lastActivityAt: string;
  guestToken: string | null;
  userId: string | null;
}

interface FakeSession {
  id: string;
  cartId: string;
  userId: string;
  status: 'started' | 'incomplete' | 'converted' | 'expired';
  recoveryState: 'open' | 'contacted' | 'dismissed';
  startedAt: string;
  lastActivityAt: string;
  couponCode: string | null;
  orderNumber: string | null;
}

const NOW = '2026-11-05T10:00:00.000Z';

/**
 * An in-memory twin of the persisted-cart SQL: the same lifecycle, the same refusals and
 * the same "another customer's session is a silent no-op" rule. It is not a database and
 * proves nothing about the migration; it only lets the routes be tested.
 */
export class FakeSavedCarts implements SavedCartStore {
  readonly carts = new Map<string, FakeCart>();
  readonly sessions = new Map<string, FakeSession>();
  /** Names of the calls made, so a test can prove a mutation never reached past a guard. */
  readonly calls: string[] = [];

  constructor(
    private readonly products: Record<string, FakeProduct> = {},
    private readonly names: Record<string, string> = {},
  ) {}

  private record(call: string): void {
    this.calls.push(call);
  }

  private static cartOf(cart: FakeCart): { cart: Omit<FakeCart, 'guestToken' | 'userId'> } {
    return {
      cart: {
        id: cart.id,
        status: cart.status,
        lines: cart.lines.map((line) => ({ ...line })),
        lastActivityAt: cart.lastActivityAt,
      },
    };
  }

  private userCart(userId: string): FakeCart {
    for (const cart of this.carts.values()) {
      if (cart.userId === userId && (cart.status === 'active' || cart.status === 'checkout')) {
        return cart;
      }
    }
    const cart: FakeCart = {
      id: randomUUID(),
      status: 'active',
      lines: [],
      lastActivityAt: NOW,
      guestToken: null,
      userId,
    };
    this.carts.set(cart.id, cart);
    return cart;
  }

  private validate(input: { productId: string; variantId: string | null; quantity: number }): void {
    if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 100) {
      throw new CommerceRefusalError('cart_invalid');
    }
    const product = this.products[input.productId];
    if (!product) throw new CommerceRefusalError('cart_line_invalid');
    if (input.variantId !== null && !(input.variantId in (product.variants ?? {}))) {
      throw new CommerceRefusalError('cart_line_invalid');
    }
    // Removing a line (quantity 0) is never validated further, so legacy lines can go.
    if (input.quantity === 0) return;
    const problem = FakeSavedCarts.lineProblem(product, input.variantId);
    if (problem === 'off_sale') throw new CommerceRefusalError('cart_line_invalid');
    if (problem !== null) throw new CommerceRefusalError(problem);
  }

  /** The twin of private.cart_line_problem() for a line that is being added. */
  private static lineProblem(
    product: FakeProduct,
    variantId: string | null,
  ): 'off_sale' | 'variant_required' | 'variant_invalid' | null {
    if (product.offSale === true) return 'off_sale';
    if (variantId === null) {
      return Object.keys(product.variants ?? {}).length > 0 ? 'variant_required' : null;
    }
    return (product.inactiveVariants ?? []).includes(variantId) ? 'variant_invalid' : null;
  }

  private static apply(cart: FakeCart, input: Line): void {
    cart.lines = cart.lines.filter(
      (line) => !(line.productId === input.productId && line.variantId === input.variantId),
    );
    if (input.quantity > 0) cart.lines.push({ ...input });
    cart.lastActivityAt = NOW;
  }

  myCart(_accessToken: string, userId: string) {
    this.record('myCart');
    return Promise.resolve(FakeSavedCarts.cartOf(this.userCart(userId)));
  }

  guestCart(token: string) {
    this.record('guestCart');
    for (const cart of this.carts.values()) {
      if (cart.guestToken === token) return Promise.resolve(FakeSavedCarts.cartOf(cart));
    }
    return Promise.resolve(null);
  }

  async startGuestCart(token: string) {
    this.record('startGuestCart');
    const existing = await this.guestCart(token);
    if (existing) return existing;
    const cart: FakeCart = {
      id: randomUUID(),
      status: 'active',
      lines: [],
      lastActivityAt: NOW,
      guestToken: token,
      userId: null,
    };
    this.carts.set(cart.id, cart);
    return FakeSavedCarts.cartOf(cart);
  }

  setGuestItem(
    token: string,
    input: { productId: string; variantId: string | null; quantity: number },
  ) {
    this.record('setGuestItem');
    const cart = [...this.carts.values()].find(
      (candidate) => candidate.guestToken === token && candidate.status === 'active',
    );
    if (!cart) return Promise.reject(new CommerceRefusalError('cart_guest_token_invalid'));
    try {
      this.validate(input);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('invalid line'));
    }
    FakeSavedCarts.apply(cart, input);
    return Promise.resolve(FakeSavedCarts.cartOf(cart));
  }

  clearGuestCart(token: string) {
    this.record('clearGuestCart');
    for (const cart of this.carts.values()) {
      if (cart.guestToken === token) {
        cart.lines = [];
        cart.lastActivityAt = NOW;
      }
    }
    return Promise.resolve();
  }

  setItem(
    _accessToken: string,
    userId: string,
    input: { productId: string; variantId: string | null; quantity: number },
  ) {
    this.record('setItem');
    try {
      this.validate(input);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('invalid line'));
    }
    const cart = this.userCart(userId);
    FakeSavedCarts.apply(cart, input);
    return Promise.resolve(FakeSavedCarts.cartOf(cart));
  }

  clearCart(_accessToken: string, userId: string) {
    this.record('clearCart');
    const cart = this.userCart(userId);
    cart.lines = [];
    cart.lastActivityAt = NOW;
    return Promise.resolve(FakeSavedCarts.cartOf(cart));
  }

  mergeGuestCart(_accessToken: string, userId: string, token: string) {
    this.record('mergeGuestCart');
    const cart = this.userCart(userId);
    const guest = [...this.carts.values()].find(
      (candidate) => candidate.guestToken === token && candidate.status === 'active',
    );
    if (!guest) return Promise.resolve(FakeSavedCarts.cartOf(cart));
    for (const line of guest.lines) {
      // A line the shop would now refuse is left behind; the merge itself never fails.
      const product = this.products[line.productId];
      if (!product || FakeSavedCarts.lineProblem(product, line.variantId) !== null) continue;
      const existing = cart.lines.find(
        (own) => own.productId === line.productId && own.variantId === line.variantId,
      );
      if (existing) existing.quantity = Math.min(existing.quantity + line.quantity, 100);
      else cart.lines.push({ ...line });
    }
    this.carts.delete(guest.id);
    cart.lastActivityAt = NOW;
    return Promise.resolve(FakeSavedCarts.cartOf(cart));
  }

  startCheckout(
    _accessToken: string,
    userId: string,
    input: { addressId?: string; couponCode?: string },
  ) {
    this.record('startCheckout');
    const cart = this.userCart(userId);
    if (cart.lines.length === 0) return Promise.reject(new CommerceRefusalError('cart_invalid'));
    let session = [...this.sessions.values()].find(
      (candidate) =>
        candidate.cartId === cart.id &&
        (candidate.status === 'started' || candidate.status === 'incomplete'),
    );
    if (!session) {
      session = {
        id: randomUUID(),
        cartId: cart.id,
        userId,
        status: 'started',
        recoveryState: 'open',
        startedAt: NOW,
        lastActivityAt: NOW,
        couponCode: input.couponCode ?? null,
        orderNumber: null,
      };
      this.sessions.set(session.id, session);
    } else {
      session.status = 'started';
      session.lastActivityAt = NOW;
      if (input.couponCode !== undefined) session.couponCode = input.couponCode;
    }
    cart.status = 'checkout';
    return Promise.resolve({
      checkout: {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
      },
    });
  }

  checkoutActivity(_accessToken: string, userId: string, sessionId: string) {
    this.record('checkoutActivity');
    const session = this.sessions.get(sessionId);
    // Another customer's session matches nothing, exactly like the guarded UPDATE.
    if (!session || session.userId !== userId) return Promise.resolve();
    if (session.status === 'started' || session.status === 'incomplete') {
      session.status = 'started';
      session.lastActivityAt = NOW;
    }
    return Promise.resolve();
  }

  checkoutConverted(_accessToken: string, userId: string, orderNumber: string) {
    this.record('checkoutConverted');
    const open = [...this.sessions.values()]
      .filter((session) => session.userId === userId && session.status !== 'converted')
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    if (!open) return Promise.resolve();
    if (!this.orders.has(orderNumber)) {
      return Promise.reject(new CommerceRefusalError('checkout_already_converted'));
    }
    open.status = 'converted';
    open.orderNumber = this.orders.get(orderNumber) ?? orderNumber;
    const cart = this.carts.get(open.cartId);
    if (cart) cart.status = 'converted';
    return Promise.resolve();
  }

  /** Order numbers that exist, so conversion can be refused for a stranger's number. */
  readonly orders = new Map<string, string>();

  listCheckouts(
    _accessToken: string,
    _userId: string,
    query: AdminCheckoutListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ checkouts: CheckoutSummary[]; total: number }> {
    this.record('listCheckouts');
    const status = query.status ?? 'all';
    const text = query.q ?? '';
    const all = [...this.sessions.values()]
      .filter((session) => status === 'all' || session.status === status)
      .filter((session) => {
        if (text === '') return true;
        const name = this.names[session.userId] ?? '';
        return name.toLowerCase().includes(text.toLowerCase());
      })
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    const slice = all.slice(page.offset, page.offset + page.limit);
    return Promise.resolve({
      checkouts: slice.map((session) => this.summary(session)),
      total: all.length,
    });
  }

  getCheckout(
    _accessToken: string,
    _userId: string,
    checkoutId: string,
  ): Promise<CheckoutDetail | null> {
    this.record('getCheckout');
    return Promise.resolve(this.detail(checkoutId));
  }

  checkoutMetrics(
    _accessToken: string,
    _userId: string,
    window: { from: string | null; to: string | null },
  ): Promise<CheckoutRecoveryMetrics> {
    this.record('checkoutMetrics');
    const abandoned = [...this.sessions.values()].filter((session) => session.status !== 'started');
    const open = abandoned.filter((session) => session.status === 'incomplete');
    const recovered = abandoned.filter((session) => session.status === 'converted');
    return Promise.resolve({
      from: window.from ?? '2026-01-01T00:00:00.000Z',
      to: window.to ?? '2026-12-31T00:00:00.000Z',
      abandonedCount: abandoned.length,
      openCount: open.length,
      recentCount: open.length,
      potentialValueMinor: open.reduce(
        (total, session) =>
          total +
          (this.carts.get(session.cartId)?.lines ?? []).reduce(
            (sum, line) => sum + line.quantity * (this.products[line.productId]?.priceMinor ?? 0),
            0,
          ),
        0,
      ),
      recoveredCount: recovered.length,
      recoveryRatePercent:
        abandoned.length === 0
          ? null
          : Math.round((recovered.length * 1000) / abandoned.length) / 10,
      attemptCount: [...this.attempts.values()].reduce((total, list) => total + list.length, 0),
      contactedCount: abandoned.filter((session) => session.recoveryState === 'contacted').length,
      dismissedCount: abandoned.filter((session) => session.recoveryState === 'dismissed').length,
      trackingSince: [...this.sessions.values()][0]?.startedAt ?? null,
    });
  }

  recordCheckoutAttempt(
    _accessToken: string,
    _userId: string,
    checkoutId: string,
    input: { channel: CheckoutRecoveryChannel; note?: string },
  ): Promise<CheckoutDetail> {
    this.record('recordCheckoutAttempt');
    const session = this.sessions.get(checkoutId);
    if (!session) return Promise.reject(new Error('not found'));
    const list = this.attempts.get(checkoutId) ?? [];
    list.unshift({
      id: list.length + 1,
      channel: input.channel,
      note: input.note ?? null,
      createdAt: session.lastActivityAt,
      adminName: 'Admin',
    });
    this.attempts.set(checkoutId, list);
    if (session.recoveryState === 'open') session.recoveryState = 'contacted';
    return Promise.resolve(this.detail(checkoutId) as CheckoutDetail);
  }

  setCheckoutRecoveryState(
    _accessToken: string,
    _userId: string,
    checkoutId: string,
    state: CheckoutRecoveryState,
  ): Promise<CheckoutDetail> {
    this.record('setCheckoutRecoveryState');
    const session = this.sessions.get(checkoutId);
    if (!session) return Promise.reject(new Error('not found'));
    session.recoveryState = state;
    return Promise.resolve(this.detail(checkoutId) as CheckoutDetail);
  }

  createCheckoutRecoveryLink(
    _accessToken: string,
    _userId: string,
    checkoutId: string,
  ): Promise<CheckoutRecoveryLink> {
    this.record('createCheckoutRecoveryLink');
    const token = 'a'.repeat(64);
    this.links.set(checkoutId, { token, expiresAt: '2026-12-31T00:00:00.000Z' });
    return Promise.resolve({
      token,
      expiresAt: '2026-12-31T00:00:00.000Z',
      checkoutId,
    });
  }

  revokeCheckoutRecoveryLink(
    _accessToken: string,
    _userId: string,
    checkoutId: string,
  ): Promise<CheckoutDetail> {
    this.record('revokeCheckoutRecoveryLink');
    return Promise.resolve(this.detail(checkoutId) as CheckoutDetail);
  }

  previewRecovery(token: string): Promise<CheckoutRecoveryPreview> {
    this.record('previewRecovery');
    for (const [checkoutId, link] of this.links) {
      if (link.token !== token) continue;
      const session = this.sessions.get(checkoutId);
      if (!session) break;
      return Promise.resolve({
        valid: true,
        reason: null,
        itemCount: this.summary(session).itemCount,
        cartValueMinor: 0,
        expiresAt: link.expiresAt,
      });
    }
    return Promise.resolve({
      valid: false,
      reason: 'not_found',
      itemCount: 0,
      cartValueMinor: 0,
      expiresAt: null,
    });
  }

  restoreRecovery(
    _accessToken: string,
    _userId: string,
    token: string,
  ): Promise<{
    checkoutId: string;
    restoredLines: number;
    lines: { productId: string; variantId: string | null; quantity: number }[];
  }> {
    this.record('restoreRecovery');
    for (const [checkoutId, link] of this.links) {
      if (link.token === token) {
        return Promise.resolve({ checkoutId, restoredLines: 0, lines: [] });
      }
    }
    return Promise.reject(new Error('not found'));
  }

  /** The attempts recorded against each checkout, newest first. */
  readonly attempts = new Map<string, CheckoutDetail['attempts']>();
  /** Tokens minted by createCheckoutRecoveryLink, so a preview can find them. */
  readonly links = new Map<string, { token: string; expiresAt: string }>();

  private detail(checkoutId: string): CheckoutDetail | null {
    const session = this.sessions.get(checkoutId);
    if (!session) return null;
    const cart = this.carts.get(session.cartId);
    return {
      ...this.summary(session),
      convertedAt: session.status === 'converted' ? session.lastActivityAt : null,
      customer: {
        id: session.userId,
        name: this.names[session.userId] ?? null,
        phone: null,
      },
      items: (cart?.lines ?? []).map((line) => {
        const product = this.products[line.productId];
        return {
          productName: product?.name ?? 'Unknown product',
          variantLabel: line.variantId ? (product?.variants?.[line.variantId] ?? null) : null,
          sku: product?.sku ?? 'SKU',
          quantity: line.quantity,
          unitPriceMinor: product?.priceMinor ?? 0,
        };
      }),
      attempts: this.attempts.get(checkoutId) ?? [],
      link: null,
    };
  }

  private summary(session: FakeSession): CheckoutSummary {
    const cart = this.carts.get(session.cartId);
    return {
      id: session.id,
      status: session.status,
      recoveryState: session.recoveryState,
      customerName: this.names[session.userId] ?? null,
      customerPhone: null,
      itemCount: cart?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0,
      couponCode: session.couponCode,
      cartValueMinor: 0,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      abandonedAt: session.status === 'started' ? null : session.lastActivityAt,
      convertedAt: session.status === 'converted' ? session.lastActivityAt : null,
      orderNumber: session.orderNumber,
      attemptCount: this.attempts.get(session.id)?.length ?? 0,
    };
  }

  /** Seeds a checkout for a customer, for admin queue tests. */
  seedCheckout(
    userId: string,
    lines: Line[],
    status: FakeSession['status'] = 'incomplete',
  ): FakeSession {
    const cart: FakeCart = {
      id: randomUUID(),
      status: status === 'converted' ? 'converted' : 'checkout',
      lines,
      lastActivityAt: NOW,
      guestToken: null,
      userId,
    };
    this.carts.set(cart.id, cart);
    const session: FakeSession = {
      id: randomUUID(),
      cartId: cart.id,
      userId,
      status,
      recoveryState: 'open',
      startedAt: NOW,
      lastActivityAt: NOW,
      couponCode: 'EID10',
      orderNumber: status === 'converted' ? 'NZ100001' : null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get store(): SavedCartStore {
    return this;
  }
}
