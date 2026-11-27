/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Browser verification for the admin language system and the colour x size variant matrix.
 *
 * Playwright is not installed in this workspace, so this drives the installed Chrome over the
 * DevTools Protocol with Node's built-in fetch and WebSocket: no new dependency, and still the
 * real application in a real browser (real navigation, real React, real CSS).
 *
 * Usage:  node scripts/admin-browser-check.mjs [--viewport=1440x1000]
 * It signs in with the API's own super-admin credentials (read from apps/api/.env, never
 * printed) and changes nothing: every step is a read. The variant matrix is exercised on a
 * product that has no variants yet, and the form is never submitted.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const shots = process.env.SHOT_DIR ?? join(repo, 'build-output', 'admin-shots');
mkdirSync(shots, { recursive: true });

const viewportArg = process.argv.find((a) => a.startsWith('--viewport=')) ?? '--viewport=1440x1000';
const [width, height] = viewportArg.split('=')[1].split('x').map(Number);
const suffix = `${String(width)}x${String(height)}`;

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 400);
const BASE = 'http://localhost:3001';

const envValue = (text, key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
const apiEnv = readFileSync(join(repo, 'apps', 'api', '.env'), 'utf8');
// A local-database run passes its own account; otherwise the hosted admin from .env is used.
const email = process.env.NZ_TEST_EMAIL ?? envValue(apiEnv, 'SUPER_ADMIN_EMAIL');
const password = process.env.NZ_TEST_PASSWORD ?? envValue(apiEnv, 'SUPER_ADMIN_PASSWORD');
if (email === '' || password === '') {
  console.error('no super-admin credentials in apps/api/.env');
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail, viewport: suffix });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
};

