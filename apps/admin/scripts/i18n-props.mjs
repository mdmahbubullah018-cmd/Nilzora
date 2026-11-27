/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Routes text props through the translator, in client components.
 * --------------------------------------------------------------
 * A sentence written into an attribute (`label="Email address"`) never reaches the dictionary on
 * its own: only `tx()` can translate it, and only a client component may call a hook. So for
 * every `'use client'` file this adds `const tx = useTx();` to each component that needs it and
 * rewrites `prop="Text"` to `prop={tx("Text")}`.
 *
 * Server components are deliberately untouched — they cannot call hooks; their titles and
 * descriptions already travel through the shared panels, which translate them themselves.
 *
 * Usage:
 *   node scripts/i18n-props.mjs            # report only
 *   node scripts/i18n-props.mjs --write    # rewrite files
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, '..');
const src = join(adminRoot, 'src');
const write = process.argv.includes('--write');
const only = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
const show = process.argv.includes('--show');

const PROPS =
  'title|label|placeholder|hint|description|legend|aria-label|alt|empty|actionLabel|detail|heading|subtitle|message|text|subject|confirmLabel';
const propPattern = new RegExp(`\\b(${PROPS})=("([^"{}]{2,400})"|\\{'([^'{}]{2,400})'\\})`, 'g');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

/** Inserts `const tx = useTx();` after the `{` that opens each component's body. */
function injectHooks(code) {
  let out = code;
  const insertions = [];
  const findBody = (from) => {
    let depth = 0;
    for (let i = from; i < out.length; i += 1) {
      const char = out[i];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === '{' && depth === 0) return i + 1;
    }
    return -1;
  };
  const already = (at) => out.slice(at, at + 60).includes('const tx = useTx();');

  for (const match of out.matchAll(
    /^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*[(<]/gm,
  )) {
    const body = findBody(match.index + match[0].length - 1);
    if (body > 0 && !already(body)) insertions.push({ at: body });
  }
  // Arrow components only: `const Name = (…): T => {`. A plain `const X = (` is data.
  for (const match of out.matchAll(
    /^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{/gm,
  )) {
    const body = match.index + match[0].length;
    if (!already(body)) insertions.push({ at: body });
  }

  const unique = [...new Map(insertions.map((row) => [row.at, row])).values()].sort(
    (a, b) => b.at - a.at,
  );
  for (const row of unique) {
    out = `${out.slice(0, row.at)}\n  const tx = useTx();${out.slice(row.at)}`;
  }
  return { code: out, injected: unique.length };
}

/** Adds the useTx import after the last top-level import, keeping `'use client'` first. */
function addImport(code) {
  if (/import\s*\{[^}]*\buseTx\b[^}]*\}\s*from\s*'@\/lib\/i18n\/provider'/.test(code)) return code;
  const directive = code.match(/^\s*(['"])use client\1;?\r?\n/);
  const head = directive ? directive[0] : '';
  const rest = code.slice(head.length);
  const ends = [
    ...rest.matchAll(/^import\s+[^'"]*?from\s*'[^']*';/gm),
    ...rest.matchAll(/^import\s*'[^']*';/gm),
  ].map((match) => match.index + match[0].length);
  const line = "import { useTx } from '@/lib/i18n/provider';";
  if (ends.length === 0) return `${head}${line}\n${rest}`;
  const at = Math.max(...ends);
  return `${head}${rest.slice(0, at)}\n${line}${rest.slice(at)}`;
}

const results = [];
for (const file of walk(src)) {
  const original = readFileSync(file, 'utf8');
  if (
    file.includes(`${join('src', 'lib', 'i18n')}`) ||
    file.includes(`${join('src', 'components', 'i18n')}`)
  )
    continue;
  if (!/^\s*('use client'|"use client")/m.test(original.slice(0, 400))) continue;
  if (only !== undefined && !file.includes(only)) continue;

  let code = original;
  let replaced = 0;
  for (const match of [...code.matchAll(propPattern)].reverse()) {
    const [, prop, , doubleQuoted, singleQuoted] = match;
    const text = doubleQuoted ?? singleQuoted ?? '';
    if (text.trim().length < 2) continue;
    if (/[{}]/.test(text)) continue;
    if (!/[A-Za-z]/.test(text)) continue;
    // Code, not prose.
    if (/^(?:https?:|\/|#)/.test(text)) continue;
    if (/^[a-z0-9_\-:.]+$/.test(text)) continue;
    const literal = text.includes('"') ? `'${text.replace(/'/g, "\\'")}'` : `"${text}"`;
    const replacement = `${prop}={tx(${literal})}`;
    code = `${code.slice(0, match.index)}${replacement}${code.slice(match.index + match[0].length)}`;
    replaced += 1;
  }
  if (replaced === 0 && !process.argv.includes('--inject')) continue;

  code = injectHooks(code).code;
  code = addImport(code);

  results.push({ file: relative(adminRoot, file).replace(/\\/g, '/'), replaced });
  if (write) writeFileSync(file, code, 'utf8');
  if (show) console.log(code);
}

const total = results.reduce((sum, row) => sum + row.replaced, 0);
for (const row of results.sort((a, b) => b.replaced - a.replaced)) {
  console.log(`${String(row.replaced).padStart(3)}  ${row.file}`);
}
console.log(
  `\n${String(total)} props in ${String(results.length)} files ${write ? 'rewritten' : 'would be rewritten'}`,
);
