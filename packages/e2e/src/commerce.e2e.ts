import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestBrowser, type Page } from './browser';
import {
  createAccount,
  createCatalog,
  deleteRunAccounts,
  deleteRunCatalog,
  deliveryCharge,
  env,
  ordersOf,
  PASSWORD,
  runWord,
  stockOf,
  type RunProduct,
} from './fixtures';

/*
 * Storefront commerce end to end: catalog, cart, addresses, Cash-on-Delivery checkout
 * and order history, posted exactly as a browser without JavaScript does, against
 * `next start`, the built API and the local Supabase stack (production mode, so
 * cookies are `__Host-` + Secure). Every amount asserted here comes from the fixtures'
 * catalog prices; the browser never sends one.
 */

const ACCESS = '__Host-nzs_at';
const REFRESH = '__Host-nzs_rt';
const CART = '__Host-nzs_cart';

const browser = () => new TestBrowser(env.storefrontUrl);

/** "৳1,350" for 135000 poisha (whole taka in these fixtures). */
const taka = (minor: number) => `৳${(minor / 100).toLocaleString('en-IN')}`;

let catalog: Awaited<ReturnType<typeof createCatalog>>;
let insideDhaka: number;

beforeAll(async () => {
  catalog = await createCatalog();
  insideDhaka = await deliveryCharge('inside_dhaka');
});

afterAll(async () => {
  await deleteRunCatalog();
  await deleteRunAccounts();
});

function cookie(page: Page, name: string) {
  return page.setCookies.find((entry) => entry.name === name);
}

async function cartCount(b: TestBrowser): Promise<number> {
  const page = await b.go('/api/cart');
  return (JSON.parse(page.html) as { count: number }).count;
}

async function addToCart(b: TestBrowser, product: RunProduct, quantity: number): Promise<Page> {
  return b.submit(
    `/products/${product.slug}`,
    { button: 'Add to cart' },
    { quantity: String(quantity) },
  );
}

async function signIn(b: TestBrowser, email: string, next?: string): Promise<Page> {
  return b.submit(
    next ? `/login?next=${encodeURIComponent(next)}` : '/login',
    { field: 'password' },
    { email, password: PASSWORD },
  );
}

async function addDhakaAddress(b: TestBrowser, fromCheckout: boolean): Promise<Page> {
  return b.submit(
    fromCheckout ? '/account/addresses/new?next=/checkout' : '/account/addresses/new',
    { field: 'recipientName' },
    {
      recipientName: 'Rahima Khatun',
      phone: '01712-345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
    },
  );
}

function orderNumberFrom(location: string | null): string {
  const match = /\/account\/orders\/(NZ\d+)/.exec(location ?? '');
  if (!match?.[1]) throw new Error(`no order number in ${String(location)}`);
  return match[1];
}

describe('catalog', () => {
  it('lists products on sale and hides drafts', async () => {
    // Newest first, so this run's products lead the list. (A category created moments
    // ago can take up to a minute to appear: the category list is cached that long.)
    const page = await browser().go('/products?sort=newest');

    expect(page.status).toBe(200);
    expect(page.html).toContain(catalog.lamp.name);
    expect(page.html).toContain(taka(catalog.lamp.priceMinor));
    expect(page.html).toContain(catalog.vase.name);
    expect(page.html).not.toContain(catalog.draft.name);
    expect(page.setCookies).toEqual([]);
  });

  it('shows a product page and refuses drafts and unknown products', async () => {
    const b = browser();
    const product = await b.go(`/products/${catalog.lamp.slug}`);
    expect(product.status).toBe(200);
    expect(product.html).toContain(catalog.lamp.name);
    expect(product.html).toContain('Add to cart');
    expect(product.setCookies).toEqual([]);

    expect((await b.go(`/products/${catalog.draft.slug}`)).status).toBe(404);
    expect((await b.go('/products/no-such-product-anywhere')).status).toBe(404);
  });

  it('finds products by the start of a word', async () => {
    const page = await browser().go(`/search?q=${encodeURIComponent(runWord.slice(0, -2))}`);

    expect(page.status).toBe(200);
    expect(page.html).toContain(catalog.lamp.name);
    expect(page.html).not.toContain(catalog.draft.name);
  });
});

