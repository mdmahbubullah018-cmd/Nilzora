import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fromHere('./src')}/` },
      // Next.js resolves `server-only` to an empty module on the server; tests do the same.
      { find: 'server-only', replacement: fromHere('./src/test/server-only.ts') },
    ],
  },
  test: {
    // Pure modules run in Node; component tests opt into jsdom per file.
    environment: 'node',
  },
});
