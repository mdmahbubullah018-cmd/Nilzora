// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the React Server Components boundary.
 *
 * A module that starts with the 'use client' directive is replaced, on the server, by a
 * reference proxy: only React COMPONENTS can be rendered from it. A server module that
 * calls a function, reads a constant or array, or spreads an object exported from such a
 * module crashes at request time ("Attempted to call x() from the server but x is on the
 * client", "x.find is not a function") - and neither `tsc`, vitest nor `next build` notice.
 *
 * What this test does (a static heuristic, deliberately simple):
 *  1. Reads every .ts/.tsx file under src (tests excluded) and finds the 'use client' ones.
 *  2. Starts from the server entry points (every non-client file under src/app, plus
 *     'use server' modules and proxy/middleware) and follows relative and '@/' imports
 *     through NON-client modules only (a client module ends the server graph).
 *  3. For every import in that server graph that resolves - through barrel re-exports
 *     (`export { a } from`, `export * from`) - to a client module, it flags the name unless
 *     it is only ever used as a JSX tag (`<Name ...>`), or is a type.
 *
 * Limits: it is regex based, not a TypeScript parser. It does not follow dynamic imports,
 * `import x = require`, renamed re-exports (`export { a as b }` is followed by the exported
 * name only), or imports from workspace packages (e.g. @nilzora/ui). A component passed as a
 * prop value (`icon={Foo}`) is treated as a non-JSX use and flagged; if that is genuinely a
 * legal client reference, add it to ALLOWED below with a reason.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `relative/path/of/server-module.tsx::ImportedName` -> why it is legitimate. */
const ALLOWED: Record<string, string> = {};

const EXTENSIONS = ['.ts', '.tsx'];

function walk(directory: string, out: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else if (
      EXTENSIONS.some((extension) => name.endsWith(extension)) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

function directive(source: string): 'client' | 'server' | null {
  const head = stripComments(source).trimStart();
  const match = /^(['"])use (client|server)\1/.exec(head);
  return match ? (match[2] as 'client' | 'server') : null;
}

interface ModuleInfo {
  file: string;
  kind: 'client' | 'server' | null;
  code: string;
}

const modules = new Map<string, ModuleInfo>();
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  modules.set(file, { file, kind: directive(source), code: stripComments(source) });
}

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => base + extension),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => modules.has(candidate)) ?? null;
}

interface NamedImport {
  /** Name exported by the target module ('default' for default imports, '*' for namespaces). */
  imported: string;
  local: string;
}

interface ImportStatement {
  specifier: string;
  names: NamedImport[];
}

const IMPORT_RE = /\bimport\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;

function parseImports(code: string): ImportStatement[] {
  const found: ImportStatement[] = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    if (match[1]) continue; // `import type { ... }` is erased
    const clause = match[2] ?? '';
    const names: NamedImport[] = [];
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const outside = clause.replace(/\{[\s\S]*\}/, '');
    const namespace = /\*\s*as\s+([\w$]+)/.exec(outside);
    if (namespace) names.push({ imported: '*', local: namespace[1]! });
    const defaultName = /^\s*([\w$]+)\s*,?\s*$/.exec(outside.replace(/\*\s*as\s+[\w$]+/, ''));
    if (defaultName && !namespace) names.push({ imported: 'default', local: defaultName[1]! });
    for (const part of (braces?.[1] ?? '').split(',')) {
      const text = part.trim();
      if (!text || /^type\s/.test(text)) continue; // inline `type X` specifiers are erased
      const alias = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(text);
      names.push(
        alias ? { imported: alias[1]!, local: alias[2]! } : { imported: text, local: text },
      );
    }
    found.push({ specifier: match[3]!, names });
  }
  return found;
}

const REEXPORT_RE =
  /\bexport\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;

/** The module that really defines `name`, following barrel re-exports. */
function originOf(file: string, name: string, seen = new Set<string>()): string {
  const info = modules.get(file)!;
  if (info.kind === 'client' || name === '*' || name === 'default') return file;
  const key = `${file}::${name}`;
  if (seen.has(key)) return file;
  seen.add(key);
  for (const match of info.code.matchAll(REEXPORT_RE)) {
    if (match[1]) continue;
    const target = resolveSpecifier(file, match[3]!);
    if (!target) continue;
    const spec = match[2]!;
    if (spec.startsWith('*')) {
      const ns = /as\s+([\w$]+)/.exec(spec);
      if (ns) {
        if (ns[1] === name) return target;
        continue;
      }
      if (modules.get(target)!.kind === 'client') {
        if (exportsName(target, name)) return target;
        continue;
      }
      const deeper = originOf(target, name, seen);
      if (deeper !== target || exportsName(target, name)) return deeper;
      continue;
    }
    for (const part of spec.slice(1, -1).split(',')) {
      const text = part.trim();
      if (!text || /^type\s/.test(text)) continue;
      const alias = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(text);
      const exported = alias ? alias[2]! : text;
      const original = alias ? alias[1]! : text;
      if (exported === name) return originOf(target, original, seen);
    }
  }
  return file;
}

function exportsName(file: string, name: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  const code = modules.get(file)!.code;
  const declaration = new RegExp(
    `\\bexport\\s+(?:async\\s+)?(?:const|let|var|function\\*?|class|enum|type|interface)\\s+${escaped}\\b`,
  );
  const list = new RegExp(`\\bexport\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`);
  return declaration.test(code) || list.test(code);
}

