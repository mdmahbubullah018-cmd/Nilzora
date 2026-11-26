/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Translation audit
 * -----------------
 * Counts the admin's user-facing strings and says how many of them can be said in Bangla.
 *
 * How it reads the code
 *  - A "candidate" is a literal that reaches the screen: JSX text, or a string given to one of
 *    the shared text props (`title`, `description`, `label`, `hint`, `placeholder`, `legend`,
 *    `aria-label`, `empty`, `actionLabel`, `subject`, `confirmLabel`, and a few more).
 *  - A candidate is "in the dictionary" when the same text is a key in src/lib/i18n/messages.ts.
 *  - Anything outside these patterns (a message built at runtime, a template string) is not
 *    counted at all: the number below is a floor for what is left to translate, never a ceiling.
 *
 * Usage: node scripts/i18n-audit.mjs [--json]
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const admin = resolve(here, '..');
const src = join(admin, 'src');

const dictionaryFiles = [
  join(src, 'lib', 'i18n', 'messages.ts'),
  ...readdirSync(join(src, 'lib', 'i18n', 'areas'))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(src, 'lib', 'i18n', 'areas', entry)),
];
const keys = new Set();
for (const file of dictionaryFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/^\s*'((?:[^'\\]|\\.)+)'\s*:/gm)) {
    keys.add(match[1].replace(/\\'/g, "'"));
  }
  for (const match of source.matchAll(/^\s*"((?:[^"\\]|\\.)+)"\s*:/gm)) {
    keys.add(match[1].replace(/\\"/g, '"'));
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.tsx') && !entry.endsWith('.test.ts'))
      out.push(path);
  }
  return out;
}

const TEXT_PROPS =
  'title|description|label|hint|placeholder|legend|aria-label|empty|actionLabel|actionAccessibilityLabel|subject|confirmLabel|detail|heading|subtitle|message|text';
const propPattern = new RegExp(`\\b(?:${TEXT_PROPS})=(?:"([^"{}]{3,400})"|\\{'([^'{}]{3,400})'\\})`, 'g');
const wiredPropPattern = new RegExp(
  `\\b(?:${TEXT_PROPS})=\\{(?:tx|t)\\((?:"([^"{}]{2,400})"|'([^'{}]{2,400})')\\)\\}`,
  'g',
);

const rows = [];
for (const file of walk(src)) {
  const code = readFileSync(file, 'utf8');
  const found = new Map();

  const add = (text, wired, kind) => {
    const value = text.replace(/\s+/g, ' ').trim();
    // Skip markup, pure punctuation, numbers, and anything that is clearly an identifier.
    if (value.length < 3) return;
    if (/^[\d\s.,:;/%()-]+$/.test(value)) return;
    if (/^[a-z0-9_.:/-]+$/.test(value)) return;
    if (!/[A-Za-z]/.test(value)) return;
    const seen = found.get(value);
    found.set(value, {
      count: (seen?.count ?? 0) + 1,
      wired: (seen?.wired ?? false) || wired,
      kind: seen?.kind === 'text' || kind === 'text' ? 'text' : kind,
    });
  };

  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** True when this exact string is already routed through the translator. */
  const isWired = (text) => {
    const quoted = `['"]${escape(text.replace(/\s+/g, ' ').trim())}['"]`;
    return (
      new RegExp(`<AutoText>\\s*${escape(text.trim())}\\s*</AutoText>`).test(code) ||
      new RegExp(`(?:\\bt|\\btx)\\(\\s*${quoted}`).test(code)
    );
  };

  for (const match of code.matchAll(propPattern)) {
    const text = match[1] ?? match[2] ?? '';
    add(text, isWired(text), 'prop');
  }
  // Props already routed through the translator: `label={tx("Email address")}`.
  for (const match of code.matchAll(wiredPropPattern)) {
    const text = match[1] ?? match[2] ?? '';
    add(text, true, 'prop');
  }
  // JSX text between tags, one line, without braces or tags of its own.
  for (const match of code.matchAll(/>\s*([A-Z][^<>{}\n]{2,400}?)\s*</g)) {
    add(match[1], isWired(match[1]), 'text');
  }

  for (const [text, seen] of found) {
    rows.push({
      file: relative(admin, file).replace(/\\/g, '/'),
      text,
      count: seen.count,
      kind: seen.kind,
      wired: seen.wired,
      translated: keys.has(text),
    });
  }
}

