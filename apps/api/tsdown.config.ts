import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  deps: {
    // Internal @nilzora/* packages export TypeScript source, so they are bundled.
    alwaysBundle: [/^@nilzora\//],
    // Anything else must be a declared dependency resolved at runtime; the build
    // fails instead of silently inlining an undeclared npm package.
    onlyBundle: [],
  },
});
