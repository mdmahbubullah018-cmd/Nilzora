import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

/**
 * Test fixtures against the local Supabase stack. The service-role client stays in this
 * test package (never in an app or shared package); it only creates, adjusts and
 * deletes accounts this run created (unique @example.com addresses).
 */

export const env = inject('e2e');
export const PASSWORD = 'shopping2026';
const run = randomUUID().slice(0, 8);

export const admin = createClient(env.supabaseUrl, env.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export const emailFor = (label: string) => `e2e-${run}-${label}@example.com`;

export type Role = 'super_admin' | 'admin' | 'staff' | 'moderator' | 'customer';

export async function createAccount(label: string, role: Role = 'customer') {
  const email = emailFor(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  if (role !== 'customer') {
    const { error: roleError } = await admin
      .from('user_roles')
      .update({ role })
      .eq('user_id', data.user.id);
    if (roleError) throw roleError;
  }
  return { id: data.user.id, email };
}

export async function setSuspended(userId: string, suspended: boolean): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update({ status: suspended ? 'suspended' : 'active' })
    .eq('id', userId);
  if (error) throw error;
}

export async function accountByEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email);
}

export async function roleOf(userId: string): Promise<string | undefined> {
  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single<{ role: string }>();
  return data?.role;
}

export async function profileOf(userId: string) {
  const { data } = await admin
    .from('profiles')
    .select('full_name, phone, status')
    .eq('id', userId)
    .single<{ full_name: string | null; phone: string | null; status: string }>();
  return data;
}

/** Deletes every account this run created. */
export async function deleteRunAccounts(): Promise<void> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) {
    if (user.email?.startsWith(`e2e-${run}-`)) await admin.auth.admin.deleteUser(user.id);
  }
}

/** The confirmation link from the email the local Auth server actually sent. */
export async function confirmationLink(email: string): Promise<URL> {
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
      const href = /href="([^"]*\/confirm-email[^"]*)"/.exec(message.HTML)?.[1];
      if (href) return new URL(href.replaceAll('&amp;', '&'));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No confirmation email arrived');
}

/** Calls the API directly, as a revoked token holder or another client would. */
export async function apiStatus(path: string, init: RequestInit = {}): Promise<number> {
  const response = await fetch(`${env.apiUrl}/api/v1${path}`, init);
  await response.arrayBuffer();
  return response.status;
}

// ---------------------------------------------------------------------------
// Commerce fixtures: one category and a few products per run, with unique slugs
// and SKUs. Cleanup removes this run's orders first (orders keep accounts and
// products from being deleted), then the stock ledger, products and category.
// ---------------------------------------------------------------------------

export const runSlug = (label: string) => `e2e-${run}-${label}`;
export const runWord = `lumora${run}`;

export interface RunProduct {
  id: string;
  slug: string;
  name: string;
  priceMinor: number;
}

export async function createCatalog(): Promise<{
  categorySlug: string;
  lamp: RunProduct;
  vase: RunProduct;
  draft: RunProduct;
}> {
  // Delivery must be priced; keep any charges the developer already set.
  const { error: chargeError } = await admin.from('delivery_charges').upsert(
    [
      { zone: 'inside_dhaka', amount_minor: 7000 },
      { zone: 'outside_dhaka', amount_minor: 13000 },
    ],
    { onConflict: 'zone', ignoreDuplicates: true },
  );
  if (chargeError) throw chargeError;

  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({ slug: runSlug('cat'), name: `E2E ${run}`, sort_order: 999 })
    .select('id, slug')
    .single<{ id: string; slug: string }>();
  if (categoryError) throw categoryError;

  const rows = [
    {
      slug: runSlug('lamp'),
      sku: `E2E-${run.toUpperCase()}-LAMP`,
      name: `${runWord} Desk Lamp`,
      price_minor: 45_000,
      compare_at_price_minor: 50_000,
      stock_quantity: 5,
      max_order_quantity: 3,
      status: 'active',
    },
    {
      slug: runSlug('vase'),
      sku: `E2E-${run.toUpperCase()}-VASE`,
      name: `${runWord} Clay Vase`,
      price_minor: 12_000,
      compare_at_price_minor: null,
      stock_quantity: 4,
      max_order_quantity: 5,
      status: 'active',
    },
    {
      slug: runSlug('draft'),
      sku: `E2E-${run.toUpperCase()}-DRAFT`,
      name: `${runWord} Unreleased Chair`,
      price_minor: 99_000,
      compare_at_price_minor: null,
      stock_quantity: 9,
      max_order_quantity: 5,
      status: 'draft',
    },
  ].map((row) => ({ ...row, category_id: category.id }));

  const { data: products, error: productError } = await admin
    .from('products')
    .insert(rows)
    .select('id, slug, name, price_minor')
    .returns<{ id: string; slug: string; name: string; price_minor: number }[]>();
  if (productError) throw productError;

  const bySlug = (label: string): RunProduct => {
    const row = products.find((product) => product.slug === runSlug(label));
    if (!row) throw new Error(`fixture product ${label} missing`);
    return { id: row.id, slug: row.slug, name: row.name, priceMinor: row.price_minor };
  };
  return {
    categorySlug: category.slug,
    lamp: bySlug('lamp'),
    vase: bySlug('vase'),
    draft: bySlug('draft'),
  };
}

export async function deliveryCharge(zone: 'inside_dhaka' | 'outside_dhaka'): Promise<number> {
  const { data, error } = await admin
    .from('delivery_charges')
    .select('amount_minor')
    .eq('zone', zone)
    .single<{ amount_minor: number }>();
  if (error) throw error;
  return data.amount_minor;
}

export async function stockOf(productId: string): Promise<number> {
  const { data, error } = await admin
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .single<{ stock_quantity: number }>();
  if (error) throw error;
  return data.stock_quantity;
}

export async function ordersOf(userId: string) {
  const { data, error } = await admin
    .from('orders')
    .select('order_number, status, payment_status, subtotal_minor, shipping_fee_minor, total_minor')
    .eq('user_id', userId)
    .order('placed_at')
    .returns<
      {
        order_number: string;
        status: string;
        payment_status: string;
        subtotal_minor: number;
        shipping_fee_minor: number;
        total_minor: number;
      }[]
    >();
  if (error) throw error;
  return data;
}

/** Deletes this run's orders, stock ledger, products and category (accounts separately). */
export async function deleteRunCatalog(): Promise<void> {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const runUserIds = users.users
    .filter((user) => user.email?.startsWith(`e2e-${run}-`))
    .map((user) => user.id);
  if (runUserIds.length > 0) {
    const { error } = await admin.from('orders').delete().in('user_id', runUserIds);
    if (error) throw error;
  }
  const { data: products } = await admin
    .from('products')
    .select('id')
    .like('slug', `e2e-${run}-%`)
    .returns<{ id: string }[]>();
  const productIds = (products ?? []).map((product) => product.id);
  if (productIds.length > 0) {
    const { error: ledgerError } = await admin
      .from('inventory_movements')
      .delete()
      .in('product_id', productIds);
    if (ledgerError) throw ledgerError;
    const { error: productError } = await admin.from('products').delete().in('id', productIds);
    if (productError) throw productError;
  }
  const { error: categoryError } = await admin
    .from('categories')
    .delete()
    .like('slug', `e2e-${run}-%`);
  if (categoryError) throw categoryError;
}