const unique = new Map();
for (const row of rows) {
  const existing = unique.get(row.text);
  if (existing) {
    existing.count += row.count;
    existing.wired = existing.wired || row.wired;
  } else unique.set(row.text, { ...row });
}
const all = [...unique.values()].sort((a, b) => Number(a.translated) - Number(b.translated) || a.text.localeCompare(b.text));
const translated = all.filter((row) => row.translated);
const missing = all.filter((row) => !row.translated);

const byArea = new Map();
for (const row of all) {
  const area = row.file.split('/').slice(0, 3).join('/');
  const bucket = byArea.get(area) ?? { total: 0, done: 0 };
  bucket.total += 1;
  if (row.translated) bucket.done += 1;
  byArea.set(area, bucket);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: all.length, translated: translated.length, missing }, null, 2));
} else if (process.argv.some((arg) => arg.startsWith('--missing-out='))) {
  const outDir = process.argv
    .find((arg) => arg.startsWith('--missing-out='))
    .slice('--missing-out='.length);
  const buckets = new Map();
  for (const row of missing) {
    const parts = row.file.split('/');
    const bucket =
      parts[1] === 'app' && parts[2] === 'admin'
        ? `app-${parts[3] ?? 'root'}`
        : parts[1] === 'components'
          ? `comp-${parts[2] ?? 'root'}`
          : parts[1] === 'lib'
            ? 'lib'
            : 'misc';
    const list = buckets.get(bucket) ?? [];
    list.push(row.text);
    buckets.set(bucket, list);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [bucket, list] of buckets) {
    const unique = [...new Set(list)].sort((a, b) => a.localeCompare(b));
    writeFileSync(join(outDir, `${bucket}.json`), JSON.stringify(unique, null, 2), 'utf8');
  }
  console.log(
    [...buckets.entries()]
      .map(([bucket, list]) => `${bucket}: ${String(new Set(list).size)}`)
      .sort()
      .join('\n'),
  );
} else {
  console.log(`Admin interface strings found: ${String(all.length)}`);
  console.log(`Sayable in Bangla:               ${String(translated.length)} (${((translated.length / all.length) * 100).toFixed(1)}%)`);
  console.log(`Still English only:              ${String(missing.length)}`);
  const wired = all.filter((row) => row.wired);
  console.log(
    `Actually routed through t()/AutoText: ${String(wired.length)} of ${String(all.length)} (${((wired.length / all.length) * 100).toFixed(1)}%)`,
  );
  const unwired = all.filter((row) => !row.wired);
  const unwiredText = unwired.filter((row) => row.kind === 'text').length;
  console.log(
    `  of the ${String(unwired.length)} not routed: ${String(unwiredText)} are element text, ${String(unwired.length - unwiredText)} are props (title, label, placeholder…)`,
  );
  const unwiredOut = process.argv.find((arg) => arg.startsWith('--unwired-out='));
  if (unwiredOut !== undefined) {
    writeFileSync(
      unwiredOut.slice('--unwired-out='.length),
      JSON.stringify(
        unwired.map((row) => ({ text: row.text, kind: row.kind, file: row.file })),
        null,
        2,
      ),
      'utf8',
    );
  }
  console.log('\nBy area:');
  for (const [area, bucket] of [...byArea.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${area.padEnd(42)} ${String(bucket.done).padStart(4)} / ${String(bucket.total).padStart(4)}`);
  }
  console.log('\nNext 40 strings to translate:');
  for (const row of missing.slice(0, 40)) console.log(`  ${row.text}  —  ${row.file}`);
}