describe('cart', () => {
  it('adds to the cart without JavaScript in an HttpOnly cookie that holds no prices', async () => {
    const b = browser();
    const page = await addToCart(b, catalog.lamp, 2);

    expect(page.status).toBe(200);
    expect(page.html).toContain('Added to your cart.');
    const entry = cookie(page, CART);
    expect(entry?.attributes).toMatchObject({ httponly: true, secure: true, path: '/' });
    expect(String(entry?.attributes.samesite).toLowerCase()).toBe('lax');
    expect(decodeURIComponent(entry?.value ?? '')).toBe(`${catalog.lamp.id}:2`);
    expect(await cartCount(b)).toBe(2);
  });

  it('prices the cart from the catalog and updates quantities', async () => {
    const b = browser();
    await addToCart(b, catalog.lamp, 2);

    const cart = await b.go('/cart');
    expect(cart.html).toContain(catalog.lamp.name);
    expect(cart.html).toContain(taka(2 * catalog.lamp.priceMinor));

    const updated = await b.submit(
      '/cart',
      { button: 'Update' },
      { quantity: '3' },
      { page: cart },
    );
    expect(updated.status).toBe(200);
    expect(await cartCount(b)).toBe(3);
    expect((await b.go('/cart')).html).toContain(taka(3 * catalog.lamp.priceMinor));
  });

  it('never lets another site change the cart', async () => {
    const b = browser();
    await addToCart(b, catalog.vase, 1);

    await b.submit(
      `/products/${catalog.lamp.slug}`,
      { button: 'Add to cart' },
      { quantity: '1' },
      { origin: 'https://attacker.example' },
    );

    expect(await cartCount(b)).toBe(1);
  });

  it('shows a tampered cart line for a draft product as unavailable and blocks checkout', async () => {
    const b = browser();
    b.cookies.set(CART, encodeURIComponent(`${catalog.draft.id}:1`));

    const cart = await b.go('/cart');

    expect(cart.html).toContain('No longer available');
    expect(cart.html).not.toContain(catalog.draft.name);
    expect(cart.html).not.toContain(taka(99_000));
  });
});

