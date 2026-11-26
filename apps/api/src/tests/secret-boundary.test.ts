import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Guards the rule that Supabase server credentials and the service-role client
 * exist only inside apps/api. Scans the source of every client-side app and shared
 * package (not build output, which the final verification scans separately).
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const CLIENT_SIDE = [
  'apps/storefront/src',
  'apps/admin/src',
  'apps/mobile/app',
  'apps/mobile/src',
  'packages/ui/src',
  'packages/api-client/src',
  'packages/contracts/src',
  'packages/validation/src',
  'packages/design-tokens/src',
  // Server-only, but shared with both web apps: it must hold no Supabase credentials either.
  'packages/web-session/src',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry) ? [path] : [];
  });
}

const files = CLIENT_SIDE.flatMap((directory) => sourceFiles(join(repoRoot, directory)));

// Read once: a scan of every file is too slow to repeat per test beside a full test run.
const sources = files.map((file) => [file, readFileSync(file, 'utf8')] as const);

describe('secret boundary', () => {
  it('scans client-side and shared source', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each([
    ['the Supabase secret key variable', /SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY/],
    ['a Supabase secret key value', /sb_secret_[A-Za-z0-9]/],
    ['the service-role client', /auth\.admin|service_role/],
    ['the Supabase server SDK', /@supabase\/supabase-js/],
    // `\b` would also match `@nilzora/api-client`, which clients are meant to use.
    ['the API package', /@nilzora\/api(?![\w-])|apps\/api\//],
  ])('never references %s', (_, pattern) => {
    const offenders = sources.filter(([, text]) => pattern.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('exposes no secret through public build-time variables', () => {
    const publicSecret = /(NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE)/;
    const templates = [
      'apps/storefront/.env.example',
      'apps/admin/.env.example',
      'apps/mobile/.env.example',
    ];
    for (const template of templates) {
      expect(readFileSync(join(repoRoot, template), 'utf8')).not.toMatch(publicSecret);
    }
    for (const [, text] of sources) expect(text).not.toMatch(publicSecret);
  });
});
