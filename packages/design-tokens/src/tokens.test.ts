import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colors } from './colors';
import { radii } from './scale';
import { darkTheme, lightTheme, moderatorWorkspace } from './themes';

type Declarations = Map<string, string>;

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Maps each rule's selector to its custom-property declarations. */
function parseBlocks(source: string): Map<string, Declarations> {
  const blocks = new Map<string, Declarations>();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Declarations = new Map();
    for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      declarations.set(name, value.trim());
    }
    blocks.set(selector.replace(/\s+/g, ' ').trim(), declarations);
  }
  return blocks;
}

const blocks = parseBlocks(css);
const brandBlock = blocks.get(':root') ?? new Map<string, string>();
const lightBlock = blocks.get(":root, [data-theme='light']") ?? new Map<string, string>();
const darkBlock = blocks.get("[data-theme='dark']") ?? new Map<string, string>();
const moderatorBlock = blocks.get("[data-workspace='moderator']") ?? new Map<string, string>();

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Resolves var() references against the given scopes (first match wins). */
function resolve(value: string, scopes: Declarations[], seen = new Set<string>()): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    if (seen.has(name)) throw new Error(`Cycle through ${name}`);
    const next = scopes.find((scope) => scope.has(name))?.get(name);
    if (next === undefined) throw new Error(`Undefined variable ${name}`);
    return resolve(next, scopes, new Set([...seen, name]));
  });
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

describe('tokens.css brand palette', () => {
  it.each(Object.entries(colors))('declares --nz-color-%s with the palette value', (name, hex) => {
    expect(brandBlock.get(`--nz-color-${kebab(name)}`)?.toUpperCase()).toBe(hex);
  });

  it.each(['sm', 'md', 'lg', 'xl'] as const)('declares --nz-radius-%s', (size) => {
    expect(brandBlock.get(`--nz-radius-${size}`)).toBe(`${radii[size]}px`);
  });
});

describe('tokens.css dark theme', () => {
  it.each(Object.entries(darkTheme))('declares --nz-%s matching themes.ts', (role, expected) => {
    const declared = darkBlock.get(`--nz-${kebab(role)}`);
    expect(declared, `--nz-${kebab(role)} is missing`).toBeDefined();
    expect(normalise(resolve(declared ?? '', [darkBlock, brandBlock]))).toBe(normalise(expected));
  });

  it('declares exactly the roles of the light theme', () => {
    expect([...darkBlock.keys()].sort()).toEqual([...lightBlock.keys()].sort());
  });
});

describe('tokens.css light theme', () => {
  it.each(Object.entries(lightTheme))('declares --nz-%s matching themes.ts', (role, expected) => {
    const declared = lightBlock.get(`--nz-${kebab(role)}`);
    expect(declared, `--nz-${kebab(role)} is missing`).toBeDefined();
    expect(normalise(resolve(declared ?? '', [lightBlock, brandBlock]))).toBe(normalise(expected));
  });

  it('declares no semantic role that themes.ts does not know about', () => {
    const known = new Set(Object.keys(lightTheme).map((role) => `--nz-${kebab(role)}`));
    expect([...lightBlock.keys()].filter((name) => !known.has(name))).toEqual([]);
  });

  it.each(Object.entries(moderatorWorkspace))(
    'overrides --nz-%s for the moderator workspace',
    (role, expected) => {
      const declared = moderatorBlock.get(`--nz-${kebab(role)}`) ?? '';
      expect(normalise(resolve(declared, [moderatorBlock, brandBlock]))).toBe(normalise(expected));
    },
  );
});

describe('tokens.css variable graph', () => {
  it('contains no reference cycles', () => {
    const edges = new Map<string, Set<string>>();
    for (const declarations of blocks.values()) {
      for (const [name, value] of declarations) {
        const targets = edges.get(name) ?? new Set<string>();
        for (const [, target = ''] of value.matchAll(/var\((--[\w-]+)\)/g)) targets.add(target);
        edges.set(name, targets);
      }
    }

    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, path: string[]): void => {
      if (done.has(name)) return;
      if (visiting.has(name)) throw new Error(`Cycle: ${[...path, name].join(' -> ')}`);
      visiting.add(name);
      for (const target of edges.get(name) ?? []) visit(target, [...path, name]);
      visiting.delete(name);
      done.add(name);
    };

    expect(() => {
      for (const name of edges.keys()) visit(name, []);
    }).not.toThrow();
  });

  it('only references brand variables or other --nz-* variables', () => {
    for (const declarations of blocks.values()) {
      for (const value of declarations.values()) {
        for (const [, target = ''] of value.matchAll(/var\((--[\w-]+)\)/g)) {
          expect(target.startsWith('--nz-')).toBe(true);
        }
      }
    }
  });
});