function isTypeExport(file: string, name: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:type|interface)\\s+${escaped}\\b`).test(
    modules.get(file)!.code,
  );
}

/** Server modules: entry points and everything they import without crossing a client file. */
function serverGraph(): Set<string> {
  const roots = [...modules.values()].filter(
    (info) =>
      info.kind !== 'client' &&
      (info.kind === 'server' ||
        info.file.startsWith(join(SRC, 'app') + sep) ||
        /(^|[\\/])(proxy|middleware|instrumentation)\.tsx?$/.test(relative(SRC, info.file))),
  );
  const graph = new Set<string>();
  const queue = roots.map((info) => info.file);
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (graph.has(file)) continue;
    graph.add(file);
    for (const statement of parseImports(modules.get(file)!.code)) {
      const target = resolveSpecifier(file, statement.specifier);
      if (!target) continue;
      // A barrel's own re-exports must be followed too, but only through non-client files.
      if (modules.get(target)!.kind !== 'client') queue.push(target);
    }
    for (const match of modules.get(file)!.code.matchAll(REEXPORT_RE)) {
      const target = resolveSpecifier(file, match[3]!);
      if (target && modules.get(target)!.kind !== 'client') queue.push(target);
    }
  }
  return graph;
}

const escapeRe = (value: string) => value.replace(/[$]/g, '\\$&');

/** Occurrences of `local` that are not a JSX tag name (`<Local`, `</Local`). */
function nonJsxUses(code: string, local: string, namespace: boolean): number {
  const body = code.replace(IMPORT_RE, '').replace(REEXPORT_RE, '');
  const name = escapeRe(local);
  const all = namespace
    ? [...body.matchAll(new RegExp(`(?<![\\w$.])${name}\\.[\\w$]+`, 'g'))].length
    : [...body.matchAll(new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g'))].length;
  const jsx = [...body.matchAll(new RegExp(`<\\/?${name}(?![\\w$])`, 'g'))].length;
  const jsxNamespace = [...body.matchAll(new RegExp(`<\\/?${name}\\.[\\w$]+`, 'g'))].length;
  return namespace ? all - jsxNamespace : all - jsx;
}

export function findBoundaryViolations(): string[] {
  const violations: string[] = [];
  for (const file of serverGraph()) {
    const info = modules.get(file)!;
    for (const statement of parseImports(info.code)) {
      const target = resolveSpecifier(file, statement.specifier);
      if (!target) continue;
      for (const { imported, local } of statement.names) {
        const origin = originOf(target, imported);
        if (modules.get(origin)!.kind !== 'client') continue;
        if (imported !== '*' && imported !== 'default' && isTypeExport(origin, imported)) continue;
        if (nonJsxUses(info.code, local, imported === '*') === 0) continue;
        const where = relative(SRC, file).split(sep).join('/');
        if (ALLOWED[`${where}::${local}`]) continue;
        violations.push(
          `${where} uses "${local}" from client module ${relative(SRC, origin).split(sep).join('/')} outside JSX`,
        );
      }
    }
  }
  return violations.sort();
}

describe('server/client module boundary', () => {
  it('scans a realistic module graph', () => {
    const clients = [...modules.values()].filter((info) => info.kind === 'client');
    expect(clients.length).toBeGreaterThan(5);
    expect(serverGraph().size).toBeGreaterThan(10);
  });

  it('never uses a non-component export of a "use client" module from a server module', () => {
    expect(findBoundaryViolations()).toEqual([]);
  });

  it('detects the bug class (self-check of the heuristic)', () => {
    const fake = join(SRC, 'app', '__fake__', 'page.tsx');
    const client = join(SRC, 'components', '__fake__', 'client.tsx');
    const code = `import { Widget, helper } from '@/components/__fake__/client';\nexport default () => <Widget x={helper(1)} />;`;
    modules.set(client, {
      file: client,
      kind: 'client',
      code: `export function Widget() { return null; }\nexport function helper(n: number) { return n; }`,
    });
    modules.set(fake, { file: fake, kind: null, code });
    try {
      expect(findBoundaryViolations()).toEqual([
        'app/__fake__/page.tsx uses "helper" from client module components/__fake__/client.tsx outside JSX',
      ]);
    } finally {
      modules.delete(fake);
      modules.delete(client);
    }
  });

  it('follows a barrel that re-exports a client module (self-check)', () => {
    const page = join(SRC, 'app', '__fake__', 'page.tsx');
    const barrel = join(SRC, 'components', '__fake__', 'index.ts');
    const client = join(SRC, 'components', '__fake__', 'client.tsx');
    modules.set(client, {
      file: client,
      kind: 'client',
      code: 'export const MODES = [1, 2]; export function Widget() { return null; }',
    });
    modules.set(barrel, {
      file: barrel,
      kind: null,
      code: "export * from './client';",
    });
    modules.set(page, {
      file: page,
      kind: null,
      code: "import { MODES, Widget } from '@/components/__fake__'; export default () => <Widget n={MODES.length} />;",
    });
    try {
      expect(findBoundaryViolations()).toEqual([
        'app/__fake__/page.tsx uses "MODES" from client module components/__fake__/client.tsx outside JSX',
      ]);
    } finally {
      for (const file of [page, barrel, client]) modules.delete(file);
    }
  });
});
