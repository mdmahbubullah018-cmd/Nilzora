/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Variant persistence, end to end, against a real database.
 * ---------------------------------------------------------
 * Drives the same API the admin's "Generate variants" action calls, in the same order, with a
 * temporary product of its own:
 *
 *   1. create a product with no variants,
 *   2. read the attributes and pick two (a colour and a size) to vary by,
 *   3. save 7 of the 8 combinations — the ticked ones only,
 *   4. read them back: exactly 7, all distinct, none of the unticked combination,
 *   5. ask again for the ones that exist: the database refuses the duplicates, the count stays 7,
 *   6. add the 8th: 8 total, still distinct,
 *   7. delete the product and confirm it is gone.
 *
 * Nothing else is touched: the SKU prefix is unique, every record it makes hangs off the test
 * product, and the delete removes exactly that product.
 *
 * Usage:
 *   NZ_TEST_EMAIL=… NZ_TEST_PASSWORD=… node scripts/variant-persistence-check.mjs
 * Credentials come from the environment; nothing secret is printed.
 */
const API = process.env.NZ_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const email = process.env.NZ_TEST_EMAIL;
const password = process.env.NZ_TEST_PASSWORD;
if (!email || !password) {
  console.error('set NZ_TEST_EMAIL and NZ_TEST_PASSWORD');
  process.exit(2);
}

let token = '';
async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, ok: response.ok, body: payload };
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
};

// ─── Sign in ────────────────────────────────────────────────────────────────
const login = await call('POST', '/auth/login', { email, password });
if (!login.ok) {
  console.error(`sign-in failed (${String(login.status)})`);
  process.exit(2);
}
token = login.body.accessToken;
record('signed in to the API', true);

// ─── A category to hang the test product on ─────────────────────────────────
const categories = await call('GET', '/admin/categories');
const categoryId = categories.body?.categories?.[0]?.id;
if (!categoryId) {
  console.error('no category to create a product in');
  process.exit(2);
}

// ─── Attributes: pick one colour and one size with enough values ────────────
const attributeResponse = await call('GET', '/admin/attributes');
const attributes = (attributeResponse.body?.attributes ?? []).filter(
  (attribute) => attribute.isActive && attribute.values.length >= 2,
);
const colour = attributes.find((attribute) => attribute.kind === 'color');
const size = attributes.find((attribute) => attribute.kind === 'size');
if (!colour || !size) {
  console.error('need an active colour attribute and an active size attribute with 2+ values');
  process.exit(2);
}
const colours = colour.values.slice(0, 2);
const sizes = size.values.slice(0, 4);
record(
  'picked two dimensions',
  true,
  `${colour.name} (${String(colours.length)}) × ${size.name} (${String(sizes.length)})`,
);

// ─── Create the test product ────────────────────────────────────────────────
const stamp = Date.now().toString(36).toUpperCase();
const sku = `ITP-${stamp}`;
const created = await call('POST', '/admin/products', {
  categoryId,
  slug: `it-variant-persistence-${stamp.toLowerCase()}`,
  name: `IT variant persistence ${stamp}`,
  summary: 'Temporary product created by the variant persistence check.',
  priceMinor: 100000,
  sku,
  initialStock: 0,
});
if (!created.ok) {
  console.error('could not create the test product', created.status, JSON.stringify(created.body));
  process.exit(2);
}
const productId = created.body.product.id;
record('created a temporary product', true, `${created.body.product.name} (${productId})`);

const cleanup = async () => {
  const removed = await call('DELETE', `/admin/products/${productId}`);
  const after = await call('GET', `/admin/products/${productId}`);
  record(
    'deleted the temporary product',
    removed.ok && after.status === 404,
    `delete ${String(removed.status)}, read back ${String(after.status)}`,
  );
};

try {
  // ─── Generate the ticked combinations only (7 of 8) ───────────────────────
  const combinations = [];
  for (const colourValue of colours) {
    for (const sizeValue of sizes) {
      combinations.push([colourValue, sizeValue]);
    }
  }
  const ticked = combinations.slice(0, combinations.length - 1);
  const unticked = combinations[combinations.length - 1];

  let position = 0;
  const save = async ([colourValue, sizeValue]) => {
    const variantSku = `${sku}-${colourValue.slug}-${sizeValue.slug}`
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '-')
      .slice(0, 40);
    const response = await call('POST', `/admin/products/${productId}/variants`, {
      variantId: null,
      sku: variantSku,
      priceMinor: null,
      compareAtPriceMinor: null,
      imageUrl: null,
      position: position++,
      isActive: true,
      attributeValueIds: [colourValue.id, sizeValue.id],
    });
    return response;
  };

  const saved = [];
  for (const combination of ticked) saved.push(await save(combination));
  record(
    'saved only the ticked combinations',
    saved.every((response) => response.ok),
    `${String(saved.filter((response) => response.ok).length)} of ${String(ticked.length)} saved`,
  );

  // ─── Read back: the "reopen" ──────────────────────────────────────────────
  const readBack = await call('GET', `/admin/products/${productId}/variants`);
  let variants = readBack.body?.variants ?? [];
  const keys = variants.map((variant) => [...variant.attributeValueIds].sort().join(','));
  record('reopening the product shows the saved variants', variants.length === ticked.length, `${String(variants.length)} variants`);
  record('every combination is distinct', new Set(keys).size === variants.length, `${String(new Set(keys).size)} distinct of ${String(variants.length)}`);
  const untickedKey = [unticked[0].id, unticked[1].id].sort().join(',');
  record('the unticked combination was not created', !keys.includes(untickedKey));

  // ─── Duplicate prevention ────────────────────────────────────────────────
  const duplicate = await save(ticked[0]);
  const afterDuplicate = await call('GET', `/admin/products/${productId}/variants`);
  variants = afterDuplicate.body?.variants ?? [];
  record(
    'the database refuses a duplicate combination',
    !duplicate.ok,
    `second save answered ${String(duplicate.status)}`,
  );
  record('the variant count did not change', variants.length === ticked.length, `${String(variants.length)} variants`);

  // ─── The last combination, then a second refresh ─────────────────────────
  await save(unticked);
  const complete = await call('GET', `/admin/products/${productId}/variants`);
  variants = complete.body?.variants ?? [];
  record(
    'the remaining combination can be added',
    variants.length === combinations.length,
    `${String(variants.length)} of ${String(combinations.length)}`,
  );

  const refreshed = await call('GET', `/admin/products/${productId}/variants`);
  const before = (complete.body?.variants ?? []).map((variant) => variant.id).sort();
  const after = (refreshed.body?.variants ?? []).map((variant) => variant.id).sort();
  record(
    'a second read returns the very same rows',
    before.length === after.length && before.every((id, index) => id === after[index]),
    `${String(after.length)} identical ids`,
  );
} finally {
  await cleanup();
}

const failures = results.filter((result) => !result.ok);
console.log(`\n${String(results.length - failures.length)}/${String(results.length)} checks passed against ${API}`);
process.exit(failures.length === 0 ? 0 : 1);