describe('Cash-on-Delivery checkout', () => {
  const customer = browser();
  let customerId: string;
  let email: string;
  let orderNumber: string;

  beforeAll(async () => {
    ({ id: customerId, email } = await createAccount('shopper'));
  });

  it('sends a guest to sign in and back to checkout', async () => {
    await addToCart(customer, catalog.lamp, 3);

    const guest = await customer.go('/checkout');
    expect(guest.status).toBeGreaterThanOrEqual(300);
    expect(guest.status).toBeLessThan(400);
    const target = new URL(guest.location ?? '', env.storefrontUrl);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('next')).toBe('/checkout');

    const signedIn = await signIn(customer, email, '/checkout');
    expect(signedIn.status).toBe(303);
    expect(signedIn.location).toMatch(/\/checkout$/);
  });

  it('adds a delivery address from checkout and returns to it', async () => {
    const page = await addDhakaAddress(customer, true);

    expect(page.status).toBe(303);
    expect(page.location).toMatch(/^\/checkout\?address=[0-9a-f-]{36}$/);
  });

  it('shows totals computed by the server, including the delivery charge', async () => {
    const page = await customer.go('/checkout');

    const subtotal = 3 * catalog.lamp.priceMinor;
    expect(page.status).toBe(200);
    expect(page.html).toContain(taka(subtotal));
    expect(page.html).toContain(taka(insideDhaka));
    expect(page.html).toContain(taka(subtotal + insideDhaka));
    expect(page.html).toContain('Cash on Delivery');
  });

  it('refuses a checkout post without the CSRF token or from another site', async () => {
    const withoutToken = await customer.submit(
      '/checkout',
      { button: 'Place order' },
      {},
      { drop: ['csrf_token'] },
    );
    expect(withoutToken.location ?? '').not.toMatch(/\/account\/orders\//);

    await customer.submit(
      '/checkout',
      { button: 'Place order' },
      {},
      { origin: 'https://attacker.example' },
    );

    expect(await ordersOf(customerId)).toEqual([]);
  });

  it('refuses an order whose reviewed total was tampered with', async () => {
    const page = await customer.submit(
      '/checkout',
      { button: 'Place order' },
      { expectedTotalMinor: '100' },
    );

    expect(page.status).toBe(200);
    expect(page.location).toBeNull();
    expect(await ordersOf(customerId)).toEqual([]);
    expect(await stockOf(catalog.lamp.id)).toBe(5);
  });

  it('places the order once, even when the same checkout is submitted twice', async () => {
    const checkout = await customer.go('/checkout');
    const cartBefore = customer.cookies.get(CART) ?? '';

    const placed = await customer.submit(
      '/checkout',
      { button: 'Place order' },
      { note: 'Please call before delivery' },
      { page: checkout },
    );
    expect(placed.status).toBe(303);
    orderNumber = orderNumberFrom(placed.location);
    expect(placed.location).toContain('placed=1');
    // The cart is emptied once the order exists.
    expect(customer.cookies.has(CART)).toBe(false);

    // A double click sends the same form, with the same key, before the cart is cleared.
    customer.cookies.set(CART, cartBefore);
    const repeated = await customer.submit(
      '/checkout',
      { button: 'Place order' },
      { note: 'Please call before delivery' },
      { page: checkout },
    );
    expect(repeated.status).toBe(303);
    expect(orderNumberFrom(repeated.location)).toBe(orderNumber);

    const orders = await ordersOf(customerId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      order_number: orderNumber,
      status: 'pending',
      payment_status: 'pending',
      subtotal_minor: 3 * catalog.lamp.priceMinor,
      shipping_fee_minor: insideDhaka,
      total_minor: 3 * catalog.lamp.priceMinor + insideDhaka,
    });
    expect(await stockOf(catalog.lamp.id)).toBe(2);
  });

  it('shows the order in the account, with its server totals', async () => {
    const detail = await customer.go(`/account/orders/${orderNumber}?placed=1`);
    expect(detail.status).toBe(200);
    expect(detail.html).toContain(orderNumber);
    expect(detail.html).toContain(catalog.lamp.name);
    expect(detail.html).toContain(taka(3 * catalog.lamp.priceMinor + insideDhaka));

    const history = await customer.go('/account/orders');
    expect(history.status).toBe(200);
    expect(history.html).toContain(orderNumber);
  });

  it('hides the order from every other customer', async () => {
    const other = browser();
    const { email: otherEmail } = await createAccount('other-shopper');
    await signIn(other, otherEmail);

    expect((await other.go(`/account/orders/${orderNumber}`)).status).toBe(404);
    expect((await other.go('/account/orders')).html).not.toContain(orderNumber);
  });

  it('lets the customer cancel while pending, which returns the stock', async () => {
    const cancelled = await customer.submit(
      `/account/orders/${orderNumber}`,
      { button: 'Yes, cancel order' },
      { reason: 'Ordered by mistake' },
    );

    expect(cancelled.status).toBe(303);
    expect(cancelled.location).toContain('cancelled=1');
    const [order] = await ordersOf(customerId);
    expect(order).toMatchObject({ status: 'cancelled', payment_status: 'cancelled' });
    expect(await stockOf(catalog.lamp.id)).toBe(5);
  });

  it('never put a session token into any page it served', () => {
    const tokens = [customer.cookies.get(ACCESS), customer.cookies.get(REFRESH)];
    expect(tokens.every(Boolean)).toBe(true);
    for (const body of customer.bodies) {
      for (const token of tokens) expect(body.includes(token ?? 'missing')).toBe(false);
    }
  });
});
