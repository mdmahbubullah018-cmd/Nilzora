/* eslint-disable no-console -- a CLI report belongs on stdout. */
/*
 * Moves date formatting to the language boundary.
 * ----------------------------------------------
 * `{formatDate(row.createdAt)}` in a server component always prints English, because the
 * function has no way to know the reader's language. `<DateTimeText value={…} />` is the client
 * component that does. This rewrites the JSX-child form only: attribute values
 * (`title={formatDate(…)}`) and template strings (`${formatDate(…)}`) are left alone, since a
 * component cannot stand in for a string there.
 *
 * Usage: node scripts/i18n-dates.mjs [--write]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, '..');
const src = join(adminRoot, 'src');
const write = process.argv.includes('--write');

const REPLACEMENTS = [
  { fn: 'formatFullDate', make: (arg) => `<FullDateText at={${arg}} />`, needs: ['FullDateText'] },
  {
    fn: 'formatDateTime',
    make: (arg) => `<DateTimeText value={${arg}} style="datetime" />`,
    needs: ['DateTimeText'],
  },
  {
    fn: 'formatTime',
    make: (arg) => `<DateTimeText value={${arg}} style="time" />`,
    needs: ['DateTimeText'],
  },
  {
    fn: 'formatDayLong',
    make: (arg) => `<CalendarDayText day={${arg}} long />`,
    needs: ['CalendarDayText'],
  },
  {
    fn: 'formatDay',
    make: (arg) => `<CalendarDayText day={${arg}} />`,
    needs: ['CalendarDayText'],
  },
  { fn: 'formatDate', make: (arg) => `<DateTimeText value={${arg}} />`, needs: ['DateTimeText'] },
  {
    fn: 'formatRelativeTime',
    make: (arg) => {
      const [value, now] = arg.split(',').map((part) => part.trim());
      return now === undefined
        ? `<RelativeTimeText value={${value}} />`
        : `<RelativeTimeText value={${value}} now={${now}} />`;
    },
    needs: ['RelativeTimeText'],
  },
];

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
  let code = original;
  let replaced = 0;
  const needed = new Set();

  for (const rule of REPLACEMENTS) {
    const pattern = new RegExp(String.raw`\{(?<!\$)(${rule.fn}\(([^{}]*?)\))\}`, 'g');
    code = code.replace(pattern, (full, _call, arg, offset) => {
      // Only when the brace opens a JSX child, not an attribute (`title={…}`).
      const before = code.slice(Math.max(0, offset - 2), offset);
      if (/=\s*$/.test(before)) return full;
      replaced += 1;
      needed.add(rule.needs[0]);
      return rule.make(arg);
    });
  }

  if (replaced === 0) continue;
  if (!code.includes("from '@/components/i18n/format-text'")) {
    const ends = [
      ...code.matchAll(/^import\s+[^'"]*?from\s*'[^']*';/gm),
      ...code.matchAll(/^import\s*'[^']*';/gm),
    ].map((match) => match.index + match[0].length);
    const line = `import { ${[...needed].sort().join(', ')} } from '@/components/i18n/format-text';`;
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
  `\n${String(results.reduce((sum, row) => sum + row.replaced, 0))} dates in ${String(results.length)} files ${write ? 'rewritten' : 'would be rewritten'}`,
);