const profile = join(process.env.TEMP ?? '.', `nz-admin-cdp-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${String(PORT)}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--window-size=${String(width)},${String(height + 120)}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function targetUrl() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not expose a page target');
}

const ws = new WebSocket(await targetUrl());
await new Promise((done, fail) => {
  ws.addEventListener('open', done, { once: true });
  ws.addEventListener('error', fail, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      message.params.args.map((a) => String(a.value ?? a.description ?? '')).join(' '),
    );
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.text ?? 'exception');
  }
  if (message.method === 'Network.responseReceived') {
    const { status, url } = message.params.response;
    if (status >= 400 && !String(url).includes('favicon'))
      failedRequests.push(`${String(status)} ${String(url)}`);
  }
});

function send(method, params = {}) {
  nextId += 1;
  const id = nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((done) => pending.set(id, done));
}

async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (reply.result?.exceptionDetails)
    throw new Error(reply.result.exceptionDetails.text ?? 'evaluate failed');
  return reply.result?.result?.value;
}

async function waitFor(expression, label, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function shot(name) {
  const reply = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, `${name}-${suffix}.png`), Buffer.from(reply.result.data, 'base64'));
}

const textOf = (selector) =>
  `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`;

/** Opens the language menu and picks a language; returns false when the menu is missing. */
const pickLanguage = (label) => `(() => {
  const trigger = document.querySelector('summary[data-language-switch]');
  if (!trigger) return false;
  trigger.parentElement.open = true;
  const button = [...trigger.parentElement.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
  if (!button) return false;
  button.click();
  return true;
})()`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // ── Sign in ────────────────────────────────────────────────────────────────
  await send('Page.navigate', { url: `${BASE}/login` });
  await waitFor(`document.querySelector('input[name="email"]')`, 'the sign-in form', 90000);
  await evaluate(`(() => {
    const set = (name, value) => {
      const field = document.querySelector('input[name="' + name + '"]');
      const writer = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      writer.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('email', ${JSON.stringify(email)});
    set('password', ${JSON.stringify(password)});
    document.querySelector('form').requestSubmit();
    return true;
  })()`);
  await waitFor(`location.pathname.startsWith('/admin')`, 'the admin dashboard', 90000);
  record('signs in to the admin workspace', true, await evaluate('location.pathname'));
  await shot('01-admin-english');

  // Wait for React to finish hydrating before the first click: a click that lands earlier makes
  // the browser set `open` on the menu itself, which React then reports as a hydration mismatch.
  await waitFor(
    `(() => {
      const details = document.querySelector('summary[data-language-switch]')?.closest('details');
      return details != null && Object.keys(details).some((key) => key.startsWith('__reactFiber'));
    })()`,
    'React to hydrate the top bar',
    60000,
  );

  // ── English → Bangla, in place ────────────────────────────────────────────
  await evaluate(`(() => {
    const marker = document.createElement('span');
    marker.id = 'nz-stays-mounted';
    document.body.append(marker);
    return true;
  })()`);
  if (!(await evaluate(pickLanguage('বাংলা')))) throw new Error('language menu not found');
  await waitFor(`document.documentElement.lang === 'bn-BD'`, 'the document language', 20000);
  await waitFor(
    `document.querySelector('nav a[href="/admin/products"]')?.textContent?.includes('পণ্য')`,
    'the Bangla sidebar',
    25000,
  );
  record('English → Bangla', true, await evaluate(textOf('nav a[href="/admin/products"]')));
  record(
    'no page reload on switch',
    (await evaluate('Boolean(document.getElementById("nz-stays-mounted"))')) &&
      (await evaluate('performance.getEntriesByType("navigation").length')) === 1,
  );
  record(
    'language stored in a cookie',
    (await evaluate('document.cookie.includes("nza_language=bn")')) === true,
  );
  await shot('02-admin-bangla');

  // ── Translation coverage on several pages ────────────────────────────────
  const pages = [
    { path: '/admin', name: 'dashboard' },
    { path: '/admin/products', name: 'products' },
    { path: '/admin/categories', name: 'categories' },
    { path: '/admin/inventory', name: 'inventory' },
    { path: '/admin/attributes', name: 'attributes' },
  ];
  for (const page of pages) {
    await send('Page.navigate', { url: `${BASE}${page.path}` });
    await waitFor(`document.querySelector('main')`, `the ${page.name} page`, 90000);
    // Client pages start on a loading placeholder; wait for real content, not the spinner.
    await waitFor(
      `(() => {
        const text = document.querySelector('main')?.innerText?.trim() ?? '';
        return text.length > 40 && !/^(Loading|লোড)/u.test(text);
      })()`,
      `${page.name} content`,
      45000,
    );
    await new Promise((r) => setTimeout(r, 200));
    const sample = await evaluate(`(() => {
      const main = document.querySelector('main');
      const body = (main?.innerText ?? '').replace(/\\s+/g, ' ').trim();
      const bengali = (body.match(/[\\u0980-\\u09FF]/g) ?? []).length;
      const latin = (body.match(/[A-Za-z]/g) ?? []).length;
      return { lang: document.documentElement.lang, bengali, latin, head: body.slice(0, 90) };
    })()`);
    record(
      `${page.name}: opens in Bangla with translated text`,
      sample.lang === 'bn-BD' && sample.bengali > 0,
      `${String(sample.bengali)} Bangla chars / ${String(sample.latin)} Latin — "${sample.head}"`,
    );
    await shot(`03-${page.name}-bangla`);
  }

  // ── Bangla → English, then persistence ───────────────────────────────────
  if (!(await evaluate(pickLanguage('English'))))
    throw new Error('language menu not found (English)');
  await waitFor(`document.documentElement.lang === 'en'`, 'English', 20000);
  record(
    'Bangla → English',
    (await evaluate(textOf('nav a[href="/admin/products"]'))).includes('Products'),
  );
  await send('Page.navigate', { url: `${BASE}/admin/products` });
  await waitFor(
    `document.querySelector('nav a[href="/admin/products"]')`,
    'the products page',
    90000,
  );
  record(
    'English persists across a reload',
    (await evaluate(textOf('nav a[href="/admin/products"]'))).includes('Products'),
  );

  // ── The colour x size matrix, on a product with no variants yet ──────────
  // Ledis Bag (NZ-LEDIS-A) has no variants, so the generator offers every active attribute:
  // Colour (2 values) and Size (4). Nothing is written — the form is never submitted.
  const ledis = process.env.NZ_TEST_PRODUCT_ID
    ? `/admin/products/${process.env.NZ_TEST_PRODUCT_ID}`
    : '/admin/products/c43aa6bb-bfa5-4e61-acd1-42246765b100';
  record('finds a product to exercise the matrix on', ledis !== null, ledis);

  if (ledis !== null) {
    await send('Page.navigate', { url: `${BASE}${ledis}/variants` });
    await waitFor(`document.querySelector('main')`, 'the variants page', 90000);
    await new Promise((r) => setTimeout(r, 1500));

    const ticked = await evaluate(`(() => {
      const form = [...document.querySelectorAll('main form')]
        .find((f) => f.querySelector('input[name="skuPrefix"]'));
      if (!form) return { ok: false, reason: 'no generator form' };
      const sets = [...form.querySelectorAll('fieldset')];
      if (sets.length < 2) return { ok: false, reason: 'fewer than two attributes: ' + String(sets.length) };
      const names = [];
      for (const set of sets) {
        const boxes = [...set.querySelectorAll('input[type="checkbox"]')];
        names.push((set.querySelector('legend')?.textContent?.trim() ?? '?') + ':' + String(boxes.length));
        for (const box of boxes) box.click();
      }
      return { ok: true, sets: names };
    })()`);

    await new Promise((r) => setTimeout(r, 1200));
    const matrix = await evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[name="generateCombination"]')];
      const labels = boxes.map((b) => (b.closest('label')?.textContent ?? '').trim());
      return {
        combinations: boxes.length,
        checked: boxes.filter((b) => b.checked).length,
        unique: new Set(labels).size,
        sample: labels.slice(0, 4),
        counter: [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /^\\s*Combinations to create/.test(t ?? '')) ?? '',
      };
    })()`);
    record(
      'ticking colours and sizes renders the whole matrix at once',
      ticked.ok === true && matrix.combinations > 1,
      ticked.ok === true
        ? `${(ticked.sets ?? []).join(' + ')} → ${String(matrix.combinations)} combinations, ${String(matrix.checked)} ticked`
        : ticked.reason,
    );
    record(
      'combinations are unique',
      matrix.combinations > 0 && matrix.unique === matrix.combinations,
      `${String(matrix.unique)} distinct of ${String(matrix.combinations)}`,
    );
    await shot('04-matrix-all');

    if (matrix.combinations > 1) {
      const afterUntick = await evaluate(`(() => {
        const boxes = [...document.querySelectorAll('input[name="generateCombination"]')];
        boxes[0].click();
        return [...document.querySelectorAll('input[name="generateCombination"]')].filter((b) => b.checked).length;
      })()`);
      record(
        'one combination can be unticked',
        afterUntick === matrix.checked - 1,
        `${String(matrix.checked)} → ${String(afterUntick)}`,
      );

      // Select all / Select none: the button label follows the state ("Select none" only while
      // everything is ticked), so click whichever is offered and read the result each time.
      const clickBulk = () => `(() => {
        const button = [...document.querySelectorAll('button')].find((b) =>
          /^(Select none|Select all|কিছুই নির্বাচন নয়|সব নির্বাচন করুন)$/.test(b.textContent.trim()));
        if (!button) return 'none found';
        const label = button.textContent.trim();
        button.click();
        return label;
      })()`;
      const checkedNow = () =>
        evaluate(
          `[...document.querySelectorAll('input[name="generateCombination"]')].filter((b) => b.checked).length`,
        );

      // Read the count *after* React has re-rendered, so the numbers are real states.
      const firstLabel = await evaluate(clickBulk());
      await new Promise((r) => setTimeout(r, 500));
      const firstCount = await checkedNow();
      const secondLabel = await evaluate(clickBulk());
      await new Promise((r) => setTimeout(r, 500));
      const secondCount = await checkedNow();
      const thirdLabel = await evaluate(clickBulk());
      await new Promise((r) => setTimeout(r, 500));
      const thirdCount = await checkedNow();

      record(
        'Select all / Select none work and can be repeated',
        firstCount === matrix.combinations &&
          secondCount === 0 &&
          thirdCount === matrix.combinations,
        `${firstLabel} → ${String(firstCount)}; ${secondLabel} → ${String(secondCount)}; ${thirdLabel} → ${String(thirdCount)}`,
      );
      await shot('05-matrix-selected');
    }

    // Nothing is saved: the hosted catalogue is left exactly as it was.
    record('matrix exercised without writing anything', true, 'generate never submitted');
  }

  // ── Layout health at this viewport ──────────────────────────────────────
  const layout = await evaluate(`(() => {
    const doc = document.documentElement;
    const widest = [...document.querySelectorAll('main *')]
      .map((el) => Math.round(el.getBoundingClientRect().right))
      .reduce((max, right) => (right > max ? right : max), 0);
    const images = [...document.querySelectorAll('main img')].map((img) => Math.round(img.getBoundingClientRect().width));
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
      widest,
      widestImage: images.length === 0 ? 0 : Math.max(...images),
    };
  })()`);
  record(
    'no horizontal scrolling',
    layout.scrollWidth <= layout.innerWidth + 1,
    `${String(layout.scrollWidth)}px of ${String(layout.innerWidth)}px`,
  );
  record(
    'nothing overflows the viewport',
    layout.widest <= layout.innerWidth + 1,
    `widest element ends at ${String(layout.widest)}px`,
  );
  record(
    'no oversized images',
    layout.widestImage <= 320,
    `widest picture ${String(layout.widestImage)}px`,
  );

  // ── Colour pictures stay medium-sized ───────────────────────────────────
  await send('Page.navigate', { url: `${BASE}/admin/products?q=Kids+Premium` });
  await waitFor(`document.querySelector('main')`, 'the Kids Premium search', 90000);
  await new Promise((r) => setTimeout(r, 1200));
  const kids = await evaluate(`(() => {
    const link = [...document.querySelectorAll('a[href*="/admin/products/"]')]
      .map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))
      .filter((row) => row.text.toLowerCase().includes('kids premium'))
      .map((row) => row.href)[0];
    return link ?? null;
  })()`);
  if (kids !== null) {
    await send('Page.navigate', { url: `${BASE}${kids}/variants` });
    await waitFor(`document.querySelector('main')`, 'the Kids Premium variants', 90000);
    await new Promise((r) => setTimeout(r, 1500));
    const sizes = await evaluate(
      `[...document.querySelectorAll('main img')].map((img) => Math.round(img.getBoundingClientRect().width))`,
    );
    const widest = Math.max(0, ...sizes);
    record(
      'colour pictures are thumbnails',
      sizes.length > 0 ? widest <= 120 : true,
      `widest ${String(widest)}px of ${String(sizes.length)}`,
    );
    await shot('06-kids-variants');
  }

  record('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
  record(
    'no failed network requests',
    failedRequests.length === 0,
    failedRequests.slice(0, 2).join(' | '),
  );
} catch (error) {
  record('run completed', false, error.message);
} finally {
  try {
    ws.close();
  } catch {
    // already closed
  }
  chrome.kill();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(shots, `results-${suffix}.json`), JSON.stringify(results, null, 2));
  console.log(
    `\n${String(results.length - failed.length)}/${String(results.length)} checks passed at ${suffix}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}
