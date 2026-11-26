import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestBrowser, type Page } from './browser';
import {
  accountByEmail as accountByEmailForRun,
  admin as db,
  createAccount,
  createCatalog,
  deleteRunAccounts,
  deleteRunCatalog,
  emailFor as emailForRun,
  env,
  PASSWORD,
  runSlug,
  setSuspended,
  type Role,
} from './fixtures';

/*
 * Admin and moderator workspaces end to end. Access is decided on the server from the
 * API-verified session; these tests request pages directly by URL, as an attacker would.
 */

const ACCESS = '__Host-nza_at';
const browser = () => new TestBrowser(env.adminUrl);

async function signedIn(role: Role, label: string = role): Promise<TestBrowser> {
  const b = browser();
  const { email } = await createAccount(`admin-${label}`, role);
  const page = await b.submit('/login', { field: 'password' }, { email, password: PASSWORD });
  expect(page.status, `${role} sign-in`).toBe(303);
  return b;
}

/** Markers that only appear inside a rendered workspace (navigation and page content). */
const ADMIN_WORKSPACE = 'Admin navigation';
const MODERATOR_WORKSPACE = 'Moderator navigation';

function isRedirectToLogin(page: Page): boolean {
  return page.status >= 300 && page.status < 400 && /\/login/.test(page.location ?? '');
}

afterAll(async () => {
  // Orders keep their accounts, so this run's catalog and orders go first.
  await deleteRunCatalog();
  await deleteRunAccounts();
});

describe('workspace entry', () => {
  it('sends visitors without a session to sign in, remembering the page', async () => {
    for (const path of ['/admin', '/moderator', '/']) {
      const page = await browser().go(path);
      expect(isRedirectToLogin(page), path).toBe(true);
    }
    expect((await browser().go('/admin')).location).toMatch(/next=%2Fadmin/);
  });

  it('signs customers straight back out and gives them no session', async () => {
    const b = browser();
    const { email } = await createAccount('admin-customer');
    const page = await b.submit('/login', { field: 'password' }, { email, password: PASSWORD });

    expect(page.status).toBe(200);
    expect(page.html).toContain('does not have access');
    expect(b.cookies.has(ACCESS)).toBe(false);
    expect(isRedirectToLogin(await b.go('/admin'))).toBe(true);
  });

  it('does not accept the storefront session on the admin app', async () => {
    const shopper = new TestBrowser(env.storefrontUrl);
    const { email } = await createAccount('admin-cross-app', 'admin');
    await shopper.submit('/login', { field: 'password' }, { email, password: PASSWORD });
    const b = browser();
    for (const [name, value] of shopper.cookies) b.cookies.set(name, value);

    expect(isRedirectToLogin(await b.go('/admin'))).toBe(true);
  });
});

describe('role boundaries', () => {
  it.each<[Role, { admin: boolean; moderator: boolean }]>([
    ['super_admin', { admin: true, moderator: true }],
    ['admin', { admin: true, moderator: true }],
    ['staff', { admin: true, moderator: false }],
    ['moderator', { admin: false, moderator: true }],
  ])('%s reaches only its workspaces', async (role, allowed) => {
    const b = await signedIn(role);
    const adminPage = await b.go('/admin');
    const moderatorPage = await b.go('/moderator');

    expect(adminPage.status).toBe(200);
    expect(moderatorPage.status).toBe(200);
    expect(adminPage.html.includes(ADMIN_WORKSPACE), 'admin workspace').toBe(allowed.admin);
    expect(moderatorPage.html.includes(MODERATOR_WORKSPACE), 'moderator workspace').toBe(
      allowed.moderator,
    );
  });

  it('shows the store settings area to the owner only', async () => {
    const owner = await signedIn('super_admin', 'owner-settings');
    const admin = await signedIn('admin', 'admin-settings');

    // The settings area is the delivery-charge editor; `settings.manage` is the owner's
    // alone by default (an explicit grant can change that for one account).
    expect((await owner.go('/admin')).html).toContain('/admin/settings');
    expect((await admin.go('/admin')).html).not.toContain('/admin/settings');
  });

  it('stops a suspended staff member at the next request', async () => {
    const b = browser();
    const { id, email } = await createAccount('admin-suspended', 'staff');
    await b.submit('/login', { field: 'password' }, { email, password: PASSWORD });
    await setSuspended(id, true);

    const page = await b.go('/admin');
    expect(page.html).not.toContain(ADMIN_WORKSPACE);
    expect(page.html).toMatch(/suspended/i);
  });

  it('applies a role change on the next request', async () => {
    const b = browser();
    const { id, email } = await createAccount('admin-demoted', 'staff');
    await b.submit('/login', { field: 'password' }, { email, password: PASSWORD });
    expect((await b.go('/admin')).html).toContain(ADMIN_WORKSPACE);

    const { admin } = await import('./fixtures');
    await admin.from('user_roles').update({ role: 'customer' }).eq('user_id', id);
    expect((await b.go('/admin')).html).not.toContain(ADMIN_WORKSPACE);
  });
});

