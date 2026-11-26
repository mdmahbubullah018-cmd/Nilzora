import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/*
 * Every stack route must be declared in app/_layout.tsx.
 *
 * The navigator hides its header by default, and a stack screen pads only the bottom because
 * it expects the header above it. A route left out of the layout therefore draws from the very
 * top of the window — under the Android status bar — and has no back control. The Voucher
 * Center and My Vouchers shipped that way, so this test holds the list to the files on disk.
 */

const APP = join(__dirname, '..', '..', 'app');
const LAYOUT = readFileSync(join(APP, '_layout.tsx'), 'utf8');

/** Route names of the screens the root layout declares. */
function declared(): string[] {
  return [...LAYOUT.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]!);
}

/** Every route file that is not a tab, a layout, the catch-all or the declared stack screens. */
function routeFiles(): string[] {
  return readdirSync(APP, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(sep).join('/'))
    .filter((entry) => entry.endsWith('.tsx'))
    .filter((entry) => !entry.endsWith('_layout.tsx'))
    .filter((entry) => !entry.startsWith('(tabs)/'))
    .filter((entry) => entry !== '+not-found.tsx')
    .map((entry) => entry.slice(0, -'.tsx'.length))
    .sort();
}

describe('root stack', () => {
  it('declares a header for every route it holds', () => {
    const missing = routeFiles().filter((route) => !declared().includes(route));

    expect(missing).toEqual([]);
  });

  it('does not declare a screen for a route that no longer exists', () => {
    const files = routeFiles();
    const orphans = declared().filter((route) => route !== '(tabs)' && !files.includes(route));

    expect(orphans).toEqual([]);
  });

  it('names the screens that carry their title in the header', () => {
    // A route registered with a title shows it in the bar; its content must not repeat it.
    for (const title of ['Vouchers', 'My Vouchers', 'Orders', 'Cart', 'Settings']) {
      expect(LAYOUT).toMatch(new RegExp(`title: '${title}'`));
    }
  });

  it('finds the app directory it is checking', () => {
    expect(relative(APP, join(APP, '_layout.tsx'))).toBe('_layout.tsx');
    expect(routeFiles().length).toBeGreaterThan(20);
  });
});
