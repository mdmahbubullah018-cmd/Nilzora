/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Turns `plural(n, 'order')` into `<CountText count={n} one="order" />`.
 * --------------------------------------------------------------
 * A server component cannot call a hook, so it cannot know the reader's language; CountText is
 * the client boundary that can. This rewrites the two shapes that appear as JSX children —
 * `<AutoText value={plural(…)} />` and `{plural(…)}` — and leaves template strings (which need
 * a sentence, not a count) to be edited by hand.
 *
 * Usage: node scripts/i18n-counts.mjs [--write]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, '..');
const src = join(adminRoot, 'src');
const write = process.argv.includes('--write');

const CALL = String.raw`plural\(\s*([^,()]+(?:\([^()]*\))?[^,()]*?)\s*,\s*'([^']+)'\s*(?:,\s*'([^']+)'\s*)?\)`;
const AUTO = new RegExp(String.raw`<AutoText value=\{\s*${CALL}\s*\}\s*\/>`, 'g');
const BARE = new RegExp(String.raw`\{${CALL}\}`, 'g');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

const results = [];
for (const file of walk(src)) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes('plural(')) continue;
  let code = original;
  let replaced = 0;

  const component = (count, one, many) =>
    many === undefined
      ? `<CountText count={${count}} one="${one}" />`
      : `<CountText count={${count}} one="${one}" many="${many}" />`;

  code = code.replace(AUTO, (_full, count, one, many) => {
    replaced += 1;
    return component(count, one, many === undefined ? undefined : many);
  });
  code = code.replace(BARE, (_full, count, one, many) => {
    // A bare `{plural(…)}` that is already the whole child becomes the component itself.
    replaced += 1;
    return component(count, one, many === undefined ? undefined : many);
  });

  if (replaced === 0) continue;
  if (!code.includes("from '@/components/i18n/format-text'")) {
    const ends = [
      ...code.matchAll(/^import\s+[^'"]*?from\s*'[^']*';/gm),
      ...code.matchAll(/^import\s*'[^']*';/gm),
    ].map((match) => match.index + match[0].length);
    const line = "import { CountText } from '@/components/i18n/format-text';";
    const at = ends.length === 0 ? 0 : Math.max(...ends);
    code = `${code.slice(0, at)}\n${line}${code.slice(at)}`;
  }

  results.push({ file: relative(adminRoot, file).replace(/\\/g, '/'), replaced });
  if (write) writeFileSync(file, code, 'utf8');
}

for (const row of results.sort((a, b) => b.replaced - a.replaced)) {
  console.log(`${String(row.replaced).padStart(3)}  ${row.file}`);
}
console.log(
  `\n${String(results.reduce((sum, row) => sum + row.replaced, 0))} counts in ${String(results.length)} files ${write ? 'rewritten' : 'would be rewritten'}`,
);