describe('sign-out', () => {
  it('signs out of the workspace and revokes the session', async () => {
    const b = await signedIn('staff', 'staff-signout');
    const page = await b.submit('/admin', { button: 'Sign out' }, {});

    expect(page.status).toBe(303);
    expect(page.location).toMatch(/\/login\?signedOut=1$/);
    expect(b.cookies.has(ACCESS)).toBe(false);
    expect(isRedirectToLogin(await b.go('/admin'))).toBe(true);
  });
});

describe('response headers', () => {
  it('forbids framing the workspace on every page', async () => {
    for (const path of ['/login', '/admin']) {
      const page = await browser().go(path);
      expect(page.headers.get('x-frame-options'), path).toBe('DENY');
      expect(page.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'");
    }
  });
});

/*
 * Workflows across roles, through the same no-JavaScript form posts a browser makes.
 * Each step is checked in the database as well as on the page, since a page could
 * report a success that never happened.
 */
describe('workflows', () => {
  let categoryId: string;
  let catalog: Awaited<ReturnType<typeof createCatalog>>;

  beforeAll(async () => {
    catalog = await createCatalog();
    const { data, error } = await db
      .from('categories')
      .select('id')
      .eq('slug', catalog.categorySlug)
      .single<{ id: string }>();
    if (error) throw error;
    categoryId = data.id;
  });

  async function productRow(id: string) {
    const { data, error } = await db
      .from('products')
      .select('status, moderation_status, price_minor')
      .eq('id', id)
      .single<{ status: string; moderation_status: string; price_minor: number }>();
    if (error) throw error;
    return data;
  }

  it('takes a product from draft through review to the storefront', async () => {
    const staff = await signedIn('staff', 'flow-staff');
    const owner = await signedIn('super_admin', 'flow-owner');
    const moderator = await signedIn('moderator', 'flow-moderator');
    const other = await signedIn('moderator', 'flow-other-moderator');
    const moderatorId = (await accountId('flow-moderator')) ?? '';

    // Staff create a draft and submit it.
    const slug = runSlug('flow-kettle');
    const created = await staff.submit(
      '/admin/products/new',
      { field: 'sku' },
      {
        name: 'Copper kettle',
        categoryId,
        slug,
        summary: 'A hand-hammered kettle',
        description: 'Holds 1.5 litres. Hand-hammered copper with a brass handle.',
        price: '2450',
        compareAtPrice: '',
        maxOrderQuantity: '4',
        sku: slug.toUpperCase().slice(0, 40),
        initialStock: '6',
      },
    );
    expect(created.status, created.html.slice(0, 400)).toBe(303);
    const id = /\/admin\/products\/([0-9a-f-]{36})/.exec(created.location ?? '')?.[1] ?? '';
    expect(id).not.toBe('');
    expect(await productRow(id)).toMatchObject({
      status: 'draft',
      moderation_status: 'not_submitted',
    });

    const submitted = await staff.submit(
      `/admin/products/${id}`,
      { button: 'Submit for review' },
      {},
    );
    expect(submitted.status).toBe(303);
    expect((await productRow(id)).moderation_status).toBe('pending');
    // Staff hold no publish permission: their page offers no Publish button.
    expect((await staff.go(`/admin/products/${id}`)).html).not.toMatch(/>\s*Publish\s*</);

    const { data: task } = await db
      .from('moderation_tasks')
      .select('id')
      .eq('product_id', id)
      .eq('status', 'pending')
      .single<{ id: string }>();
    const taskId = task?.id ?? '';

    // Before it is assigned, the moderator cannot open the review.
    expect((await moderator.go(`/moderator/tasks/${taskId}`)).html).not.toContain('Copper kettle');

    const assigned = await owner.submit(
      `/admin/moderation/${taskId}`,
      { field: 'moderatorId' },
      { moderatorId },
    );
    expect(assigned.status).toBe(303);

    // Another moderator still cannot see it.
    expect((await other.go(`/moderator/tasks/${taskId}`)).html).not.toContain('Copper kettle');

    const reviewPage = await moderator.go(`/moderator/tasks/${taskId}`);
    expect(reviewPage.html).toContain('Copper kettle');
    const approved = await moderator.submit(
      `/moderator/tasks/${taskId}`,
      { button: 'Yes, approve' },
      {},
      { page: reviewPage },
    );
    expect(approved.status).toBe(303);
    expect(approved.location).toContain('notice=approved');
    expect((await productRow(id)).moderation_status).toBe('approved');

    // A publish post from another site is refused; the owner's own post publishes.
    await owner.submit(
      `/admin/products/${id}`,
      { button: 'Publish' },
      {},
      { origin: 'https://evil.example' },
    );
    expect((await productRow(id)).status).toBe('draft');
    const published = await owner.submit(`/admin/products/${id}`, { button: 'Publish' }, {});
    expect(published.status).toBe(303);
    expect((await productRow(id)).status).toBe('active');

    const shop = await new TestBrowser(env.storefrontUrl).go(`/products/${slug}`);
    expect(shop.status).toBe(200);
    expect(shop.html).toContain('Copper kettle');

    // Once it is on sale, staff are offered no pricing form; the page says the change needs
    // the “Publish products” permission instead. The server refuses the same write for a
    // staff session independently (covered by the API permission tests).
    const staffPage = await staff.go(`/admin/products/${id}`);
    expect(staffPage.html).not.toContain('Save pricing');
    expect(staffPage.html).toContain('needs the “Publish products” permission');
    expect((await productRow(id)).price_minor).toBe(245_000);
  });

  it('fulfils a COD order and records the cash once', async () => {
    // The customer orders through the storefront.
    const shopper = new TestBrowser(env.storefrontUrl);
    const { email, id: customerId } = await createAccount('flow-customer');
    await shopper.submit('/login', { field: 'password' }, { email, password: PASSWORD });
    await shopper.submit(
      '/account/addresses/new',
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
    await shopper.submit(
      `/products/${catalog.vase.slug}`,
      { button: 'Add to cart' },
      { quantity: '1' },
    );
    const placed = await shopper.submit('/checkout', { button: 'Place order' }, {});
    expect(placed.status).toBe(303);
    const { data: order } = await db
      .from('orders')
      .select('order_number, total_minor')
      .eq('user_id', customerId)
      .single<{ order_number: string; total_minor: number }>();
    const orderNumber = order?.order_number ?? '';
    const total = order?.total_minor ?? 0;
    const orderPath = `/admin/orders/${orderNumber}`;

    const moderator = await signedIn('moderator', 'order-moderator');
    expect((await moderator.go(orderPath)).html).not.toContain('Record cash collected');

    const staff = await signedIn('staff', 'order-staff');
    const steps: [string, string][] = [
      ['Yes, confirm it', 'confirmed'],
      ['Yes, start processing', 'processing'],
      ['Yes, it has shipped', 'shipped'],
      ['Yes, it was delivered', 'delivered'],
    ];
    for (const [button, status] of steps) {
      const page = await staff.submit(orderPath, { button }, {});
      expect(page.status, button).toBe(303);
      expect(page.location).toContain(`notice=${status}`);
    }

    const state = async () =>
      (
        await db
          .from('orders')
          .select('status, payment_status')
          .eq('order_number', orderNumber)
          .single<{ status: string; payment_status: string }>()
      ).data;
    expect(await state()).toEqual({ status: 'delivered', payment_status: 'pending' });

    // A different amount is refused; the exact total is recorded, once.
    const wrong = await staff.submit(
      orderPath,
      { button: 'Record collection' },
      { amount: String(total / 100 - 1) },
    );
    expect(wrong.status).toBe(200);
    expect((await state())?.payment_status).toBe('pending');
    const collected = await staff.submit(
      orderPath,
      { button: 'Record collection' },
      { amount: String(total / 100) },
    );
    expect(collected.status).toBe(303);
    expect(collected.location).toContain('notice=');
    expect(await state()).toEqual({ status: 'delivered', payment_status: 'collected' });
    expect((await staff.go(orderPath)).html).not.toContain('Record cash collected');
  });

  it('lets an owner grant a permission and refuses one an admin does not hold', async () => {
    const owner = await signedIn('super_admin', 'perm-owner');
    const adminBrowser = await signedIn('admin', 'perm-admin');
    const target = (await accountId('perm-target-staff', 'staff')) ?? '';
    const memberPath = `/admin/staff/${target}`;
    const overrides = async () =>
      (
        await db
          .from('user_permissions')
          .select('permission, effect')
          .eq('user_id', target)
          .order('permission')
      ).data;

    const granted = await owner.submit(
      memberPath,
      { field: 'permission' },
      { permission: 'orders.cancel', effect: 'grant' },
    );
    expect(granted.status).toBeLessThan(400);
    expect(await overrides()).toEqual([{ permission: 'orders.cancel', effect: 'grant' }]);

    // The admin reuses the form with a permission it does not hold: the server refuses.
    await adminBrowser.submit(
      memberPath,
      { field: 'permission' },
      { permission: 'settings.manage', effect: 'grant' },
    );
    expect(await overrides()).toEqual([{ permission: 'orders.cancel', effect: 'grant' }]);
  });

  it('invites a moderator who accepts by email and then signs in', async () => {
    const owner = await signedIn('super_admin', 'invite-owner');
    const email = emailForRun('admin-invitee');
    const invited = await owner.submit(
      '/admin/staff',
      { field: 'email' },
      { email, fullName: 'Invited Reviewer', role: 'moderator' },
    );
    expect(invited.status).toBeLessThan(400);
    const before = await accountByEmailForRun(email);
    expect(before?.email_confirmed_at ?? null).toBeNull();

    const tokenHash = await invitationToken(email);
    const accepted = await browser().submit(
      `/accept-invite?token_hash=${encodeURIComponent(tokenHash)}`,
      { field: 'password' },
      { password: 'reviewing2026', confirmPassword: 'reviewing2026' },
    );
    expect(accepted.status).toBeLessThan(400);
    expect((await accountByEmailForRun(email))?.email_confirmed_at).toBeTruthy();

    const signedInPage = await browser().submit(
      '/login',
      { field: 'password' },
      { email, password: 'reviewing2026' },
    );
    expect(signedInPage.status).toBe(303);
  });
});

/** The id of this run's account with that label, created with the role if missing. */
async function accountId(label: string, role?: Role): Promise<string | undefined> {
  const existing = await accountByEmailForRun(emailForRun(`admin-${label}`));
  if (existing) return existing.id;
  if (!role) return undefined;
  return (await createAccount(`admin-${label}`, role)).id;
}

/** The token hash in the invitation email the local Auth server sent. */
async function invitationToken(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (await fetch(`${env.mailUrl}/api/v1/search?query=${query}`)).json()) as {
      messages: { ID: string }[];
    };
    const id = search.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${env.mailUrl}/api/v1/message/${id}`)).json()) as {
        HTML: string;
      };
      const token = /token_hash=([^"&]+)/.exec(message.HTML)?.[1];
      if (token) return decodeURIComponent(token);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No invitation email arrived');
}
