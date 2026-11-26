/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Wraps static JSX text in <AutoText>, so the string goes through the language dictionary.
 * ---------------------------------------------------------------------------------------
 * The dictionary cannot translate what never asks it: a sentence written straight into JSX is
 * English in every language. This rewrites those sentences to `<AutoText>` (a client component
 * that returns a plain string, so it is valid inside <option>, <th> and friends) and adds the
 * import where it is needed.
 *
 * Deliberately conservative — a node is left alone when
 *  - it sits inside <pre>, <code>, <style> or <script>,
 *  - it has no letters, or looks like an identifier (`snake_case`, `a/b`, `1.5`),
 *  - it is inline between other content (a single leading or trailing space would be lost),
 *  - its text already runs through AutoText.
 *
 * Usage:
 *   node scripts/i18n-wrap.mjs            # report only
 *   node scripts/i18n-wrap.mjs --write    # rewrite files
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

const IMPORT = "import { AutoText } from '@/components/i18n/translate';";
const SKIP_TAGS = new Set(['pre', 'code', 'style', 'script', 'svg', 'path', 'AutoText']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

/** Marks every offset that sits inside a string literal or a comment, so code is never rewritten. */
function opaqueMask(code) {
  const mask = new Uint8Array(code.length);
  let state = null;
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    const previous = code[i - 1] ?? '\n';
    if (state === 'line') {
      mask[i] = 1;
      if (char === '\n') state = null;
      continue;
    }
    if (state === 'block') {
      mask[i] = 1;
      if (char === '*' && code[i + 1] === '/') {
        mask[i + 1] = 1;
        i += 1;
        state = null;
      }
      continue;
    }
    if (state !== null) {
      mask[i] = 1;
      if (char === '\\') {
        mask[i + 1] = 1;
        i += 1;
      } else if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = null;
      }
      continue;
    }
    if (char === '/' && code[i + 1] === '/') {
      state = 'line';
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 1;
      continue;
    }
    if (char === '/' && code[i + 1] === '*') {
      state = 'block';
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 1;
      continue;
    }
    // A quote only opens a string when code precedes it — in JSX prose (`Don't`) it does not.
    const codeLike = /[=,([:{!&|?+\-*%<>;]/.test(previous) || /^\s$/.test(previous) || i === 0;
    if (codeLike && (char === "'" || char === '"' || char === '`')) {
      state = char === "'" ? 'single' : char === '"' ? 'double' : 'template';
      mask[i] = 1;
    }
  }
  return mask;
}

/** True when the offset falls inside one of the tags we must not rewrite. */
function insideSkippedTag(code, offset) {
  let open = [];
  for (const match of code.matchAll(/<(\/?)([A-Za-z][\w.]*)\b[^>]*?(\/?)>/g)) {
    if (match.index >= offset) break;
    const [, closing, rawName, selfClosing] = match;
    if (selfClosing) continue;
    const name = rawName.split('.').pop();
    if (!closing) {
      open.unshift(name);
    } else {
      const at = open.indexOf(name);
      if (at >= 0) open = open.slice(at + 1);
    }
  }
  return open.some((name) => SKIP_TAGS.has(name));
}

function looksTranslatable(text) {
  if (text.length < 3 || text.length > 400) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[<>{}[\]=?|\\`]/.test(text)) return false;
  // `history.value`, `item.id`: code that happens to sit between two tags, not prose.
  if (/[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/.test(text)) return false;
  // Parentheses are only trusted in running prose ("Orders (COD)"), never in an expression.
  if (/[()]/.test(text) && text.split(' ').length < 4) return false;
  if (/^[\w.-]+@[\w.-]+$/.test(text)) return false;
  if (/^[a-z0-9_.:/#-]+$/.test(text)) return false;
  if (/^[\d\s.,:;/%()+£$৳-]+$/.test(text)) return false;
  if (/^(https?:|\/|#)/.test(text)) return false;
  if (!/[A-Za-z]{2}/.test(text)) return false;
  return true;
}

/** Adds the AutoText import after the last top-level import statement. */
function addImport(code) {
  if (/from '@\/components\/i18n\/translate'/.test(code)) return code;
  const ends = [
    ...code.matchAll(/^import\s+[^'"]*?from\s*'[^']*';/gm),
    ...code.matchAll(/^import\s*'[^']*';/gm),
  ].map((match) => match.index + match[0].length);
  if (ends.length === 0) return `${IMPORT}\n${code}`;
  const at = Math.max(...ends);
  return `${code.slice(0, at)}\n${IMPORT}${code.slice(at)}`;
}

const results = [];
for (const file of walk(src)) {
  const original = readFileSync(file, 'utf8');
  if (only !== undefined && !file.includes(only)) continue;
  // The translator itself must never be rewritten to call itself.
  if (file.includes(`${join('src', 'lib', 'i18n')}`) || file.includes(`${join('src', 'components', 'i18n')}`)) continue;
  let code = original;
  let wrapped = 0;

  if (process.argv.includes('--expr')) {
    // Second pass: text that arrives as data — `{row.label}`, `{statusLabel(item.status)}`.
    // AutoText returns a non-string untouched, so this is safe for numbers and nodes.
    const matches = [...code.matchAll(/>\{([^{}]+)\}</g)].reverse();
    const opaque = opaqueMask(code);
    for (const match of matches) {
      const inner = match[1].trim();
      const offset = match.index;
      if (opaque[offset] === 1) continue;
      if (inner.includes('=>') || inner.length > 120) continue;
      const call = /^[\w$.]+\(.*\)$/.test(inner);
      const member = /^[\w$.[\]]*\.[A-Za-z_$][\w$]*$/.test(inner);
      const ident = /^[A-Za-z_$][\w$]*$/.test(inner);
      if (!call && !member && !ident) continue;
      if (!/^\/[A-Za-z]/.test(code.slice(offset + match[0].length))) continue;
      if (insideSkippedTag(code, offset)) continue;
      code = `${code.slice(0, offset)}><AutoText value={${inner}} /><${code.slice(offset + match[0].length)}`;
      wrapped += 1;
    }
    if (wrapped > 0) {
      code = addImport(code);
      results.push({ file: relative(adminRoot, file).replace(/\\/g, '/'), wrapped });
      if (write) writeFileSync(file, code, 'utf8');
      if (show) console.log(code);
    }
    continue;
  }


  const matches = [...code.matchAll(/>([^<>{}]+)</g)].reverse();
  const opaque = opaqueMask(code);
  for (const match of matches) {
    const body = match[1];
    const offset = match.index;
    const text = body.replace(/\s+/g, ' ').trim();
    if (!looksTranslatable(text)) continue;
    if (opaque[offset] === 1) continue;

    const start = body.indexOf(text);
    const loneLeft = /^[ \t]*\r?\n\s*$/.test(body.slice(0, start));
    const loneRight = /^[ \t]*\r?\n\s*$/.test(body.slice(start + text.length));
    const exact = body === text;
    if (!exact && !(loneLeft && loneRight)) continue;
    // The text must be the whole content of an element: `<X>text</X>`. This is what keeps
    // TypeScript generics (`MouseEvent<HTMLElement>, next`) out of the sweep.
    if (!/^\/[A-Za-z]/.test(code.slice(offset + match[0].length))) continue;
    if (insideSkippedTag(code, offset)) continue;

    code = `${code.slice(0, offset)}><AutoText>${text}</AutoText><${code.slice(offset + match[0].length)}`;
    wrapped += 1;
  }

  if (wrapped === 0) continue;

  code = addImport(code);

  results.push({ file: relative(adminRoot, file).replace(/\\/g, '/'), wrapped });
  if (write) writeFileSync(file, code, 'utf8');
  if (show) console.log(code);
}

const total = results.reduce((sum, row) => sum + row.wrapped, 0);
for (const row of results.sort((a, b) => b.wrapped - a.wrapped)) {
  console.log(`${String(row.wrapped).padStart(3)}  ${row.file}`);
}
console.log(
  `\n${String(total)} strings in ${String(results.length)} files ${write ? 'rewritten' : 'would be wrapped'}`,
);
